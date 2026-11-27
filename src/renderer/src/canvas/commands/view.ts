import type { Size, Vec } from '../../../../shared/model'
import { MAX_ZOOM, MIN_ZOOM, type Camera } from '../camera'

export interface Box { x: number; y: number; w: number; h: number }
type Framed = { pos: Vec; size: Size }

/** Menor caixa que cobre todas as molduras. */
export function unionBox(frames: readonly Framed[]): Box {
  if (!frames.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x0 = Math.min(...frames.map(f => f.pos.x)), y0 = Math.min(...frames.map(f => f.pos.y))
  const x1 = Math.max(...frames.map(f => f.pos.x + f.size.w)), y1 = Math.max(...frames.map(f => f.pos.y + f.size.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Câmera que enquadra a caixa na viewport, com margem, no zoom mais alto que cabe (entre o mínimo e o máximo). */
export function fitCamera(box: Box, view: Size, margin = 80): Camera {
  const fit = Math.min((view.w - margin * 2) / Math.max(box.w, 1), (view.h - margin * 2) / Math.max(box.h, 1))
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit))
  return { zoom, offset: { x: view.w / 2 - (box.x + box.w / 2) * zoom, y: view.h / 2 - (box.y + box.h / 2) * zoom } }
}
