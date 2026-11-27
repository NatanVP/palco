import type { Drawing, DrawingPatch, Vec } from '../../../../shared/model'
import { clampTextSize } from './text'

/** As oito alças de redimensionar (cantos e lados) do palco. */
export const HANDLES = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'] as const
export type Handle = (typeof HANDLES)[number]
export interface Box { x: number; y: number; w: number; h: number }
/** Menor lado ao redimensionar, e o passo da rotação com Shift (15°). */
export const MIN_SIZE = 10
export const ROTATE_STEP = Math.PI / 12

/** Linha e seta têm alças nas pontas (e na curva); o resto — formas e traços livres — tem a caixa com oito alças e a de girar. */
export const isTransformable = (d: Pick<Drawing, 'tool'>): boolean => d.tool !== 'line' && d.tool !== 'arrow'

export function pointsBox(points: readonly Vec[]): Box {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
export const boxCenter = (b: Box): Vec => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
export const rotateVec = (p: Vec, c: Vec, a: number): Vec => {
  const s = Math.sin(a), k = Math.cos(a), dx = p.x - c.x, dy = p.y - c.y
  return { x: dx * k - dy * s + c.x, y: dx * s + dy * k + c.y }
}
/** Ângulo preso a múltiplos de 15°. */
export const snapAngle = (a: number): number => Math.round(a / ROTATE_STEP) * ROTATE_STEP

/**
 * Nova caixa ao arrastar uma alça: o arrasto da tela é girado de volta para o referencial do desenho;
 * o canto com Shift mantém a proporção; nenhum lado fica menor que 10 e o lado oposto não anda.
 */
export function resizeBox(handle: Handle, box: Box, rotation: number, delta: Vec, shift: boolean): Box {
  const re = Math.cos(-rotation), oe = Math.sin(-rotation)
  const dx = delta.x * re - delta.y * oe, dy = delta.x * oe + delta.y * re
  const l = handle.endsWith('l'), r = handle.endsWith('r'), t = handle.startsWith('t'), b = handle.startsWith('b')
  const right = box.x + box.w, bottom = box.y + box.h
  let x = l ? box.x + dx : box.x, y = t ? box.y + dy : box.y
  let w = l ? box.w - dx : r ? box.w + dx : box.w, h = t ? box.h - dy : b ? box.h + dy : box.h
  if (shift && (l || r) && (t || b)) {
    const ratio = box.w / Math.max(box.h, 1)
    if (Math.abs(dx) > Math.abs(dy)) { h = w / ratio; if (t) y = bottom - h } else { w = h * ratio; if (l) x = right - w }
  }
  if (w < MIN_SIZE) { if (l) x = right - MIN_SIZE; w = MIN_SIZE }
  if (h < MIN_SIZE) { if (t) y = bottom - MIN_SIZE; h = MIN_SIZE }
  return { x, y, w, h }
}

const mapPoint = (p: Vec, from: Box, to: Box): Vec => ({
  x: to.x + (from.w > 0 ? ((p.x - from.x) / from.w) * to.w : 0), y: to.y + (from.h > 0 ? ((p.y - from.y) / from.h) * to.h : 0)
})
/** O texto acompanha a escala: pelo menor dos dois fatores (alargar só um lado não o aumenta). */
const textScale = (from: Box, to: Box): number => Math.min(from.w > 0 ? to.w / from.w : 1, from.h > 0 ? to.h / from.h : 1)
const scaled = (d: Drawing, from: Box, to: Box): DrawingPatch => ({
  points: d.points.map((p) => mapPoint(p, from, to)),
  ...(d.control ? { control: mapPoint(d.control, from, to) } : {}),
  ...(d.text && d.textSize !== undefined ? { textSize: clampTextSize(d.textSize * textScale(from, to)) } : {})
})

/** Redimensionar um desenho: os pontos escalam da caixa antiga para a nova (formas e traços livres) e o texto vai junto. */
export function resizePatch(d: Drawing, handle: Handle, delta: Vec, shift: boolean): DrawingPatch {
  const from = pointsBox(d.points)
  return scaled(d, from, resizeBox(handle, from, d.rotation ?? 0, delta, shift))
}
/** Girar um desenho: guarda o ângulo (rotação em torno do centro da caixa); os pontos ficam. */
export const rotatePatch = (_d: Drawing, angle: number): DrawingPatch => ({ rotation: angle })

/** Caixa de vários desenhos juntos. */
export function groupBox(ds: readonly Drawing[]): Box {
  const bs = ds.map((d) => pointsBox(d.points)), x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y }
}
/** Redimensionar o grupo pela caixa dele: cada desenho (pontos, curva, texto) escala junto. */
export function groupResizePatches(ds: readonly Drawing[], handle: Handle, delta: Vec, shift: boolean): Map<string, DrawingPatch> {
  const from = groupBox(ds), to = resizeBox(handle, from, 0, delta, shift)
  return new Map(ds.map((d) => [d.id, scaled(d, from, to)]))
}
/** Girar o grupo em torno do centro: formas e traços vão para o lugar girado e somam o ângulo; linhas e setas giram nas pontas. */
export function groupRotatePatches(ds: readonly Drawing[], center: Vec, angle: number): Map<string, DrawingPatch> {
  return new Map(ds.map((d) => {
    if (!isTransformable(d)) return [d.id, { points: d.points.map((p) => rotateVec(p, center, angle)), ...(d.control ? { control: rotateVec(d.control, center, angle) } : {}) }]
    const c = boxCenter(pointsBox(d.points)), n = rotateVec(c, center, angle)
    return [d.id, { points: d.points.map((p) => ({ x: p.x + n.x - c.x, y: p.y + n.y - c.y })), rotation: (d.rotation ?? 0) + angle }]
  }))
}
