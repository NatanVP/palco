import type { Size, Vec } from '../../../../shared/model'

/** Folga da moldura em volta dos membros, em unidades do canvas. */
export const GROUP_PADDING = 16

/** Moldura do grupo em coordenadas de tela: a união dos membros com a folga. O cabeçalho não escala com o zoom. */
export function groupFrame(frames: ReadonlyArray<{ pos: Vec; size: Size }>, camera: { offset: Vec; zoom: number }): { x: number; y: number; w: number; h: number } | null {
  if (!frames.length) return null
  const x0 = Math.min(...frames.map((f) => f.pos.x)) - GROUP_PADDING, y0 = Math.min(...frames.map((f) => f.pos.y)) - GROUP_PADDING
  const x1 = Math.max(...frames.map((f) => f.pos.x + f.size.w)) + GROUP_PADDING, y1 = Math.max(...frames.map((f) => f.pos.y + f.size.h)) + GROUP_PADDING
  return { x: x0 * camera.zoom + camera.offset.x, y: y0 * camera.zoom + camera.offset.y, w: (x1 - x0) * camera.zoom, h: (y1 - y0) * camera.zoom }
}
