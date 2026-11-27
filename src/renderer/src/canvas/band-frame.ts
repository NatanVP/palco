import type { Size, Vec } from '../../../shared/model'

/** Retângulo que envolve os membros de uma banda com folga em volta; `null` quando não há membros. */
export function bandFrame(members: Array<{ pos: Vec; size: Size }>, pad = 40): { pos: Vec; size: Size } | null {
  if (members.length === 0) return null
  const left = Math.min(...members.map((m) => m.pos.x))
  const top = Math.min(...members.map((m) => m.pos.y))
  const right = Math.max(...members.map((m) => m.pos.x + m.size.w))
  const bottom = Math.max(...members.map((m) => m.pos.y + m.size.h))
  return { pos: { x: left - pad, y: top - pad }, size: { w: right - left + 2 * pad, h: bottom - top + 2 * pad } }
}
