import { randomUUID } from 'node:crypto'
import { cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmdirSync,rmSync,writeFileSync } from 'node:fs'
import { dirname,isAbsolute,join,normalize,parse,relative } from 'node:path'
import { readEnvelope,writeEnvelopeAtomic } from '../domain/envelope'
const MARKER='.palco-data-root'
export function safeDirectory(value:string):string{
 if(typeof value!=='string'||!isAbsolute(value)||value.includes('\0')||normalize(value)===parse(value).root)throw new Error('Diretório de dados inválido.')
 const path=normalize(value);for(let p=path;p!==dirname(p);p=dirname(p))if(existsSync(p)&&(lstatSync(p).isSymbolicLink()||!lstatSync(p).isDirectory()))throw new Error('A raiz de dados não pode conter links nem arquivos no caminho.');return path
}
/** Traverse only app-owned directories. Symlinks are rejected rather than following private external files. */
export function walkFiles(root:string,skip:(path:string)=>boolean=()=>false,bounded=true):string[]{
 const files:string[]=[];let total=0
 const visit=(path:string,depth:number)=>{if(depth>32)throw new Error('Árvore de dados profunda demais.');for(const entry of readdirSync(join(root,path))){const rel=path?path+'/'+entry:entry;if(skip(rel))continue;const stat=lstatSync(join(root,rel));if(stat.isSymbolicLink())throw new Error('A raiz contém um link simbólico; nenhum arquivo externo foi lido.');if(stat.isDirectory())visit(rel,depth+1);else if(stat.isFile()){total+=stat.size;if(bounded&&(stat.size>128*1024*1024||total>512*1024*1024||files.length>=20000))throw new Error('Dados excedem o limite de backup (512 MB, 128 MB por arquivo, 20 mil arquivos).');files.push(rel)}}}
 if(existsSync(root))visit('',0);return files.sort()
}
function remap(value:unknown,oldRoot:string,newRoot:string):unknown{if(typeof value==='string')return value===oldRoot?newRoot:value.startsWith(oldRoot+'/')?newRoot+value.slice(oldRoot.length):value;if(Array.isArray(value))return value.map(v=>remap(v,oldRoot,newRoot));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,oldRoot,newRoot)]));return value}
export function remapPaths(bytes:Buffer,oldRoot:string,newRoot:string):Buffer{try{return Buffer.from(JSON.stringify(remap(JSON.parse(bytes.toString('utf8')),oldRoot,newRoot),null,2)+'\n')}catch{return bytes}}
export class DataRoot{
 private root:string;private id:string
 constructor(private readonly locator:string,defaultRoot:string){
  const e=readEnvelope<{root:string;id:string}>(locator,'data-root',1);if(e.readOnly)throw new Error('Localização dos dados de versão futura; arquivo preservado.')
  this.root=safeDirectory(e.payload?.root??defaultRoot)
  if(e.payload){this.id=e.payload.id;this.assertOwned()}
  else{mkdirSync(this.root,{recursive:true,mode:0o700});if(existsSync(join(this.root,MARKER))){const v=JSON.parse(readFileSync(join(this.root,MARKER),'utf8')) as {id?:string};if(typeof v.id!=='string')throw new Error('Identificação da raiz inválida.');this.id=v.id}else{this.id=randomUUID();writeFileSync(join(this.root,MARKER),JSON.stringify({id:this.id}),{flag:'wx',mode:0o600})}}
 }
 current():string{return this.root}
 assertOwned():void{safeDirectory(this.root);let id:unknown;try{id=(JSON.parse(readFileSync(join(this.root,MARKER),'utf8'))as{id?:unknown}).id}catch{throw new Error('Não foi possível validar a raiz de dados; nenhum dado foi apagado.')};if(typeof this.id!=='string'||id!==this.id)throw new Error('A identificação da raiz de dados não corresponde.')}
 validateTarget(value:string):string{
  this.assertOwned();const target=safeDirectory(value),from=relative(this.root,target),to=relative(target,this.root)
  if(!from||!from.startsWith('..')||!to||!to.startsWith('..'))throw new Error('Escolha um diretório separado da raiz atual.')
  if(existsSync(target)&&readdirSync(target).length)throw new Error('O destino precisa estar vazio.')
  return target
 }
 move(value:string):void{
  const target=this.validateTarget(value)
  walkFiles(this.root,()=>false,false);mkdirSync(dirname(target),{recursive:true});const temporary=target+'.palco-moving-'+randomUUID()
  try{cpSync(this.root,temporary,{recursive:true,dereference:false,errorOnExist:true});for(const rel of walkFiles(temporary,p=>p==='account-data'||p.startsWith('account-data/'),false)){if(rel.endsWith('.json')||rel.endsWith('.json.bak')){const file=join(temporary,rel);writeFileSync(file,remapPaths(readFileSync(file),this.root,target),{mode:0o600})}}
   if(existsSync(target))rmdirSync(target);renameSync(temporary,target)
   writeEnvelopeAtomic(this.locator,'data-root',1,{root:target,id:this.id});const previous=this.root;this.root=target;rmSync(previous,{recursive:true})
  }finally{rmSync(temporary,{recursive:true,force:true})}
 }
 reset():void{this.assertOwned();rmSync(this.root,{recursive:true});mkdirSync(this.root,{recursive:true,mode:0o700});writeFileSync(join(this.root,MARKER),JSON.stringify({id:this.id}),{mode:0o600})}
}
