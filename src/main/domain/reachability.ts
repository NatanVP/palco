import type { CanvasNode, ResolveResult, Workspace } from '../../shared/model'

/** Expand band edges (not membership edges); traverse only note-to-note chains. */
export function reachable(ws: Workspace, fromId: string): CanvasNode[] {
  if (!Object.hasOwn(ws.nodes, fromId)) return []
  const floor = ws.nodes[fromId]!.floorId
  const neighbors = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    neighbors.set(a, (neighbors.get(a) ?? new Set()).add(b))
    neighbors.set(b, (neighbors.get(b) ?? new Set()).add(a))
  }
  for (const { a, b } of ws.connections) {
    if (!Object.hasOwn(ws.nodes, a) || !Object.hasOwn(ws.nodes, b)) continue
    const first = ws.nodes[a]!, second = ws.nodes[b]!
    // Entre floors só vale a conexão direta terminal↔terminal do próprio chamador (orquestrador ↔ recrutado).
    if (first.floorId !== second.floorId) {
      if (first.kind === 'terminal' && second.kind === 'terminal' && (a === fromId || b === fromId)) link(a, b)
      continue
    }
    if (first.floorId !== floor || (first.kind === 'band' && second.kind === 'band')) continue
    link(a, b)
    const band = first.kind === 'band' ? first : second.kind === 'band' ? second : undefined
    const other = band?.id === a ? b : a
    if (band) for (const member of band.members) {
      if (!Object.hasOwn(ws.nodes, member)) continue
      const node = ws.nodes[member]!
      if (node.kind === 'terminal' && node.floorId === floor) link(other, member)
    }
  }
  const found = new Set<string>([fromId])
  const notes: string[] = []
  const result: CanvasNode[] = []
  const add = (id: string): void => {
    if (found.has(id)) return
    const node = ws.nodes[id]
    if (!node) return
    found.add(id)
    result.push(node)
    if (node.kind === 'note') notes.push(id)
  }
  for (const id of neighbors.get(fromId) ?? []) add(id)
  for (let i = 0; i < notes.length; i++) {
    for (const id of neighbors.get(notes[i]!) ?? []) {
      if (ws.nodes[id]?.kind === 'note') add(id)
    }
  }
  return result
}

export const LOCAL_PREFIX = 'local:'
/** `local:Nome`: o nome é deste workspace, mesmo que pareça um endereço `Nome @ Workspace`. */
export const localName = (raw: string): string => (raw.startsWith(LOCAL_PREFIX) ? raw.slice(LOCAL_PREFIX.length) : raw)

export function resolveTarget(ws: Workspace, fromId: string, raw: string): ResolveResult {
  const name = localName(raw)
  const nodes = reachable(ws, fromId)
  const exact = nodes.filter(node => node.name === name)
  const matches = exact.length > 0 ? exact : nodes.filter(node => node.name.toLowerCase() === name.toLowerCase())
  if (matches.length === 0) return { ok: false, status: 404, error: 'alvo não encontrado' }
  if (matches.length > 1) return { ok: false, status: 404, error: 'nome ambíguo' }
  const node = matches[0]!
  return { ok: true, node }
}
