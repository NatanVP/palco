import { readFile } from 'node:fs/promises'
import type { AgentUsage, UsageWindow } from '../../shared/model'
import { epochIso, freshWindow, recentFiles } from './files'

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const window = (w: unknown): UsageWindow | undefined =>
  record(w) && typeof w.used_percentage === 'number' ? freshWindow(w.used_percentage, epochIso(w.resets_at)) : undefined

/**
 * Uso do Claude Code: lê os registros da statusline gravados por terminal em `dir`
 * e usa o arquivo mais recente que contenha `rate_limits`.
 */
export async function readClaudeUsage(dir: string): Promise<AgentUsage> {
  for (const file of await recentFiles(dir, '.json', 50)) {
    let parsed: unknown
    try { parsed = JSON.parse(await readFile(file.path, 'utf8')) } catch { continue }
    if (!record(parsed) || !record(parsed.rate_limits)) continue
    const session = window(parsed.rate_limits.five_hour), weekly = window(parsed.rate_limits.seven_day)
    if (!session && !weekly) continue
    return {
      agent: 'claude', source: 'statusline do Claude Code (terminais do palco)', readAt: new Date(file.mtimeMs).toISOString(),
      ...(session ? { session } : {}), ...(weekly ? { weekly } : {})
    }
  }
  return { agent: 'claude', source: 'statusline do Claude Code (terminais do palco)', error: 'ainda sem leitura: abra um Claude pelo palco e mande uma mensagem' }
}
