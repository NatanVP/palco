import type { AgentUsage, UsageWindow } from '../../shared/model'
import { type Runner } from './providers'
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'?v as Record<string,unknown>:{}
/** Independent parser for agy's /usage JSON. No authentication payload is retained. */
export async function queryAntigravityUsage(_home:string,_options:{run:Runner;timeoutMs:number}):Promise<AgentUsage>{
 // A consulta agy -p /usage não tem garantia de leitura sem consumir cota.
 // Evita consultas automáticas e manuais até existir um transporte sem inferência garantido.
 return {agent:'antigravity',source:'CLI Antigravity: /usage',providerId:'antigravity',error:'Leitura automática indisponível para esta CLI.'}
}
/** Parse captured/test payloads only; this function never launches a CLI. */
export function parseAntigravityUsage(payload:unknown):AgentUsage{
 const base:AgentUsage={agent:'antigravity',source:'CLI Antigravity: /usage',providerId:'antigravity'}
 try{
  const response=object(payload)
  if(response.status!=='SUCCESS')throw new Error('query')
  const groups=object(object(response.command).data).groups
  if(!Array.isArray(groups))throw new Error('groups')
  const meters:NonNullable<AgentUsage['meters']>=[]
  for(const group of groups.slice(0,50)){
   const g=object(group);if(!Array.isArray(g.buckets)||typeof g.name!=='string')continue
   const windows:Array<UsageWindow&{name:string}>=[]
   for(const bucket of g.buckets.slice(0,20)){
    const b=object(bucket),fraction=b.remaining_fraction
    if(typeof fraction!=='number'||!Number.isFinite(fraction)||fraction<0||fraction>1)continue
    windows.push({name:typeof b.window==='string'?b.window.slice(0,100):'',usedPercent:(1-fraction)*100,resetsAt:typeof b.reset_time==='string'&&Number.isFinite(Date.parse(b.reset_time))?b.reset_time:null})
   }
   if(windows.length)meters.push({name:g.name.slice(0,120),windows})
  }
  if(!meters.length)throw new Error('empty')
  // The compact ring uses the most consumed model group's windows; all groups remain available in the snapshot.
  const windows=meters.reduce((best,m)=>Math.max(...m.windows.map(w=>w.usedPercent))>Math.max(...best.map(w=>w.usedPercent))?m.windows:best,meters[0]!.windows)
  return {...base,meters,session:windows[0],...(windows[1]?{weekly:windows[1]}:{}),readAt:new Date().toISOString()}
 }catch{return {...base,error:'Não foi possível consultar o Antigravity; confira a CLI e o login.'}}
}
