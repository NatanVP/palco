import type { Vec } from '../../../../shared/model'

/** Resultado do desenho inteligente: a forma reconhecida e os dois pontos que a definem. */
export interface Recognized { tool: 'line' | 'arrow' | 'rect' | 'ellipse'; points: [Vec, Vec] }

const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
const pathLength = (pts: readonly Vec[], from = 0, to = pts.length - 1): number => {
  let len = 0
  for (let i = from + 1; i <= to; i++) len += dist(pts[i - 1]!, pts[i]!)
  return len
}

/** Reta: a corda cobre quase todo o caminho. */
const STRAIGHT = 0.92
/** Erro máximo (normalizado) para aceitar retângulo ou elipse. */
const MAX_SHAPE_ERROR = 0.15

/** Seta = haste reta longa seguida de um gancho curto perto da ponta. Devolve o índice do fim da haste. */
function arrowShaftEnd(pts: readonly Vec[], total: number): number | null {
  for (let k = pts.length - 2; k >= 2; k--) {
    const shaft = pathLength(pts, 0, k)
    if (shaft < 20 || shaft < total * 0.5) return null
    if (dist(pts[0]!, pts[k]!) / shaft < 0.95) continue
    const tail = total - shaft
    const reach = Math.max(...pts.slice(k).map((p) => dist(p, pts[k]!)))
    if (tail >= shaft * 0.08 && tail <= shaft * 0.6 && reach <= shaft * 0.3) return k
    return null
  }
  return null
}

/**
 * Reconhecimento próprio (heurísticas de geometria, nada de serviço externo): linha, seta, retângulo ou elipse.
 * `null` quando não reconhece; quem chama grava como caneta.
 */
export function recognize(pts: readonly Vec[]): Recognized | null {
  if (pts.length < 3) return null
  const total = pathLength(pts)
  if (total < 8) return null
  const first = pts[0]!, last = pts[pts.length - 1]!
  if (dist(first, last) / total >= STRAIGHT) return { tool: 'line', points: [first, last] }

  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h)
  const closed = dist(first, last) < diag * 0.25 && total > diag * 1.8

  if (!closed) {
    const k = arrowShaftEnd(pts, total)
    return k === null ? null : { tool: 'arrow', points: [first, pts[k]!] }
  }
  if (Math.min(w, h) < 4) return null
  const cx = x0 + w / 2, cy = y0 + h / 2, rx = w / 2, ry = h / 2
  const ellipseErr = pts.reduce((s, p) => s + Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1), 0) / pts.length
  const rectErr = pts.reduce((s, p) => s + Math.min(Math.abs(p.x - x0), Math.abs(p.x - x1), Math.abs(p.y - y0), Math.abs(p.y - y1)), 0) / pts.length / (Math.min(w, h) / 2)
  const best = Math.min(ellipseErr, rectErr)
  if (best > MAX_SHAPE_ERROR) return null
  return { tool: rectErr <= ellipseErr ? 'rect' : 'ellipse', points: [{ x: x0, y: y0 }, { x: x1, y: y1 }] }
}
