import { queryAntigravityUsage } from './antigravity-usage'
import type { Account, AgentUsage, UsageWindow } from '../../shared/model'
import type { ProviderLibrary } from '../providers/provider-library'
import { minimalUsageEnv, queryClaudeUsage, queryCodexUsage, type Runner } from './providers'
export async function queryProviderUsage(account: Account, providers: ProviderLibrary, runner: Runner): Promise<AgentUsage> {
 const p = providers.get(account.providerId ?? account.agent), base: AgentUsage = { agent: account.agent, source: p?.name ?? 'Provedor indisponível', providerId: p?.id }
 if (!p) return { ...base, error: 'Provedor desativado ou indisponível.' }
 if(p.usage==='antigravity'){const run:Runner=(_cmd,args,env,lines,until,timeout)=>runner(p.command,args,env,lines,until,timeout);return {...await queryAntigravityUsage(account.configDir,{run,timeoutMs:90000}),providerId:p.id}}
 if (p.usage !== 'json') {
  const run: Runner = (_cmd,args,env,lines,until,timeout) => runner(p.command,args,{...env,[p.configEnv]:account.configDir},lines,until,timeout)
  return { ...await (p.usage === 'claude' ? queryClaudeUsage : queryCodexUsage)(account.configDir,{run,timeoutMs: p.usage === 'claude' ? 30_000 : 60_000}), providerId:p.id }
 }
 try {
  const result = await runner(p.command,p.usageArgs ?? [],{...minimalUsageEnv(),[p.configEnv]:account.configDir},[],v => !!v && typeof v === 'object' && ['session','weekly','error'].some(k => Object.hasOwn(v,k)),15000) as Record<string, unknown> | null
  if (!result || result.error) throw new Error('provider')
  const window = (value: unknown): UsageWindow | undefined => {
   if (!value || typeof value !== 'object') return undefined
   const v = value as Record<string,unknown>; if (typeof v.usedPercent !== 'number' || !Number.isFinite(v.usedPercent) || v.usedPercent < 0) return undefined
   return { usedPercent: v.usedPercent, resetsAt: typeof v.resetsAt === 'string' && Number.isFinite(Date.parse(v.resetsAt)) ? v.resetsAt : null }
  }
  const session = window(result.session), weekly = window(result.weekly); if (!session && !weekly) throw new Error('provider')
  return { ...base, ...(session ? { session } : {}), ...(weekly ? { weekly } : {}), readAt: new Date().toISOString() }
 } catch { return { ...base, error: 'Não foi possível consultar este provedor; confira a CLI e o login.' } }
}
