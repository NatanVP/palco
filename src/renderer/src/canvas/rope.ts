import type { Size, Vec } from '../../../shared/model'

export interface RopeFrame { pos: Vec; size: Size }
interface Particle extends Vec { oldX: number; oldY: number }
export interface Rope {
  points: Particle[]
  restLength: number
  a: Vec
  b: Vec
  slack: number
  accumulator: number
  awakeFor: number
  sleeping: boolean
  movement: number
}
export const ROPE_STEP = 1 / 60
const MAX_STEPS = 4

function edgePins({ pos: p, size: s }: RopeFrame): Vec[] {
  return [{ x: p.x + s.w / 2, y: p.y }, { x: p.x + s.w / 2, y: p.y + s.h },
    { x: p.x, y: p.y + s.h / 2 }, { x: p.x + s.w, y: p.y + s.h / 2 }]
}
export function closestEdgePins(from: RopeFrame, to: RopeFrame): { a: Vec; b: Vec } {
  let distance = Infinity, pair = { a: from.pos, b: to.pos }
  for (const a of edgePins(from)) for (const b of edgePins(to)) {
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    if (d < distance) { distance = d; pair = { a, b } }
  }
  return pair
}
export function closestEdgePin(from: RopeFrame, cursor: Vec): Vec {
  return edgePins(from).reduce((best, p) => Math.hypot(p.x - cursor.x, p.y - cursor.y) < Math.hypot(best.x - cursor.x, best.y - cursor.y) ? p : best)
}
export function createRope(a: Vec, b: Vec, segments = 20, slack = 1.05): Rope {
  const count = Math.max(1, Math.min(128, Math.floor(segments)))
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  const depth = Math.max(distance * .12, 20)
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t + depth * 4 * t * (1 - t)
    return { x, y, oldX: x, oldY: y }
  })
  return { points, a: { ...a }, b: { ...b }, slack, restLength: Math.max(distance * slack, 40), accumulator: 0, awakeFor: 0, sleeping: false, movement: 0 }
}
export function wakeRope(rope: Rope): void { rope.sleeping = false; rope.awakeFor = 0 }

/** Projeção suave para fora dos cards que não são extremos da corda. */
function avoidCard(p: Particle, frame: RopeFrame): void {
  const left = frame.pos.x - 20, right = frame.pos.x + frame.size.w + 20
  const top = frame.pos.y - 20, bottom = frame.pos.y + frame.size.h + 20
  if (p.x < left || p.x > right || p.y < top || p.y > bottom) return
  const distances = [p.x - left, right - p.x, p.y - top, bottom - p.y]
  const side = distances.indexOf(Math.min(...distances))
  let x = p.x, y = p.y
  const nearX = distances[0]! < 30 ? left : distances[1]! < 30 ? right : null
  const nearY = distances[2]! < 30 ? top : distances[3]! < 30 ? bottom : null
  if (nearX !== null && nearY !== null) {
    const length = Math.hypot(p.x - nearX, p.y - nearY)
    if (length > .001) { x = nearX + (p.x - nearX) * 20 / length; y = nearY + (p.y - nearY) * 20 / length }
  } else if (side === 0) x = left
  else if (side === 1) x = right
  else if (side === 2) y = top
  else y = bottom
  p.x += (x - p.x) * .4; p.y += (y - p.y) * .4
}
function pin(p: Particle, at: Vec): void { p.x = p.oldX = at.x; p.y = p.oldY = at.y }

/** Verlet a passo fixo: preserva o interior mesmo em deslocamentos grandes. */
export function stepRope(rope: Rope, a: Vec, b: Vec, dt: number, opts: { gravity?: number; iterations?: number; obstacles?: RopeFrame[] } = {}): number {
  if (a.x !== rope.a.x || a.y !== rope.a.y || b.x !== rope.b.x || b.y !== rope.b.y) wakeRope(rope)
  rope.a = { ...a }; rope.b = { ...b }
  rope.restLength = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * rope.slack)
  const points = rope.points, last = points.length - 1
  pin(points[0]!, a); pin(points[last]!, b)
  if (rope.sleeping) return 0
  rope.accumulator += Math.max(0, Math.min(Number.isFinite(dt) ? dt : ROPE_STEP, MAX_STEPS * ROPE_STEP))
  let steps = 0
  while (rope.accumulator + 1e-12 >= ROPE_STEP && steps < MAX_STEPS) {
    rope.accumulator = Math.max(0, rope.accumulator - ROPE_STEP); steps++
    for (let i = 1; i < last; i++) {
      const p = points[i]!, vx = (p.x - p.oldX) * .965, vy = (p.y - p.oldY) * .965
      p.oldX = p.x; p.oldY = p.y
      p.x += vx; p.y += vy + (opts.gravity ?? 1600) * ROPE_STEP ** 2
    }
    const length = rope.restLength / last
    for (let pass = 0; pass < (opts.iterations ?? 8); pass++) {
      for (let i = 0; i < last; i++) {
        const p = points[i]!, q = points[i + 1]!, dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy)
        if (d < .001) continue
        const correction = (d - length) / d / 2
        if (i > 0) { p.x += dx * correction; p.y += dy * correction }
        if (i + 1 < last) { q.x -= dx * correction; q.y -= dy * correction }
      }
      for (let i = 1; i < last; i++) for (const card of opts.obstacles ?? []) avoidCard(points[i]!, card)
      pin(points[0]!, a); pin(points[last]!, b)
    }
    rope.movement = points.slice(1, last).reduce((sum, p) => sum + Math.abs(p.x - p.oldX) + Math.abs(p.y - p.oldY), 0)
    rope.awakeFor += ROPE_STEP
    if (rope.awakeFor >= .5 && (rope.movement < .5 || rope.awakeFor >= 10)) rope.sleeping = true
  }
  return rope.sleeping ? 0 : rope.movement
}
export function ropePath(rope: Rope): string {
  const points = rope.points
  if (points.length < 2) return ''
  const number = (n: number): string => n.toFixed(2)
  let path = `M ${number(points[0]!.x)} ${number(points[0]!.y)}`
  for (let i = 1; i < points.length; i++) {
    const before = points[Math.max(0, i - 2)]!, start = points[i - 1]!, end = points[i]!, after = points[Math.min(i + 1, points.length - 1)]!
    path += ` C ${number(start.x + (end.x - before.x) / 6)} ${number(start.y + (end.y - before.y) / 6)}, ${number(end.x - (after.x - start.x) / 6)} ${number(end.y - (after.y - start.y) / 6)}, ${number(end.x)} ${number(end.y)}`
  }
  return path
}
