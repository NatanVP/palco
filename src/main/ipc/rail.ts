import type { IpcArea } from './area'

export const RAIL_CH = { terminals: 'palco:rail:terminals', attention: 'palco:rail:attention' } as const
/** Trilho de workspaces: os terminais de um workspace (lista ao segurar o item) e quantos avisos cada um tem (selo). */
export const railArea: IpcArea = ({ handle, deps }) => {
  handle(RAIL_CH.terminals, id => {
    if (typeof id !== 'string') throw new Error('workspace inválido')
    return Object.values(deps.registry.get(id).get().nodes).filter(n => n.kind === 'terminal').map(n => ({ id: n.id, name: n.name, agent: (n as { agent: string }).agent }))
  })
  handle(RAIL_CH.attention, () => {
    const ids = new Set(deps.chat?.attentionIds() ?? []), out: Record<string, number> = {}
    if (!ids.size) return out
    for (const w of deps.registry.sidebar().workspaces) {
      let n = 0
      for (const t of deps.registry.get(w.id).terminalIds()) if (ids.has(t)) n++
      if (n) out[w.id] = n
    }
    return out
  })
}
