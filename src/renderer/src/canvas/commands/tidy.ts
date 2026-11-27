import type { Size, Vec } from '../../../../shared/model'
import { spatialOrder } from './order'
import { unionBox } from './view'

export const TIDY_LAYOUTS = ['grid', 'row', 'column'] as const
export type TidyLayout = (typeof TIDY_LAYOUTS)[number]
const GAP = 40
interface Framed { id: string; pos: Vec; size: Size }

/** Organiza a seleção a partir do canto de cima à esquerda dela, na ordem espacial, com vão de 40: grade, linha ou coluna. */
export function tidyFrames(frames: readonly Framed[], layout: TidyLayout): Array<{ id: string; pos: Vec }> {
  if (frames.length < 2) return []
  const box = unionBox(frames), items = spatialOrder(frames)
  const cols = layout === 'row' ? items.length : layout === 'column' ? 1 : Math.ceil(Math.sqrt(items.length))
  const out: Array<{ id: string; pos: Vec }> = []
  const colW: number[] = [], rowH: number[] = []
  items.forEach((f, i) => { const c = i % cols, r = Math.floor(i / cols); colW[c] = Math.max(colW[c] ?? 0, f.size.w); rowH[r] = Math.max(rowH[r] ?? 0, f.size.h) })
  items.forEach((f, i) => {
    const c = i % cols, r = Math.floor(i / cols)
    out.push({ id: f.id, pos: { x: box.x + colW.slice(0, c).reduce((s, w) => s + w + GAP, 0), y: box.y + rowH.slice(0, r).reduce((s, h) => s + h + GAP, 0) } })
  })
  return out
}
