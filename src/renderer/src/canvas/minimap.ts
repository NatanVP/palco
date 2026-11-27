import type { Size, Vec } from '../../../shared/model'

export interface Rect { pos: Vec; size: Size }
/** Mundo → minimapa: `p * scale + offset`. */
export interface MinimapTransform { scale: number; offset: Vec }

/** Folga em volta do conteúdo, em pixels do minimapa. */
const PAD = 8

/** Escala e deslocamento para caber todos os nós e a viewport na caixa, centralizados e com margem. */
export function minimapTransform(nodes: Rect[], viewport: Rect, box: Size): MinimapTransform {
  let minX = viewport.pos.x, minY = viewport.pos.y
  let maxX = viewport.pos.x + viewport.size.w, maxY = viewport.pos.y + viewport.size.h
  for (const n of nodes) {
    minX = Math.min(minX, n.pos.x)
    minY = Math.min(minY, n.pos.y)
    maxX = Math.max(maxX, n.pos.x + n.size.w)
    maxY = Math.max(maxY, n.pos.y + n.size.h)
  }
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1)
  const scale = Math.min(Math.max(box.w - 2 * PAD, 1) / w, Math.max(box.h - 2 * PAD, 1) / h)
  return {
    scale,
    offset: { x: box.w / 2 - (minX + w / 2) * scale, y: box.h / 2 - (minY + h / 2) * scale }
  }
}

export function worldToMinimap(p: Vec, t: MinimapTransform): Vec {
  return { x: p.x * t.scale + t.offset.x, y: p.y * t.scale + t.offset.y }
}

export function minimapToWorld(p: Vec, t: MinimapTransform): Vec {
  return { x: (p.x - t.offset.x) / t.scale, y: (p.y - t.offset.y) / t.scale }
}
