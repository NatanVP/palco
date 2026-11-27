import { randomUUID } from 'node:crypto'
import { existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync } from 'node:fs'
import { lstat,readdir } from 'node:fs/promises'
import { dirname,join } from 'node:path'
import type { BackupSnapshot,DataUsage,PreparedBackup } from '../../shared/data-settings'
import { validateWorkspace } from '../domain/workspace-schema'
import { validWorkspaceId } from '../domain/workspace-id'
import { DataRoot,remapPaths,walkFiles } from './data-root'
import { decodeZip,encodeZip } from './zip'
interface Manifest {type:'palco-backup';schemaVersion:1;kind:'full'|'workspace';createdAt:string;sourceRoot:string;workspaceId?:string;workspaceName?:string;excluded?:string[]}
interface Prepared {manifest:Manifest;files:Map<string,Buffer>;expires:number}
const HOUR=3600000,excluded=(path:string)=>['backups','account-data','.palco-data-root','encrypted-account-keys.json','encrypted-account-keys.json.bak'].some(n=>path===n||path.startsWith(n+'/'))
function manifest(bytes:Buffer|undefined):Manifest{let m:Manifest;try{m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))as Manifest}catch{throw new Error('Manifesto de backup inválido.')};if(!m||m.type!=='palco-backup'||m.schemaVersion!==1||!['full','workspace'].includes(m.kind)||typeof m.createdAt!=='string'||!Number.isFinite(Date.parse(m.createdAt))||typeof m.sourceRoot!=='string'||m.kind==='workspace'&&!validWorkspaceId(m.workspaceId))throw new Error('Backup não é compatível com esta versão do palco.');return m}
function workspace(bytes:Buffer,id:string):ReturnType<typeof validateWorkspace>{let e:{type?:string;schemaVersion?:number;payload?:unknown};try{e=JSON.parse(bytes.toString('utf8'))}catch{throw new Error('Workspace ilegível no backup.')};if(e.type!=='workspace'||!Number.isInteger(e.schemaVersion)||e.schemaVersion!>2||e.schemaVersion!<1)throw new Error('Versão de workspace não suportada.');const warnings:string[]=[];const w=validateWorkspace(e.payload,m=>warnings.push(m));if(w.id!==id||warnings.some(m=>/descartad|removid|inválid/.test(m)))throw new Error('Workspace inconsistente no backup.');return w}
async function diskSize(path:string):Promise<number>{
 try{const stat=await lstat(path);if(stat.isFile())return stat.size;if(!stat.isDirectory())return 0
  let total=0;for(const entry of await readdir(path))total+=await diskSize(join(path,entry));return total
 }catch{return 0}
}
function terminalIds(file:string):string[]{try{const nodes=(JSON.parse(readFileSync(file,'utf8'))as{payload?:{nodes?:Record<string,{id?:unknown;kind?:unknown}>}}).payload?.nodes??{};return Object.values(nodes).flatMap(n=>n.kind==='terminal'&&typeof n.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(n.id)?[n.id]:[])}catch{return[]}}
export class DataService {
 private timer?:ReturnType<typeof setInterval>;private prepared=new Map<string,Prepared>();warning?:string
 constructor(private readonly d:{roots:DataRoot;flush():void;workspaces():Array<{id:string;name:string}>;clearGlobal():Promise<void>;signOutAll():Promise<string[]>;rename?:typeof renameSync}){}
 root():string{return this.d.roots.current()}
 /** Quanto o disco usa: cada espaço de trabalho (arquivo, ícone e chats dos terminais) e a raiz inteira. Só tamanhos; links não são seguidos. */
 async usage():Promise<DataUsage>{
  this.d.roots.assertOwned();const root=this.root()
  const workspaces=await Promise.all(this.d.workspaces().filter(w=>validWorkspaceId(w.id)).map(async({id,name})=>{
   const file=join(root,'workspaces',id+'.json'),paths=[file,file+'.bak',join(root,'workspaces',id),...terminalIds(file).map(t=>join(root,'chats',t))]
   return{id,name,size:(await Promise.all(paths.map(diskSize))).reduce((a,b)=>a+b,0)}
  }))
  return{total:await diskSize(root),workspaces:workspaces.sort((a,b)=>b.size-a.size)}
 }
 /** A gravação mais recente de um espaço de trabalho. */
 lastSaveAt():string|null{
  let last=0;for(const{id}of this.d.workspaces()){if(!validWorkspaceId(id))continue;try{last=Math.max(last,lstatSync(join(this.root(),'workspaces',id+'.json')).mtimeMs)}catch{/* ainda não gravado */}}
  return last?new Date(Math.floor(last)).toISOString():null
 }
 lastBackupAt():string|null{try{return this.snapshots()[0]?.createdAt??null}catch{return null}}
 start():void{if(this.timer)return;this.timer=setInterval(()=>{try{this.backupNow();this.warning=undefined}catch{this.warning='O último backup horário falhou; os dados atuais foram preservados.'}},HOUR);this.timer.unref?.()}
 dispose():void{clearInterval(this.timer);this.timer=undefined /* prepared import is consumed after shutdown, before relaunch */}
 private pack(kind:'full'|'workspace',ws?:{id:string;name:string}):Buffer{
  this.d.roots.assertOwned();this.d.flush();const files=new Map<string,Buffer>(),root=this.root()
  const m:Manifest={type:'palco-backup',schemaVersion:1,kind,createdAt:new Date().toISOString(),sourceRoot:root,excluded:['backups','account-data','encrypted-account-keys.json'],...(ws?{workspaceId:ws.id,workspaceName:ws.name}:{})}
  files.set('manifest.json',Buffer.from(JSON.stringify(m)))
  if(ws){if(!validWorkspaceId(ws.id))throw new Error('Workspace inválido.');const path=`workspaces/${ws.id}.json`,bytes=readFileSync(join(root,path)),w=workspace(bytes,ws.id);files.set('data/'+path,bytes)
   const ids=Object.values(w.nodes).filter(n=>n.kind==='terminal').map(n=>n.id)
   for(const id of ids){if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))continue;const path='chats/'+id;for(const rel of walkFiles(join(root,path)))files.set('data/'+path+'/'+rel,readFileSync(join(root,path,rel)))}
  }else for(const path of walkFiles(root,excluded))files.set('data/'+path,readFileSync(join(root,path)))
  return encodeZip(files)
 }
 backupNow():void{
  for(const ws of this.d.workspaces()){const dir=join(this.root(),'backups',ws.id);if(!validWorkspaceId(ws.id))throw new Error('Workspace inválido.');const bytes=this.pack('workspace',ws);mkdirSync(dir,{recursive:true,mode:0o700});const id=Date.now().toString(36)+'-'+randomUUID();writeFileSync(join(dir,id+'.zip'),bytes,{flag:'wx',mode:0o600})}
 }
 snapshots():BackupSnapshot[]{
  const out:BackupSnapshot[]=[],base=join(this.root(),'backups');if(!existsSync(base))return out
  if(lstatSync(base).isSymbolicLink())throw new Error('A pasta de backups não pode ser um link.')
  for(const ws of readdirSync(base).filter(validWorkspaceId)){const dir=join(base,ws);if(lstatSync(dir).isSymbolicLink()||!lstatSync(dir).isDirectory())continue
   for(const file of readdirSync(dir).filter(f=>/^[a-z0-9-]+\.zip$/.test(f))){try{const path=join(dir,file),stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>512*1024*1024)continue;const zip=decodeZip(readFileSync(path)),m=manifest(zip.get('manifest.json'));if(m.kind!=='workspace'||m.workspaceId!==ws)continue;out.push({id:ws+'/'+file,workspaceId:ws,workspaceName:m.workspaceName??ws,createdAt:m.createdAt,size:stat.size})}catch{this.warning='Alguns snapshots inválidos foram ignorados e preservados.'}}
  }return out.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
 }
 private snapshotFile(id:string):string{if(typeof id!=='string'||!/^([A-Za-z0-9_-]{1,128})\/[a-z0-9-]+\.zip$/.test(id))throw new Error('Snapshot inválido.');if(!this.snapshots().some(s=>s.id===id))throw new Error('Snapshot não encontrado.');return join(this.root(),'backups',id)}
 deleteSnapshot(id:string):void{rmSync(this.snapshotFile(id))}
 deleteGroup(workspaceId:string):void{if(!validWorkspaceId(workspaceId))throw new Error('Workspace inválido.');const errors:string[]=[];for(const s of this.snapshots().filter(s=>s.workspaceId===workspaceId)){try{this.deleteSnapshot(s.id)}catch{errors.push(s.id)}}if(errors.length)throw new Error('Alguns snapshots não puderam ser apagados. Tente novamente.')}
 exportZip(file:string):void{const bytes=this.pack('full');writeFileSync(file,bytes,{mode:0o600})}
 prepareSnapshot(id:string):PreparedBackup{return this.prepareImport(this.snapshotFile(id))}
 prepareImport(file:string):PreparedBackup{
  if(lstatSync(file).isSymbolicLink()||!lstatSync(file).isFile()||lstatSync(file).size>512*1024*1024)throw new Error('Escolha um arquivo ZIP de até 512 MB.')
  const files=decodeZip(readFileSync(file)),m=manifest(files.get('manifest.json'));let count=0
  for(const[path,bytes]of files){if(path==='manifest.json')continue;if(!path.startsWith('data/'))throw new Error('Entrada inesperada no backup.');const match=/^data\/workspaces\/([A-Za-z0-9_-]{1,128})\.json$/.exec(path);if(match){workspace(bytes,match[1]!);count++}}
  if(!count||m.kind==='workspace'&&(count!==1||!files.has(`data/workspaces/${m.workspaceId}.json`)))throw new Error('Backup sem o workspace esperado.')
  const token=randomUUID();this.prepared.clear();this.prepared.set(token,{manifest:m,files,expires:Date.now()+15*60000});return{token,workspaceCount:count,kind:m.kind,createdAt:m.createdAt,...(m.workspaceName?{workspaceName:m.workspaceName}:{})}
 }
 applyImport(token:string):void{
  this.d.roots.assertOwned();const p=this.prepared.get(token);if(!p||p.expires<Date.now())throw new Error('A prévia expirou; selecione o backup novamente.')
  this.backupNow();const root=this.root(),stage=join(dirname(root),'.palco-import-'+randomUUID()),old=join(dirname(root),'.palco-rollback-'+randomUUID());mkdirSync(stage,{mode:0o700});mkdirSync(old,{mode:0o700})
  const moved:Array<{path:string;old:boolean;next:boolean}>=[];let rollbackFailed=false
  try{
   const paths=new Set<string>(),ws=p.manifest.workspaceId
   const snapshot= p.manifest.kind==='workspace'?workspace(p.files.get(`data/workspaces/${ws}.json`)!,ws!):undefined
   const terminalIds=snapshot?new Set(Object.values(snapshot.nodes).filter(n=>n.kind==='terminal').map(n=>n.id)):undefined
   for(const[path,bytes]of p.files){if(!path.startsWith('data/'))continue;const rel=path.slice(5)
    const allowed=snapshot?rel===`workspaces/${ws}.json`||rel.startsWith('chats/')&&terminalIds!.has(rel.split('/')[1]!):rel.startsWith('workspaces/')||rel.startsWith('chats/')||['sidebar.json','links.json','sessions.json'].includes(rel)
    if(!allowed)continue;const file=join(stage,rel);mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,rel.endsWith('.json')?remapPaths(bytes,p.manifest.sourceRoot,root):bytes,{flag:'wx',mode:0o600})
    if(snapshot)paths.add(rel.startsWith('chats/')?'chats/'+rel.split('/')[1]:rel)
   }
   if(!snapshot)for(const path of ['workspaces','chats','sidebar.json','links.json','sessions.json'])paths.add(path)
   else for(const id of terminalIds!)paths.add('chats/'+id)
   for(const path of paths){const from=join(stage,path),to=join(root,path),backup=join(old,path),entry={path,old:false,next:false};moved.push(entry);if(existsSync(to)){mkdirSync(dirname(backup),{recursive:true});(this.d.rename??renameSync)(to,backup);entry.old=true}if(existsSync(from)){mkdirSync(dirname(to),{recursive:true});(this.d.rename??renameSync)(from,to);entry.next=true}}
   this.prepared.delete(token)
  }catch(error){for(const entry of moved.reverse()){try{const target=join(root,entry.path);if(entry.next)rmSync(target,{recursive:true,force:true});if(entry.old){mkdirSync(dirname(target),{recursive:true});(this.d.rename??renameSync)(join(old,entry.path),target)}}catch{rollbackFailed=true}}if(rollbackFailed)throw new Error(`Restauração interrompida. A cópia anterior foi preservada em ${old}.`);throw error}
  finally{rmSync(stage,{recursive:true,force:true});if(!rollbackFailed)rmSync(old,{recursive:true,force:true})}
 }
 validateMove(path:string):void{this.d.roots.validateTarget(path)}
 validatePrepared(token:string):void{const p=this.prepared.get(token);if(!p||p.expires<Date.now())throw new Error('A prévia expirou; selecione o backup novamente.')}
 moveRoot(path:string):void{this.d.flush();this.d.roots.move(path)}
 reset():void{this.d.roots.reset()}
 signOutAll():Promise<string[]>{return this.d.signOutAll()}
 clearGlobal():Promise<void>{return this.d.clearGlobal()}
}
