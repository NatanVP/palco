import type { Size, Vec } from '../../../shared/model'

export interface CardFrame { pos: Vec; size: Size }
export interface CardDrag { kind: 'move' | 'resize'; start: Vec; frame: CardFrame }
/** O frame vem da posição do ponteiro, nunca de um render de preview que pode estar atrasado. */
export function cardFrameAt(drag: CardDrag, pointer: Vec, zoom: number, min: Size = { w: 200, h: 120 }): CardFrame {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const dx = (pointer.x - drag.start.x) / scale, dy = (pointer.y - drag.start.y) / scale
  if (drag.kind === 'move') return { pos: { x: drag.frame.pos.x + dx, y: drag.frame.pos.y + dy }, size: { ...drag.frame.size } }
  return { pos: { ...drag.frame.pos }, size: { w: Math.max(min.w, drag.frame.size.w + dx), h: Math.max(min.h, drag.frame.size.h + dy) } }
}
