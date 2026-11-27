import{clipboard,dialog,shell}from'electron'
import{existsSync,writeFileSync}from'node:fs'
import{dirname,join}from'node:path'
import{mt}from'../i18n'
import type{IpcArea}from'./area'
import type{GitHosts}from'../git-hosts/git-hosts'
import type{Diagnostics}from'../diagnostics'
import{ABOUT_CH as A,GIT_HOSTS_CH as G}from'../../shared/about-git'
interface Services{git:GitHosts;diagnostics:Diagnostics;version:string;contact:string|null}
const services=new WeakMap<object,Services>();export function attachAboutGit(registry:object,value:Services):()=>void{services.set(registry,value);return()=>{services.delete(registry)}}
const id=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>200)throw new Error('Identificador inválido.');return v}
export const aboutGitArea:IpcArea=({handle,send,deps})=>{
 const get=()=>{const s=services.get(deps.registry);if(!s)throw new Error('Diagnóstico indisponível.');return s}
 handle(A+'info',()=>({version:get().version,contact:get().contact,onboardingCompleted:get().diagnostics.onboardingCompleted()}));handle(A+'report',()=>get().diagnostics.report());handle(A+'openContact',async()=>{const contact=get().contact;if(!contact)throw new Error('Contato público não definido.');let url:URL;try{url=new URL(contact)}catch{throw new Error('Contato inválido.')}if(!['mailto:','https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Contato inválido.');await shell.openExternal(contact)})
 // O Electron traz, ao lado do executável, o aviso do Chromium, do Node.js e do que vem com eles.
 handle(A+'openRuntimeLicenses',async()=>{const file=join(dirname(process.execPath),'LICENSES.chromium.html');if(!existsSync(file)||await shell.openPath(file))throw new Error('Não foi possível abrir o arquivo de licenças.')})
 handle(A+'saveReport',async()=>{const r=await dialog.showSaveDialog({title:mt('Baixar diagnóstico'),defaultPath:'palco-diagnostico.txt',filters:[{name:mt('Texto'),extensions:['txt']}]});if(r.canceled||!r.filePath)return false;writeFileSync(r.filePath,get().diagnostics.report(),{mode:0o600});return true})
 handle(A+'completeOnboarding',()=>get().diagnostics.completeOnboarding());handle(A+'reopenOnboarding',()=>{get().diagnostics.reopenOnboarding();send(A+'onboarding')})
 handle(G+'state',()=>({directory:get().git.directory,providers:get().git.list(),missing:get().git.missing()}));handle(G+'check',value=>get().git.check(id(value)))
 handle(G+'restore',(value,digest)=>get().git.restore(id(value),id(digest)));handle(G+'restoreMissing',()=>get().git.restoreMissing())
 handle(G+'reload',async()=>{get().git.reload();for(const p of get().git.list())if(p.digest)await get().git.check(p.id)})
 handle(G+'showFolder',async()=>{get().git.ensure();if(await shell.openPath(get().git.directory))throw new Error('Não foi possível abrir a pasta.')});handle(G+'copyPath',()=>clipboard.writeText(get().git.directory))
}
