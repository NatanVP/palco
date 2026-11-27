import type { Drawing, Vec } from '../../../../shared/model'
import { isShape as isShapeKind, PATTERN_DASH } from './tools'
import { pointsBox } from './transform'

/** Número curto para o atributo `d` (sem cauda de ponto flutuante). */
const f = (n: number): string => String(Math.round(n * 100) / 100)

/** Caminho SVG suave por pontos médios (curvas quadráticas). */
export function strokePath(points: readonly Vec[]): string {
  if (points.length === 0) return ''
  const [first] = points
  if (points.length === 1) return `M ${f(first!.x)} ${f(first!.y)} l 0.01 0`
  let d = `M ${f(first!.x)} ${f(first!.y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!, q = points[i + 1]!
    d += ` Q ${f(p.x)} ${f(p.y)} ${f((p.x + q.x) / 2)} ${f((p.y + q.y) / 2)}`
  }
  const last = points[points.length - 1]!
  return `${d} L ${f(last.x)} ${f(last.y)}`
}

const poly = (pts: readonly Vec[]): string => pts.map((p, i) => `${i ? 'L' : 'M'} ${f(p.x)} ${f(p.y)}`).join(' ') + ' Z'

/**
 * Pincel: contorno preenchido em volta do traço, com raio = espessura (o "tamanho" é 2×) e pontas afinando,
 * para o traço parecer orgânico.
 */
function brushOutline(points: readonly Vec[], width: number): string {
  const r = width
  if (points.length < 2) {
    const c = points[0] ?? { x: 0, y: 0 }
    return poly(Array.from({ length: 12 }, (_, i) => ({ x: c.x + r * Math.cos((i / 12) * 2 * Math.PI), y: c.y + r * Math.sin((i / 12) * 2 * Math.PI) })))
  }
  const n = points.length
  const left: Vec[] = [], right: Vec[] = []
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)]!, next = points[Math.min(n - 1, i + 1)]!
    const dx = next.x - prev.x, dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const taper = Math.min(1, (i + 1) / 4, (n - i) / 4) * 0.6 + 0.4
    const nx = (-dy / len) * r * taper, ny = (dx / len) * r * taper
    const p = points[i]!
    left.push({ x: p.x + nx, y: p.y + ny })
    right.push({ x: p.x - nx, y: p.y - ny })
  }
  return poly([...left, ...right.reverse()])
}

function box(points: readonly Vec[]): { x0: number; y0: number; x1: number; y1: number; w: number; h: number } {
  const a = points[0]!, b = points[points.length - 1]!
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

/** Cabeça da seta em `b`, virada para onde a curva chega (a tangente em `b`). */
function arrowHead(from: Vec, b: Vec, width: number): string {
  const head = Math.max(10, width * 4)
  const ang = Math.atan2(b.y - from.y, b.x - from.x)
  const wing = (s: number): Vec => ({ x: b.x - head * Math.cos(ang + s * 0.5), y: b.y - head * Math.sin(ang + s * 0.5) })
  const l = wing(1), r = wing(-1)
  return ` M ${f(l.x)} ${f(l.y)} L ${f(b.x)} ${f(b.y)} L ${f(r.x)} ${f(r.y)}`
}
/** Seta reta, ou curva quadrática pelo ponto de controle (a cabeça acompanha a tangente da chegada). */
function arrowPath(a: Vec, b: Vec, width: number, control?: Vec): string {
  if (!control) return `M ${f(a.x)} ${f(a.y)} L ${f(b.x)} ${f(b.y)}${arrowHead(a, b, width)}`
  return `M ${f(a.x)} ${f(a.y)} Q ${f(control.x)} ${f(control.y)} ${f(b.x)} ${f(b.y)}${arrowHead(control, b, width)}`
}

type Box = ReturnType<typeof box>
const lerp = (b: Box, u: number, v: number): Vec => ({ x: b.x0 + u * b.w, y: b.y0 + v * b.h })
/** Polígono em coordenadas unitárias (0..1) mapeado para a caixa. */
const unit = (b: Box, pts: ReadonlyArray<readonly [number, number]>): Vec[] => pts.map(([u, v]) => lerp(b, u, v))

/** Seta de bloco apontando para a direita, na caixa unitária; as outras três giram os pontos. */
const BLOCK_RIGHT: ReadonlyArray<readonly [number, number]> = [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]]
const BLOCK_MAP: Record<string, (u: number, v: number) => readonly [number, number]> = {
  arrowRight: (u, v) => [u, v], arrowLeft: (u, v) => [1 - u, v], arrowDown: (u, v) => [v, u], arrowUp: (u, v) => [v, 1 - u]
}

/** Retângulo com cantos arredondados: raio limitado à metade do menor lado; 0 = reto. */
function roundedRect(b: Box, radius: number): string {
  const r = Math.min(Math.max(0, radius), b.w / 2, b.h / 2)
  if (r <= 0) return poly([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }])
  const a = `A ${f(r)} ${f(r)} 0 0 1`
  return `M ${f(b.x0 + r)} ${f(b.y0)} L ${f(b.x1 - r)} ${f(b.y0)} ${a} ${f(b.x1)} ${f(b.y0 + r)} L ${f(b.x1)} ${f(b.y1 - r)} ${a} ${f(b.x1 - r)} ${f(b.y1)} L ${f(b.x0 + r)} ${f(b.y1)} ${a} ${f(b.x0)} ${f(b.y1 - r)} L ${f(b.x0)} ${f(b.y0 + r)} ${a} ${f(b.x0 + r)} ${f(b.y0)} Z`
}

function ellipsePath(b: Box): string {
  const rx = b.w / 2, ry = b.h / 2, cy = b.y0 + ry
  return `M ${f(b.x0)} ${f(cy)} A ${f(rx)} ${f(ry)} 0 1 0 ${f(b.x1)} ${f(cy)} A ${f(rx)} ${f(ry)} 0 1 0 ${f(b.x0)} ${f(cy)} Z`
}

/** Coração: duas curvas de cima que descem até a ponta de baixo, na caixa. */
function heartPath(b: Box): string {
  const P = (u: number, v: number): string => { const p = lerp(b, u, v); return `${f(p.x)} ${f(p.y)}` }
  return `M ${P(0.5, 0.95)} C ${P(0.05, 0.62)} ${P(0, 0.3)} ${P(0.22, 0.1)} C ${P(0.38, -0.04)} ${P(0.5, 0.1)} ${P(0.5, 0.27)} C ${P(0.5, 0.1)} ${P(0.62, -0.04)} ${P(0.78, 0.1)} C ${P(1, 0.3)} ${P(0.95, 0.62)} ${P(0.5, 0.95)} Z`
}

/** Nuvem: base reta e lóbulos arredondados por cima. */
function cloudPath(b: Box): string {
  const P = (u: number, v: number): string => { const p = lerp(b, u, v); return `${f(p.x)} ${f(p.y)}` }
  const rx = (u: number): string => f(u * b.w), ry = (v: number): string => f(v * b.h)
  return `M ${P(0.22, 0.88)} A ${rx(0.2)} ${ry(0.2)} 0 0 1 ${P(0.1, 0.52)} A ${rx(0.17)} ${ry(0.22)} 0 0 1 ${P(0.34, 0.3)} A ${rx(0.2)} ${ry(0.24)} 0 0 1 ${P(0.66, 0.2)} A ${rx(0.2)} ${ry(0.24)} 0 0 1 ${P(0.86, 0.46)} A ${rx(0.2)} ${ry(0.22)} 0 0 1 ${P(0.78, 0.88)} Z`
}

/** Caminho da forma e, se tiver, o detalhe de dentro (X da caixa, visto do checkbox), desenhado só com traço. */
function shapeParts(kind: string, points: readonly Vec[], radius: number): { d: string; detail?: string } {
  const b = box(points)
  const { x0, y0, x1, y1, w, h } = b
  const cx = x0 + w / 2, cy = y0 + h / 2
  switch (kind) {
    case 'rect': return { d: roundedRect(b, radius) }
    case 'ellipse': return { d: ellipsePath(b) }
    case 'oval': return { d: roundedRect(b, Math.min(w, h) / 2) }
    case 'triangle': return { d: poly([{ x: cx, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]) }
    case 'diamond': return { d: poly([{ x: cx, y: y0 }, { x: x1, y: cy }, { x: cx, y: y1 }, { x: x0, y: cy }]) }
    case 'hexagon': return { d: poly([{ x: x0 + w / 4, y: y0 }, { x: x1 - w / 4, y: y0 }, { x: x1, y: cy }, { x: x1 - w / 4, y: y1 }, { x: x0 + w / 4, y: y1 }, { x: x0, y: cy }]) }
    case 'parallelogram': return { d: poly([{ x: x0 + w * 0.25, y: y0 }, { x: x1, y: y0 }, { x: x1 - w * 0.25, y: y1 }, { x: x0, y: y1 }]) }
    case 'cloud': return { d: cloudPath(b) }
    case 'heart': return { d: heartPath(b) }
    case 'boxX': {
      const m = Math.min(w, h) * 0.28
      return { d: roundedRect(b, radius), detail: `M ${f(x0 + m)} ${f(y0 + m)} L ${f(x1 - m)} ${f(y1 - m)} M ${f(x1 - m)} ${f(y0 + m)} L ${f(x0 + m)} ${f(y1 - m)}` }
    }
    case 'checkbox': return { d: roundedRect(b, radius), detail: `M ${f(x0 + w * 0.25)} ${f(y0 + h * 0.52)} L ${f(x0 + w * 0.43)} ${f(y0 + h * 0.7)} L ${f(x0 + w * 0.76)} ${f(y0 + h * 0.3)}` }
    case 'arrowLeft': case 'arrowUp': case 'arrowDown': case 'arrowRight': {
      const map = BLOCK_MAP[kind]!
      return { d: poly(unit(b, BLOCK_RIGHT.map(([u, v]) => map(u, v)))) }
    }
    default:
      // Estrela de 5 pontas inscrita na caixa (raio interno = 40% do externo).
      return { d: poly(Array.from({ length: 10 }, (_, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.4 : 1
        return { x: cx + (w / 2) * k * Math.cos(ang), y: cy + (h / 2) * k * Math.sin(ang) }
      })) }
  }
}

/** Ponto mais próximo de `p` na polilinha e a distância até ele. */
export function nearestOnPolyline(p: Vec, pts: readonly Vec[]): { point: Vec; distance: number } {
  let best = { point: pts[0] ?? p, distance: Infinity }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    const q = { x: a.x + t * dx, y: a.y + t * dy }, distance = Math.hypot(p.x - q.x, p.y - q.y)
    if (distance < best.distance) best = { point: q, distance }
  }
  return best
}

/** Contorno da forma como polilinha fechada (elipse, oval, nuvem e coração usam a elipse da caixa) — serve para encaixar linhas e setas. */
export function shapeOutline(kind: string, points: readonly Vec[]): Vec[] {
  const b = box(points)
  const round = (): Vec[] => Array.from({ length: 49 }, (_, i) => ({ x: b.x0 + b.w / 2 + (b.w / 2) * Math.cos((i / 48) * 2 * Math.PI), y: b.y0 + b.h / 2 + (b.h / 2) * Math.sin((i / 48) * 2 * Math.PI) }))
  switch (kind) {
    case 'ellipse': case 'oval': case 'cloud': case 'heart': return round()
    case 'triangle': return unit(b, [[0.5, 0], [1, 1], [0, 1], [0.5, 0]])
    case 'diamond': return unit(b, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0]])
    case 'hexagon': return unit(b, [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5], [0.25, 0]])
    case 'parallelogram': return unit(b, [[0.25, 0], [1, 0], [0.75, 1], [0, 1], [0.25, 0]])
    case 'arrowLeft': case 'arrowUp': case 'arrowDown': case 'arrowRight': { const m = BLOCK_MAP[kind]!; const o = unit(b, BLOCK_RIGHT.map(([u, v]) => m(u, v))); return [...o, o[0]!] }
    default: return unit(b, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])
  }
}

/**
 * Encaixe de linha e seta: se a ponta ficar a até `reach` de uma borda de forma com área, gruda no ponto mais próximo da borda
 * (a forma mais próxima ganha). Longe de todas, devolve o ponto como veio.
 */
export function snapToShapes(p: Vec, shapes: ReadonlyArray<Pick<Drawing, 'tool' | 'points'>>, reach: number): Vec {
  let best: { point: Vec; distance: number } | null = null
  for (const s of shapes) {
    if (!s.tool || !isShapeKind(s.tool) || s.points.length < 2) continue
    const hit = nearestOnPolyline(p, shapeOutline(s.tool, s.points))
    if (hit.distance <= reach && (!best || hit.distance < best.distance)) best = hit
  }
  return best ? { x: Math.round(best.point.x * 100) / 100, y: Math.round(best.point.y * 100) / 100 } : p
}

export interface DrawingGeometry {
  d: string; fill: string; strokeWidth: number; opacity: number; dash?: string
  /** Opacidade do preenchimento (o "tom" usa 20%). */
  fillOpacity?: number
  /** Preenchimento em hachura: o renderer usa um padrão listrado na cor do desenho. */
  hatch?: 'hatch' | 'cross'
  /** Traço de dentro da forma (X da caixa, visto do checkbox), sem preenchimento. */
  detail?: string
  /** Giro do desenho (graus) em torno do centro da caixa dos pontos, para o `<g transform>`. */
  rotate?: { deg: number; cx: number; cy: number }
}

/** Como desenhar em SVG um desenho gravado (ou o traço ao vivo): caminho, preenchimento, espessura, opacidade e tracejado. */
export function drawingGeometry(dr: Omit<Drawing, 'id'>): DrawingGeometry {
  const g = baseGeometry(dr)
  if (!dr.rotation || dr.tool === 'line' || dr.tool === 'arrow') return g
  const b = pointsBox(dr.points), deg = (dr.rotation * 180) / Math.PI
  return { ...g, rotate: { deg: Math.round(deg * 1000) / 1000, cx: b.x + b.w / 2, cy: b.y + b.h / 2 } }
}

function baseGeometry(dr: Omit<Drawing, 'id'>): DrawingGeometry {
  const kind = dr.tool ?? 'pen'
  const dashOf = (): string | undefined => {
    const dash = PATTERN_DASH[dr.pattern ?? 'solid']
    return dash.length ? dash.join(' ') : undefined
  }
  const stroke = (d: string, strokeWidth = dr.width, opacity = 1): DrawingGeometry => {
    const dash = dashOf()
    return { d, fill: 'none', strokeWidth, opacity, ...(dash ? { dash } : {}) }
  }
  const pts = dr.points
  switch (kind) {
    case 'pen': return stroke(strokePath(pts))
    case 'brush': return { d: brushOutline(pts, dr.width), fill: dr.color, strokeWidth: 0, opacity: 1 }
    case 'highlighter': return stroke(strokePath(pts), dr.width * 4, 0.3)
    case 'line': return stroke(`M ${f(pts[0]!.x)} ${f(pts[0]!.y)} L ${f(pts[pts.length - 1]!.x)} ${f(pts[pts.length - 1]!.y)}`)
    case 'arrow': return stroke(arrowPath(pts[0]!, pts[pts.length - 1]!, dr.width, dr.control))
    default: {
      const parts = shapeParts(kind, pts, dr.radius ?? 0)
      const base = stroke(parts.d)
      const fill = dr.fill ?? 'none'
      return {
        ...base, ...(parts.detail ? { detail: parts.detail } : {}),
        ...(fill === 'solid' ? { fill: dr.color } : fill === 'tint' ? { fill: dr.color, fillOpacity: 0.2 } : fill === 'hatch' || fill === 'cross' ? { hatch: fill } : {})
      }
    }
  }
}
