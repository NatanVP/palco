import type { CanvasNode, Connection, Size, Vec } from '../../../../shared/model'

type Placed = { id: string; pos: Vec; size?: Size }
/** Ordem de leitura: linha por linha (faixas pela metade da altura mais comum), da esquerda para a direita. */
export function spatialOrder<T extends Placed>(nodes: readonly T[]): T[] {
  const band = 120
  return [...nodes].sort((a, b) => Math.floor(a.pos.y / band) - Math.floor(b.pos.y / band) || a.pos.x - b.pos.x || a.pos.y - b.pos.y)
}

/** Próximo (1) ou anterior (-1) da lista, em círculo. Sem atual, começa pelo primeiro (ou pelo último). */
export function cycleId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (!ids.length) return null
  const i = current === null ? -1 : ids.indexOf(current)
  if (i < 0) return dir === 1 ? ids[0]! : ids[ids.length - 1]!
  return ids[(i + dir + ids.length) % ids.length]!
}

/** Os elementos ligados a `anchor` por uma corda, do mesmo andar, em ordem espacial. */
export function connectedOrder(nodes: readonly CanvasNode[], connections: readonly Connection[], anchor: string): string[] {
  const byId = new Map(nodes.map(n => [n.id, n])), self = byId.get(anchor)
  if (!self) return []
  const peers = new Set<string>()
  for (const c of connections) {
    const other = c.a === anchor ? c.b : c.b === anchor ? c.a : null
    const node = other === null ? undefined : byId.get(other)
    if (node && node.floorId === self.floorId) peers.add(node.id)
  }
  return spatialOrder([...peers].map(id => byId.get(id)!)).map(n => n.id)
}
