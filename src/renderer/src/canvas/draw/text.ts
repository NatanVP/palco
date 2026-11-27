import type { Drawing } from '../../../../shared/model'
import { isShape } from './tools'

/** Tamanho do texto nas formas: 8 a 200 (o palco passa de 2 em 2 na barra), padrão 20. */
export const TEXT_SIZE_MIN = 8
export const TEXT_SIZE_MAX = 200
export const TEXT_SIZE_DEFAULT = 20
export const TEXT_SIZE_STEP = 2
export const clampTextSize = (n: number): number => (Number.isFinite(n) ? Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(n))) : TEXT_SIZE_MIN)

/** Preto ou branco, o que contrasta mais com a cor (luminância relativa); cor que não é #hex vira preto. */
export function contrastColor(color: string): '#000000' | '#FFFFFF' {
  const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/.exec(color)
  if (!m) return '#000000'
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#FFFFFF'
}

export interface TextLayout { x: number; y: number; width: number; height: number; fontSize: number; text: string; color: string }

/** Largura da coluna de texto: a forma menos 16, nunca menos de 40 (`drawingTextColumnWidth`). */
export const textColumn = (shapeWidth: number): number => Math.max(shapeWidth - 16, 40)
/** Ajuste óptico vertical (`drawingTextOpticalOffsetY`): o centro visual do triângulo, da estrela e do coração não é o da caixa. */
export const textOffsetY = (tool: string, height: number): number => (tool === 'triangle' ? height * 0.12 : tool === 'star' ? height * 0.05 : tool === 'heart' ? -height * 0.06 : 0)
/** Cor do texto: a do desenho; com preenchimento sólido, preto ou branco pelo contraste. */
export const textColor = (d: Pick<Drawing, 'color' | 'fill'>): string => (d.fill === 'solid' ? contrastColor(d.color) : d.color)

/** Onde e como o texto da forma aparece (coordenadas de mundo); nulo sem texto ou fora das formas com área. */
export function drawingTextLayout(d: Pick<Drawing, 'tool' | 'points' | 'text' | 'textSize' | 'color' | 'fill'>): TextLayout | null {
  if (!d.text || !d.tool || !isShape(d.tool) || d.points.length < 2) return null
  const a = d.points[0]!, b = d.points[d.points.length - 1]!
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
  const col = textColumn(w)
  return { x: x0 + w / 2 - col / 2, y: y0 + textOffsetY(d.tool, h), width: col, height: h, fontSize: d.textSize ?? TEXT_SIZE_DEFAULT, text: d.text, color: textColor(d) }
}
