import type { CanvasNode, Connection, FloorId, Vec } from '../../../shared/model'
import { circuitPath, circuitPoints, ropeObstacles } from './screen-options'
import type { Preferences } from '../../../shared/preferences'
import { closestEdgePin, closestEdgePins, createRope, ropePath, stepRope, wakeRope, type Rope, type RopeFrame } from './rope'

export const PREVIEW_ROPE_ID = '@cursor'
interface Layout { frame: RopeFrame; floor: FloorId; obstacle: boolean }
export interface RopeEntry { rope: Rope; from: string; to: string | null; floor: FloorId }
interface Box { left: number; top: number; right: number; bottom: number }
const bounds = (f: RopeFrame, margin = 0): Box => ({ left: f.pos.x - margin, top: f.pos.y - margin, right: f.pos.x + f.size.w + margin, bottom: f.pos.y + f.size.h + margin })
const sameFrame = (a: RopeFrame, b: RopeFrame): boolean => a.pos.x === b.pos.x && a.pos.y === b.pos.y && a.size.w === b.size.w && a.size.h === b.size.h
function intersects(a: Vec, b: Vec, box: Box): boolean {
  let low = 0, high = 1
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.left, box.right], [a.y, b.y - a.y, box.top, box.bottom]]) {
    if (delta === 0) { if (start! < min! || start! > max!) return false; continue }
    const from = (min! - start!) / delta!, to = (max! - start!) / delta!
    low = Math.max(low, Math.min(from, to)); high = Math.min(high, Math.max(from, to))
    if (low > high) return false
  }
  return true
}
function touches(rope: Rope, frame: RopeFrame): boolean {
  const box = bounds(frame, 80)
  return rope.points.some((p, i) => i > 0 && intersects(rope.points[i - 1]!, p, box))
}

