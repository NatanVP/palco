import{createHash,randomUUID}from'node:crypto'
import{existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync}from'node:fs'
import{join}from'node:path'
import{execFile}from'node:child_process'
import{tmpdir}from'node:os'
import type{GitHostView}from'../../shared/about-git'
import type{PullRequest}from'../system/pull-requests'
import type{PullRequestDetails}from'../../shared/model'
import{viewPullRequest}from'./view-pull-request'
export interface GitHostSpec{schemaVersion:number;revision:number;id:string;name:string;command:string;hosts:string[];whoamiArgs:string[];listArgs:string[];protocol:'github'|'gitlab'|'json'}
export type GitRunner=(command:string,args:string[],cwd?:string)=>Promise<string>
const BUILTIN:GitHostSpec[]=[
 {schemaVersion:1,revision:1,id:'github',name:'GitHub',command:'gh',hosts:['github.com'],whoamiArgs:['api','user','--silent'],listArgs:['pr','list','--state','all','--limit','30','--json','number,title,state,updatedAt,url'],protocol:'github'},
 {schemaVersion:1,revision:1,id:'gitlab',name:'GitLab',command:'glab',hosts:['gitlab.com'],whoamiArgs:['api','user','--silent'],listArgs:['mr','list','--all','--output','json','--per-page','30','--order','updated_at','--sort','desc'],protocol:'gitlab'}
]
const ID=/^[a-z][a-z0-9-]{0,63}$/,canonical=(p:GitHostSpec)=>JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a],[b])=>a.localeCompare(b))))
export const runGitHost:GitRunner=(command,args,cwd=tmpdir())=>new Promise((resolve,reject)=>execFile(command,args,{cwd,timeout:20000,maxBuffer:2*1024*1024,env:{...process.env,GH_PROMPT_DISABLED:'1',GLAB_CHECK_UPDATE:'false',GLAB_DEBUG_HTTP:'',GH_DEBUG:''}},(error,stdout)=>{if(error){reject(Object.assign(new Error('Não foi possível consultar a CLI do provedor.'),{code:(error as{code?:unknown}).code}));return}resolve(stdout)}))
function valid(p:GitHostSpec):boolean{return!!p&&p.schemaVersion===1&&Number.isInteger(p.revision)&&p.revision>=0&&ID.test(p.id)&&typeof p.name==='string'&&!!p.name.trim()&&p.name.length<=120&&typeof p.command==='string'&&!!p.command&&!/[\0\r\n]/.test(p.command)&&Array.isArray(p.hosts)&&p.hosts.length<=100&&p.hosts.every(h=>typeof h==='string'&&/^[a-z0-9.-]+$/i.test(h))&&[p.whoamiArgs,p.listArgs].every(a=>Array.isArray(a)&&a.length<=100&&a.every(s=>typeof s==='string'&&s.length<8192&&!s.includes('\0')))&&['github','gitlab','json'].includes(p.protocol)}
export class GitHosts{
 private accounts=new Map<string,{digest:string;result:NonNullable<GitHostView['account']>}>()
 constructor(readonly directory:string,private readonly run:GitRunner=runGitHost){}
 private safe():void{if(existsSync(this.directory)&&lstatSync(this.directory).isSymbolicLink())throw new Error('A pasta de provedores não pode ser um link.')}
 ensure():void{this.safe();if(!existsSync(this.directory)||!readdirSync(this.directory).some(n=>/^[a-z][a-z0-9-]*\.json$/.test(n)))this.restoreMissing()}
 private load(id:string):{spec:GitHostSpec;digest:string}{this.safe();if(!ID.test(id))throw new Error('Provedor inválido.');const file=join(this.directory,id+'.json'),s=lstatSync(file);if(s.isSymbolicLink()||!s.isFile()||s.size>256*1024)throw new Error('Arquivo de provedor inválido.');const bytes=readFileSync(file),p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))as GitHostSpec;if(!valid(p)||p.id!==id)throw new Error('Definição inválida.');return{spec:p,digest:createHash('sha256').update(bytes).digest('hex')}}
 list():GitHostView[]{
  this.safe();if(!existsSync(this.directory))return[]
  return readdirSync(this.directory).filter(n=>/^[a-z][a-z0-9-]*\.json$/.test(n)).map(file=>{
   const id=file.slice(0,-5),builtin=BUILTIN.find(p=>p.id===id);let digest:string|undefined
   try{
    const path=join(this.directory,file),stat=lstatSync(path)
    if(stat.isSymbolicLink()||!stat.isFile()||stat.size>256*1024)throw new Error('invalid')
    const bytes=readFileSync(path);digest=createHash('sha256').update(bytes).digest('hex')
    const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))as GitHostSpec
    if(raw.schemaVersion>1)return{id,name:typeof raw.name==='string'?raw.name:id,state:'requiresNewVersion' as const,digest,integrated:!!builtin,problem:'Requer uma versão mais recente.'}
    const{spec:p,digest:current}=this.load(id),account=this.accounts.get(id)
    return{id,name:p.name,command:p.command,digest:current,integrated:!!builtin,state:!builtin?'custom' as const:p.revision<builtin.revision?'outOfDate' as const:canonical(p)===canonical(builtin)?'bundled' as const:'modified' as const,...(account?.digest===current?{account:account.result}:{})}
   }catch{return{id,name:id,state:'invalid' as const,digest,integrated:!!builtin,problem:'Definição inválida; arquivo preservado.'}}
  }).sort((a,b)=>a.name.localeCompare(b.name))
 }
 missing():string[]{return BUILTIN.filter(p=>!existsSync(join(this.directory,p.id+'.json'))).map(p=>p.id)}
 private write(p:GitHostSpec):void{this.safe();mkdirSync(this.directory,{recursive:true,mode:0o700});const file=join(this.directory,p.id+'.json'),tmp=file+'.'+randomUUID()+'.tmp';try{writeFileSync(tmp,JSON.stringify(p,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,file)}finally{rmSync(tmp,{force:true})}this.accounts.delete(p.id)}
 restoreMissing():void{this.safe();for(const p of BUILTIN)if(!existsSync(join(this.directory,p.id+'.json')))this.write(p)}
 restore(id:string,digest:string):void{const p=BUILTIN.find(p=>p.id===id);if(!p)throw new Error('Somente provedores integrados podem ser restaurados.');this.safe();const file=join(this.directory,id+'.json'),stat=lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>256*1024)throw new Error('Arquivo não pode ser restaurado automaticamente.');const current={digest:createHash('sha256').update(readFileSync(file)).digest('hex')};if(typeof digest!=='string'||current.digest!==digest)throw new Error('O arquivo mudou após abrir a confirmação. Recarregue e tente novamente.');this.write(p)}
 reload():void{this.accounts.clear();this.list()}
 async check(id:string):Promise<NonNullable<GitHostView['account']>>{let digest='';let result:NonNullable<GitHostView['account']>;try{const p=this.load(id);digest=p.digest;await this.run(p.spec.command,p.spec.whoamiArgs);result={state:'connected'}}catch(error){const code=(error as{code?:unknown}).code;result=code===1?{state:'disconnected',detail:'A CLI não está autenticada.'}:{state:'unknown',detail:code==='ENOENT'?'CLI não encontrada. Instale-a e verifique novamente.':'Não foi possível verificar a conta pela CLI.'}}this.accounts.set(id,{digest,result});return result}
 /** Um pull request do repositório de `cwd`, pelo número, `#número` ou link. */
 pullRequest(cwd:string,reference:string):Promise<PullRequestDetails>{return viewPullRequest(this.list().filter(v=>['bundled','modified','outOfDate','custom'].includes(v.state)).map(v=>this.load(v.id).spec),this.run,cwd,reference)}
 async pullRequests(cwd:string,providerId?:string):Promise<PullRequest[]>{
  const available=this.list().filter(v=>['bundled','modified','outOfDate','custom'].includes(v.state)).map(v=>this.load(v.id).spec);let candidates=providerId?available.filter(p=>p.id===providerId):available
  if(!providerId){let host:string|undefined;try{const remote=(await this.run('git',['remote','get-url','origin'],cwd)).trim();try{host=new URL(remote).hostname}catch{host=/^(?:[^@\s]+@)?([^:\s]+):/.exec(remote)?.[1]}}catch{}if(host)candidates=available.filter(p=>p.hosts.includes(host!.toLowerCase()))}
  for(const p of candidates){try{const raw:unknown=JSON.parse(await this.run(p.command,p.listArgs,cwd));if(!Array.isArray(raw))throw new Error('invalid');const list:PullRequest[]=[];for(const item of raw){if(!item||typeof item!=='object')continue;const v=item as Record<string,unknown>,number=p.protocol==='gitlab'?v.iid:v.number,title=v.title,state=v.state,updatedAt=v.updatedAt??v.updated_at,url=v.url??v.web_url??v.html_url;if(typeof number!=='number'||!Number.isSafeInteger(number)||typeof title!=='string'||typeof state!=='string'||typeof updatedAt!=='string'||typeof url!=='string')continue;try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)continue}catch{continue}list.push({number,title:title.slice(0,500),state:state.toUpperCase(),updatedAt,url})}return list}catch{/* another configured host may match; raw output is never retained */}}
  throw new Error('Nenhum provedor de pull requests disponível para este repositório.')
 }
}
