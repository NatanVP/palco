import type { DrawFill, DrawKind, DrawPattern, Vec } from '../../../../shared/model'
import { t } from '../../i18n'

/** Ferramentas da barra, na ordem dela; depois vem o seletor de formas. `smart` reconhece a forma ao soltar. */
export const DRAW_TOOLS = ['pen', 'brush', 'smart', 'arrow', 'highlighter', 'line'] as const
export type DrawTool = (typeof DRAW_TOOLS)[number] | Shape
export const SHAPES = ['rect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'oval', 'parallelogram', 'cloud', 'heart', 'boxX', 'checkbox', 'arrowLeft', 'arrowUp', 'arrowDown', 'arrowRight'] as const
export type Shape = (typeof SHAPES)[number]

export const TOOL_LABEL: Record<DrawTool, string> = {
  get pen() { return t('canvas.draw.tools.caneta') }, get brush() { return t('canvas.draw.tools.pincel') }, get smart() { return t('canvas.draw.tools.desenho_inteligente') }, get arrow() { return t('canvas.draw.tools.seta') }, highlighter: 'Marca-texto', get line() { return t('canvas.draw.tools.linha') },
  get rect() { return t('canvas.draw.tools.retangulo') }, get ellipse() { return t('canvas.draw.tools.elipse') }, get triangle() { return t('canvas.draw.tools.triangulo') }, get diamond() { return t('canvas.draw.tools.losango') }, get hexagon() { return t('canvas.draw.tools.hexagono') }, get star() { return t('canvas.draw.tools.estrela') },
  get oval() { return t('canvas.draw.tools.oval') }, get parallelogram() { return t('canvas.draw.tools.paralelogramo') }, get cloud() { return t('canvas.draw.tools.nuvem') }, get heart() { return t('canvas.draw.tools.coracao') }, get boxX() { return t('canvas.draw.tools.caixa_x') }, checkbox: 'Checkbox',
  get arrowLeft() { return t('canvas.draw.tools.seta_para_a_esquerda') }, get arrowUp() { return t('canvas.draw.tools.seta_para_cima') }, get arrowDown() { return t('canvas.draw.tools.seta_para_baixo') }, get arrowRight() { return t('canvas.draw.tools.seta_para_a_direita') }
}

/** 12 cores, em 7 colunas na barra; a cor personalizada vem do seletor nativo. */
export const DRAW_PALETTE = ['#000000', '#545454', '#8E8E93', '#FFFFFF', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55'] as const

export const WIDTH_MIN = 1
export const WIDTH_MAX = 24
/** Espessura em unidades do canvas (a barra mostra "pt"), inteira entre 1 e 24. */
export const clampWidth = (w: number): number => Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(w)))

export const PATTERNS: readonly DrawPattern[] = ['solid', 'dashed', 'dotted']
export const PATTERN_LABEL: Record<DrawPattern, string> = { get solid() { return t('canvas.draw.tools.solido') }, get dashed() { return t('canvas.draw.tools.tracejado') }, get dotted() { return t('canvas.draw.tools.pontilhado') } }
export const PATTERN_DASH: Record<DrawPattern, number[]> = { solid: [], dashed: [14, 8], dotted: [2, 6] }

export const FILLS: readonly DrawFill[] = ['none', 'hatch', 'cross', 'tint', 'solid']
export const FILL_LABEL: Record<DrawFill, string> = { get none() { return t('canvas.draw.tools.sem_preenchimento') }, get hatch() { return t('canvas.draw.tools.hachura') }, get cross() { return t('canvas.draw.tools.hachura_cruzada') }, get tint() { return t('canvas.draw.tools.tom') }, get solid() { return t('canvas.draw.tools.solido') } }
export const RADIUS_MIN = 0
export const RADIUS_MAX = 60
export const DEFAULT_RADIUS = 6
/** Raio dos cantos, inteiro entre 0 e 60 (a forma limita à metade do menor lado). */
export const clampRadius = (r: number): number => Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(r)))

/** Estilo atual da barra: ferramenta, última forma escolhida, cor, espessura, padrão, preenchimento e raio. */
export interface DrawStyle { tool: DrawTool; shape: Shape; color: string; width: number; pattern: DrawPattern; fill: DrawFill; radius: number }
export const DEFAULT_DRAW_STYLE: DrawStyle = { tool: 'pen', shape: 'rect', color: '#FF3B30', width: 3, pattern: 'solid', fill: 'none', radius: DEFAULT_RADIUS }

export const isShape = (t: string): t is Shape => (SHAPES as readonly string[]).includes(t)
/** Formas com área (voltam para Seleção ao soltar). */
export const isAreaShape = (t: string): boolean => isShape(t)
/** Ferramentas de traço livre continuam armadas depois de cada traço. */
export const keepsDrawing = (t: DrawTool): boolean => t === 'pen' || t === 'brush' || t === 'highlighter' || t === 'smart'
/** O desenho que a ferramenta grava (o inteligente grava como caneta até reconhecer). */
export const kindOf = (t: DrawTool): DrawKind => (t === 'smart' ? 'pen' : t)

/** Ângulo preso a múltiplos de 45°, mantendo a distância. */
function snap45(a: Vec, b: Vec): Vec {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) }
}

/** Pontos que o gesto grava: traço livre inteiro; linha, seta e forma, primeiro e último (Shift: 45° ou lados iguais). */
export function gesturePoints(tool: DrawTool, raw: readonly Vec[], shift: boolean): Vec[] {
  if (keepsDrawing(tool)) return [...raw]
  const a = raw[0]!, b = raw[raw.length - 1]!
  if (!shift) return [a, b]
  if (tool === 'line' || tool === 'arrow') return [a, snap45(a, b)]
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  return [a, { x: a.x + Math.sign(b.x - a.x || 1) * side, y: a.y + Math.sign(b.y - a.y || 1) * side }]
}