/** Índice de cards: atualizado só para frames que mudaram; query por corda acordada. */
class ObstacleGrid {
  private cells = new Map<string, Set<string>>()
  private keys = new Map<string, string[]>()
  private large = new Set<string>()
  private cellKeys(box: Box): string[] | null {
    const x0 = Math.floor(box.left / 256), x1 = Math.floor(box.right / 256), y0 = Math.floor(box.top / 256), y1 = Math.floor(box.bottom / 256)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return null
    const keys: string[] = []
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x}:${y}`)
    return keys
  }
  remove(id: string): void {
    for (const key of this.keys.get(id) ?? []) { const bucket = this.cells.get(key)!; bucket.delete(id); if (!bucket.size) this.cells.delete(key) }
    this.keys.delete(id); this.large.delete(id)
  }
  put(id: string, frame: RopeFrame): void {
    this.remove(id)
    const keys = this.cellKeys(bounds(frame, 20))
    if (!keys) { this.large.add(id); return }
    this.keys.set(id, keys)
    for (const key of keys) { const bucket = this.cells.get(key) ?? new Set<string>(); bucket.add(id); this.cells.set(key, bucket) }
  }
  query(rope: Rope): Set<string> {
    const points = rope.points
    const keys = this.cellKeys({ left: Math.min(...points.map(p => p.x)) - 20, top: Math.min(...points.map(p => p.y)) - 20, right: Math.max(...points.map(p => p.x)) + 20, bottom: Math.max(...points.map(p => p.y)) + 20 })
    const ids = new Set(this.large)
    if (!keys) { for (const id of this.keys.keys()) ids.add(id) }
    else for (const key of keys) for (const id of this.cells.get(key) ?? []) ids.add(id)
    return ids
  }
}

/** Geometria e simulação persistem entre renders; nenhum snapshot é serializado no caminho quente. */
export class RopeScene {
  readonly entries = new Map<string, RopeEntry>()
  private layout = new Map<string, Layout>()
  private grid = new ObstacleGrid()
  private reduced = false
  private routing: Preferences['ropeRouting'] = 'avoidNodes'

  /** Estilo das conexões (Configurações › Tela). Trocar acorda as cordas para reassentarem no novo estilo. */
  setRouting(routing: Preferences['ropeRouting']): void {
    if (this.routing === routing) return
    this.routing = routing
    for (const entry of this.entries.values()) wakeRope(entry.rope)
  }

  setReduced(reduced: boolean): void {
    if (this.reduced === reduced) return
    this.reduced = reduced
    for (const entry of this.entries.values()) {
      if (reduced) { entry.rope = createRope(entry.rope.a, entry.rope.b); entry.rope.sleeping = true }
      else wakeRope(entry.rope)
    }
  }
  synchronize(nodes: Record<string, CanvasNode>, connections: Connection[], frames: Record<string, RopeFrame>): void {
    const changed: Layout[] = [], next = new Map<string, Layout>()
    for (const node of Object.values(nodes)) {
      const frame = frames[node.id] ?? node, before = this.layout.get(node.id)
      const value: Layout = { frame: { pos: { ...frame.pos }, size: { ...frame.size } }, floor: node.floorId, obstacle: node.kind !== 'band' }
      next.set(node.id, value)
      if (before && before.floor === value.floor && before.obstacle === value.obstacle && sameFrame(before.frame, value.frame)) continue
      if (before?.obstacle) changed.push(before)
      if (value.obstacle) { changed.push(value); this.grid.put(node.id, value.frame) } else this.grid.remove(node.id)
    }
    for (const [id, before] of this.layout) if (!next.has(id)) { if (before.obstacle) changed.push(before); this.grid.remove(id) }
    this.layout = next
    const live = new Set<string>()
    for (const c of connections) {
      const from = next.get(c.a), to = next.get(c.b)
      if (!from || !to || from.floor !== to.floor) continue
      live.add(c.id)
      const pins = closestEdgePins(from.frame, to.frame)
      let entry = this.entries.get(c.id)
      if (!entry) { entry = { rope: createRope(pins.a, pins.b), from: c.a, to: c.b, floor: from.floor }; this.entries.set(c.id, entry) }
      entry.from = c.a; entry.to = c.b; entry.floor = from.floor
      this.pin(entry, pins.a, pins.b)
      if (!this.reduced && changed.some(card => card.floor === entry.floor && touches(entry.rope, card.frame))) wakeRope(entry.rope)
    }
    for (const id of this.entries.keys()) if (id !== PREVIEW_ROPE_ID && !live.has(id)) this.entries.delete(id)
  }
  private pin(entry: RopeEntry, a: Vec, b: Vec): void {
    if (this.reduced) {
      if (entry.rope.a.x !== a.x || entry.rope.a.y !== a.y || entry.rope.b.x !== b.x || entry.rope.b.y !== b.y) entry.rope = createRope(a, b)
      entry.rope.sleeping = true
    } else stepRope(entry.rope, a, b, 0)
  }
  setPreview(source: string, frame: RopeFrame, cursor: Vec): void {
    const a = closestEdgePin(frame, cursor)
    let entry = this.entries.get(PREVIEW_ROPE_ID)
    if (!entry || entry.from !== source) { entry = { from: source, to: null, floor: null, rope: createRope(a, cursor) }; this.entries.set(PREVIEW_ROPE_ID, entry) }
    this.pin(entry, a, cursor)
  }
  clearPreview(): void { this.entries.delete(PREVIEW_ROPE_ID) }
  /** A corda como polilinha no mundo (para acertar cliques): a simulação, ou os 4 pontos do circuito. */
  polyline(id: string): Vec[] {
    const rope = this.entries.get(id)?.rope
    if (!rope) return []
    return this.routing === 'circuit' ? circuitPoints(rope.a, rope.b) : rope.points.map(p => ({ x: p.x, y: p.y }))
  }
  path(id: string, pins?: { a: Vec; b: Vec }): string {
    if (this.routing === 'circuit') {
      const rope = this.entries.get(id)?.rope
      const ends = pins ?? (rope && { a: rope.a, b: rope.b })
      return ends ? circuitPath(ends.a, ends.b) : ''
    }
    const rope = this.entries.get(id)?.rope
    if (!rope) return pins ? ropePath(createRope(pins.a, pins.b)) : ''
    if (!pins) return ropePath(rope)
    if (this.reduced) return ropePath(createRope(pins.a, pins.b))
    // Só projeta os novos pins no render; o interior continua sendo a simulação existente.
    const points = [...rope.points]
    points[0] = { ...points[0]!, ...pins.a }; points[points.length - 1] = { ...points.at(-1)!, ...pins.b }
    return ropePath({ ...rope, points })
  }
  advance(dt: number): boolean {
    for (const [id, entry] of this.entries) {
      if (entry.rope.sleeping) continue
      const obstacles: RopeFrame[] = []
      if (id !== PREVIEW_ROPE_ID) for (const nodeId of this.grid.query(entry.rope)) {
        const card = this.layout.get(nodeId)
        if (card && nodeId !== entry.from && nodeId !== entry.to && card.floor === entry.floor) obstacles.push(card.frame)
      }
      stepRope(entry.rope, entry.rope.a, entry.rope.b, dt, { obstacles: ropeObstacles(this.routing, obstacles) })
    }
    return this.awake
  }
  get awake(): boolean { return !this.reduced && [...this.entries.values()].some(entry => !entry.rope.sleeping) }
}
