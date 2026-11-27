import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentUsage, UsageWindow } from '../../shared/model'

/**
 * O probe roda com a configuração da conta, mas sem os hooks nem os MCP dela: um SessionStart (ex.: ai-memory)
 * consumiria handoffs e registraria sessões fantasmas a cada consulta. Verificado em 2026-11-24 com um hook
 * marcador: sem isto ele roda, com isto não, e o get_usage continua respondendo. `--bare` não serve (não lê OAuth).
 */
const CLAUDE_PROBE_ISOLATION = ['--settings', JSON.stringify({ disableAllHooks: true }), '--strict-mcp-config']

export type Runner = (cmd: string, args: string[], env: Record<string, string>, stdinLines: string[], until: (line: unknown) => boolean, timeoutMs: number) => Promise<unknown | null>
export interface QueryOptions { run: Runner; timeoutMs: number }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function minimalUsageEnv(inherited: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = { HOME: homedir(), TERM: 'dumb', NO_COLOR: '1' }
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'SSH_AUTH_SOCK']) if (inherited[key]) env[key] = inherited[key]!
  env.PATH = [env.PATH, join(env.HOME!, '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':')
  env.LANG ??= 'en_US.UTF-8'
  return env
}
function window(value: unknown, percent: string, reset: string, epoch: boolean): UsageWindow | undefined {
  const w = obj(value), used = w[percent]
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return undefined
  const raw = w[reset]
  const time = epoch && (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) ? Number(raw) * 1000 : typeof raw === 'string' ? Date.parse(raw) : NaN
  return { usedPercent: used, resetsAt: Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? new Date(time).toISOString() : null }
}
function errorText(agent: string, e: unknown): string {
  const code = obj(e).code
  if (code === 'ENOENT') return `${agent} não encontrado`
  if (code === 'ETIMEDOUT') return 'tempo esgotado ao consultar uso'
  if (code === 'notSignedIn' || code === 401) return `faça login no ${agent}`
  return `não foi possível consultar uso do ${agent}; confira o login e a versão do CLI`
}
export async function queryClaudeUsage(configDir: string, opts: QueryOptions): Promise<AgentUsage> {
  const base: AgentUsage = { agent: 'claude', source: 'CLI Claude: get_usage' }
  try {
    const frame = obj(await opts.run('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', ...CLAUDE_PROBE_ISOLATION], { ...minimalUsageEnv(), CLAUDE_CONFIG_DIR: configDir }, [JSON.stringify({ type: 'control_request', request_id: 'palco-usage', request: { subtype: 'get_usage', skip_behaviors: true } })], line => obj(line).type === 'control_response' && obj(obj(line).response).request_id === 'palco-usage', opts.timeoutMs))
    const response = obj(frame.response)
    if (response.error) throw { code: 'notSignedIn' }
    const data = obj(response.response), limits = obj(data.rate_limits)
    if (data.rate_limits_available === false) return { ...base, error: 'limites de plano indisponíveis para esta conta' }
    const session = window(limits.five_hour, 'utilization', 'resets_at', false), weekly = window(limits.seven_day, 'utilization', 'resets_at', false)
    if (!session && !weekly) return { ...base, error: errorText('Claude', null) }
    return { ...base, ...(typeof data.subscription_type === 'string' ? { plan: data.subscription_type } : {}), ...(session ? { session } : {}), ...(weekly ? { weekly } : {}), readAt: new Date().toISOString() }
  } catch (e) { return { ...base, error: errorText('claude', e) } }
}
export async function queryCodexUsage(codexHome: string, opts: QueryOptions): Promise<AgentUsage> {
  const base: AgentUsage = { agent: 'codex', source: 'CLI Codex: account/rateLimits/read' }
  try {
    const frame = obj(await opts.run('codex', ['app-server', '--stdio'], { ...minimalUsageEnv(), CODEX_HOME: codexHome }, [
      JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'palco', title: 'Palco', version: '1' } } }),
      JSON.stringify({ method: 'initialized' }),
      JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } })
    ], line => obj(line).id === 2, opts.timeoutMs))
    if (frame.error) throw frame.error
    const data = obj(frame.result), limits = obj(data.rateLimits)
    const session = window(limits.primary, 'usedPercent', 'resetsAt', true), weekly = window(limits.secondary, 'usedPercent', 'resetsAt', true)
    if (!session && !weekly) return { ...base, error: errorText('codex', null) }
    return { ...base, ...(typeof limits.planType === 'string' ? { plan: limits.planType } : {}), ...(session ? { session } : {}), ...(weekly ? { weekly } : {}), readAt: new Date().toISOString() }
  } catch (e) { return { ...base, error: errorText('codex', e) } }
}
