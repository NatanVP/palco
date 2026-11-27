import type { CanvasGroup, CanvasNode, FloorId, Workspace } from './model'

/** Um grupo existe (e é desenhado) com dois membros ou mais. */
export const MIN_GROUP = 2
export const MAX_GROUP_NAME = 120
/** A banda é ela mesma uma moldura calculada pelos membros: não entra em grupo. */
export const groupable = (node: CanvasNode): boolean => node.kind !== 'band'

/** Os grupos de um andar, na ordem em que foram criados, cada um com os membros. */
export function floorGroups(ws: Pick<Workspace, 'nodes' | 'groups'>, floorId: FloorId): Array<{ id: string; group: CanvasGroup; members: CanvasNode[] }> {
  return Object.entries(ws.groups ?? {}).flatMap(([id, group]) => {
    const members = Object.values(ws.nodes).filter((n) => n.groupId === id && n.floorId === floorId && groupable(n))
    return members.length >= MIN_GROUP ? [{ id, group, members }] : []
  })
}

/** Tira os grupos que ficaram com menos de dois membros e solta quem aponta para um grupo que não existe. Muda o documento no lugar. */
export function pruneGroups(ws: Pick<Workspace, 'nodes' | 'groups'>): void {
  const nodes = Object.values(ws.nodes)
  const count = new Map<string, number>()
  for (const n of nodes) if (n.groupId !== undefined && groupable(n)) { const key = `${n.groupId}\n${n.floorId}`; count.set(key, (count.get(key) ?? 0) + 1) }
  const groups = ws.groups ?? {}
  for (const n of nodes) {
    if (n.groupId !== undefined && (!Object.hasOwn(groups, n.groupId) || !groupable(n) || count.get(`${n.groupId}\n${n.floorId}`)! < MIN_GROUP)) delete n.groupId
  }
  const used = new Set(nodes.map((n) => n.groupId))
  for (const id of Object.keys(groups)) if (!used.has(id)) delete groups[id]
}
