import type { CanvasNode } from '../../../shared/model'
import { t } from '../i18n'

export interface SearchEntry { kind: 'node' | 'workspace' | 'command'; id: string; label: string; hint?: string; active?: boolean }
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** O índice do Batuta Search: elementos do andar, espaços de trabalho e comandos, nessa ordem. */
export function searchEntries(src: { nodes: readonly CanvasNode[]; workspaces: ReadonlyArray<{ id: string; name: string; active: boolean }>; commands: ReadonlyArray<{ id: string; label: string; hint?: string }> }): SearchEntry[] {
  return [
    ...src.nodes.map((n): SearchEntry => ({ kind: 'node', id: n.id, label: n.name, hint: n.kind === 'terminal' ? n.agent : n.kind })),
    ...src.workspaces.map((w): SearchEntry => ({ kind: 'workspace', id: w.id, label: w.name, hint: t('search.search-index.espaco_de_trabalho'), active: w.active })),
    ...src.commands.map((c): SearchEntry => ({ kind: 'command', id: c.id, label: c.label, ...(c.hint ? { hint: c.hint } : {}) }))
  ]
}
/** Sem acento nem caixa; quem começa com o texto vem antes de quem só contém. O prefixo `>` restringe aos comandos. */
export function filterSearch(entries: readonly SearchEntry[], query: string): SearchEntry[] {
  const commandsOnly = query.trimStart().startsWith('>'), q = fold(commandsOnly ? query.trimStart().slice(1) : query).trim()
  const pool = commandsOnly ? entries.filter(e => e.kind === 'command') : entries
  if (!q) return [...pool]
  const rank = (e: SearchEntry): number => { const l = fold(e.label); return l.startsWith(q) ? 0 : l.split(/\s+/).some(w => w.startsWith(q)) ? 1 : l.includes(q) ? 2 : 3 }
  return pool.map((e, i) => ({ e, i, r: rank(e) })).filter(x => x.r < 3).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.e)
}
