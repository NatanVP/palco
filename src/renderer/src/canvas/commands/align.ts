import type { Size, Vec } from '../../../../shared/model'
import { unionBox } from './view'

export const ALIGN_IDS = ['left', 'centerHorizontally', 'right', 'top', 'centerVertically', 'bottom', 'distributeHorizontally', 'distributeVertically'] as const
export type AlignId = (typeof ALIGN_IDS)[number]
export const isAlignId = (id: string): id is AlignId => (ALIGN_IDS as readonly string[]).includes(id)
interface Framed { id: string; pos: Vec; size: Size }

/**
 * Novas posições para alinhar ou distribuir a seleção (o tamanho nunca muda). Alinhar usa a caixa da seleção; distribuir mantém
 * as duas pontas e iguala os vãos entre os elementos do meio (precisa de três ou mais). Seleção de um só não muda nada.
 */
export function alignFrames(action: AlignId, frames: readonly Framed[]): Array<{ id: string; pos: Vec }> {
  if (frames.length < 2) return []
  const box = unionBox(frames), out = (f: (fr: Framed) => Vec): Array<{ id: string; pos: Vec }> => frames.map(fr => ({ id: fr.id, pos: f(fr) }))
  switch (action) {
    case 'left': return out(f => ({ x: box.x, y: f.pos.y }))
    case 'right': return out(f => ({ x: box.x + box.w - f.size.w, y: f.pos.y }))
    case 'centerHorizontally': return out(f => ({ x: box.x + (box.w - f.size.w) / 2, y: f.pos.y }))
    case 'top': return out(f => ({ x: f.pos.x, y: box.y }))
    case 'bottom': return out(f => ({ x: f.pos.x, y: box.y + box.h - f.size.h }))
    case 'centerVertically': return out(f => ({ x: f.pos.x, y: box.y + (box.h - f.size.h) / 2 }))
    case 'distributeHorizontally': case 'distributeVertically': {
      if (frames.length < 3) return []
      const h = action === 'distributeHorizontally', at = (f: Framed): number => (h ? f.pos.x : f.pos.y), len = (f: Framed): number => (h ? f.size.w : f.size.h)
      const sorted = [...frames].sort((a, b) => at(a) - at(b)), first = sorted[0]!, last = sorted[sorted.length - 1]!
      const span = at(last) + len(last) - at(first), used = sorted.reduce((s, f) => s + len(f), 0), gap = (span - used) / (sorted.length - 1)
      let cursor = at(first)
      const next = new Map<string, number>()
      for (const f of sorted) { next.set(f.id, cursor); cursor += len(f) + gap }
      return out(f => (h ? { x: next.get(f.id)!, y: f.pos.y } : { x: f.pos.x, y: next.get(f.id)! }))
    }
  }
}
