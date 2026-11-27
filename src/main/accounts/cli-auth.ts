import { createUsageRunner } from '../usage/runner'
import type { Runner } from '../usage/providers'
import { lstatSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { Account } from '../../shared/model'
import type { ProviderSpec } from '../../shared/providers'
import { minimalUsageEnv } from '../usage/providers'
export interface AccountStatus { connected: boolean; email?: string; plan?: string }
/** Strict allowlist; no raw authentication output crosses IPC or enters storage. */
export function parseAccountStatus(stdout: string, stderr = ''): AccountStatus {
 try {
  const o = JSON.parse(stdout) as Record<string, unknown>
  if (o && typeof o === 'object') {
   const connected = o.loggedIn === true || o.authenticated === true
   const text = (v: unknown) => typeof v === 'string' && v.length <= 254 && !/[\x00-\x1f]/.test(v) ? v : undefined
   const email = connected ? text(o.email) : undefined, plan = connected ? text(o.subscriptionType ?? o.plan) : undefined
   return {connected, ...(email ? {email} : {}), ...(plan ? {plan} : {})}
  }
 } catch {}
 return {connected: /logged in|authenticated/i.test(stdout+'\n'+stderr) && !/not logged in|unauthenticated/i.test(stdout+'\n'+stderr)}
}
/** Never logs or returns raw CLI output. Auth files remain owned by the CLI. */
export function accountCommand(account: Account, provider: ProviderSpec, kind: 'status' | 'logout', statusRunner?: Runner): Promise<boolean | AccountStatus> {
 if(kind==='status'&&provider.id==='codex'&&provider.usage==='codex'){
  const owned=statusRunner?undefined:createUsageRunner(),run=statusRunner??owned!
  return run(provider.command,['app-server','--stdio'],{...minimalUsageEnv(),[provider.configEnv]:account.configDir},[
   JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'palco',title:'Palco',version:'1'}}}),JSON.stringify({method:'initialized'}),JSON.stringify({id:2,method:'account/read',params:{refreshToken:false}})
  ],v=>!!v&&typeof v==='object'&&(v as {id?:unknown}).id===2,20000).then(v=>{
   const frame=v as {error?:unknown;result?:{account?:{type?:string;email?:unknown;planType?:unknown}|null}}
   if(!frame||frame.error||!frame.result)throw new Error('Falha na autenticação pela CLI.')
   const identity=frame.result.account
   return parseAccountStatus(JSON.stringify({loggedIn:identity!==null&&identity!==undefined,email:identity?.email,plan:identity?.planType}))
  }).finally(()=>owned?.dispose())
 }
 if(provider.agent==='antigravity'){const token=join(account.configDir,'.gemini','antigravity-cli','antigravity-oauth-token');try{for(const dir of [account.configDir,join(account.configDir,'.gemini'),join(account.configDir,'.gemini','antigravity-cli')]){try{if(lstatSync(dir).isSymbolicLink())throw new Error('Diretório de conta não pode ser link.')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}}if(kind==='logout'){rmSync(token,{force:true});return Promise.resolve(true)}try{return Promise.resolve({connected:lstatSync(token).isFile()})}catch{return Promise.resolve({connected:false})}}catch{return Promise.reject(new Error('Não foi possível verificar a pasta da conta.'))}}
 return new Promise((resolve,reject) => execFile(provider.command,kind === 'status' ? provider.statusArgs : provider.logoutArgs,{cwd:tmpdir(),env:{...minimalUsageEnv(),[provider.configEnv]:account.configDir},timeout:60000,maxBuffer:65536},(error,stdout,stderr) => {
  if (error) { if (kind === 'status' && (error as { code?: unknown }).code === 1) resolve(false); else reject(new Error('Falha na autenticação pela CLI.')); return }
  if (kind === 'logout') { resolve(true); return }
  resolve(parseAccountStatus(stdout,stderr))
 }))
}
