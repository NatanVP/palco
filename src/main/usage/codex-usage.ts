import type { AgentUsage, UsageWindow } from '../../shared/model'
import { epochIso, freshWindow, readTail, recentFiles } from './files'

const TAIL_BYTES = 256 * 1024

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Procura a chave `rate_limits` em qualquer nível do evento. */
function findRateLimits(v: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!record(v) || depth > 4) return undefined
  if (record(v.rate_limits)) return v.rate_limits
  for (const child of Object.values(v)) {
    const found = findRateLimits(child, depth + 1)
    if (found) return found
  }
  return undefined
}

const window = (w: unknown): UsageWindow | undefined =>
  record(w) && typeof w.used_percent === 'number' ? freshWindow(w.used_percent, epochIso(w.resets_at)) : undefined

/**
 * Uso do Codex: o último `rate_limits` registrado nos logs de sessão (`~/.codex/sessions/**\/*.jsonl`).
 * `primary` = janela de 5 h, `secondary` = semanal. Sem credenciais.
 */
export async function readCodexUsage(sessionsDir: string): Promise<AgentUsage> {
  for (const file of await recentFiles(sessionsDir, '.jsonl', 8)) {
    let tail: string
    try { tail = await readTail(file.path, TAIL_BYTES) } catch { continue }
    const lines = tail.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!
      if (!line.includes('rate_limits')) continue
      let parsed: unknown
      try { parsed = JSON.parse(line) } catch { continue }
      const rl = findRateLimits(parsed)
      if (!rl) continue
      const session = window(rl.primary), weekly = window(rl.secondary)
      if (!session && !weekly) continue
      return {
        agent: 'codex', source: 'logs de sessão do Codex', readAt: new Date(file.mtimeMs).toISOString(),
        ...(typeof rl.plan_type === 'string' ? { plan: rl.plan_type } : {}),
        ...(session ? { session } : {}), ...(weekly ? { weekly } : {})
      }
    }
  }
  return { agent: 'codex', source: 'logs de sessão do Codex', error: 'sem sessão recente do Codex' }
}
