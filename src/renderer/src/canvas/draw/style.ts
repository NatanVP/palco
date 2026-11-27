import type { HistoryOperation } from '../../../../shared/api'
import type { Drawing, DrawingPatch, Vec, Workspace } from '../../../../shared/model'
import { snapToShapes } from './geometry'
import { DEFAULT_RADIUS, isAreaShape, type DrawStyle } from './tools'
import type { StyleValue } from './DrawToolbar'
import { TEXT_SIZE_DEFAULT } from './text'

/** Alcance do encaixe, em pixels de tela (dividido pelo zoom ao usar). */
export const SNAP_REACH_PX = 12

/** Linha e seta: as duas pontas grudam na borda de forma com área que estiver ao alcance. */
export function snapLine(points: readonly Vec[], shapes: ReadonlyArray<Pick<Drawing, 'tool' | 'points'>>, reach: number): Vec[] {
  if (points.length < 2) return [...points]
  const last = points.length - 1
  return points.map((p, i) => (i === 0 || i === last ? snapToShapes(p, shapes, reach) : p))
}

/** Os campos de estilo que a ferramenta grava num desenho novo (preenchimento e raio só em forma com área). */
export function styleFields(style: Pick<DrawStyle, 'tool' | 'fill' | 'radius' | 'pattern'>): Pick<Drawing, 'fill' | 'radius' | 'pattern'> {
  return {
    ...(isAreaShape(style.tool) && style.fill !== 'none' ? { fill: style.fill } : {}),
    ...(isAreaShape(style.tool) ? { radius: style.radius ?? DEFAULT_RADIUS } : {}),
    ...(style.tool !== 'brush' && style.pattern !== 'solid' ? { pattern: style.pattern } : {})
  }
}

/** Estilo em lote: um `drawing.patch` por desenho (a seleção vira um nível só no histórico); o que não se aplica ao desenho fica de fora. */
export function styleOperations(ws: Pick<Workspace, 'drawings'>, ids: readonly string[], patch: Partial<StyleValue>): HistoryOperation[] {
  const ops: HistoryOperation[] = []
  for (const dr of ws.drawings ?? []) {
    if (!ids.includes(dr.id)) continue
    const p: DrawingPatch = {}
    if (patch.color !== undefined) p.color = patch.color
    if (patch.width !== undefined) p.width = patch.width
    if (patch.pattern !== undefined && dr.tool !== 'brush') p.pattern = patch.pattern
    if (isAreaShape(dr.tool ?? 'pen')) {
      if (patch.textSize !== undefined) p.textSize = patch.textSize
      if (patch.fill !== undefined) p.fill = patch.fill
      if (patch.radius !== undefined) p.radius = patch.radius
    }
    if (Object.keys(p).length) ops.push({ type: 'drawing.patch', id: dr.id, patch: p })
  }
  return ops
}

/** O que a barra de seleção mostra: o estilo do primeiro desenho selecionado. */
export function selectionStyle(ws: Pick<Workspace, 'drawings'>, ids: readonly string[]): { value: StyleValue; hasArea: boolean; onlyBrush: boolean } | null {
  const chosen = (ws.drawings ?? []).filter((d) => ids.includes(d.id))
  const first = chosen[0]
  if (!first) return null
  return {
    value: { color: first.color, width: first.width, pattern: first.pattern ?? 'solid', fill: first.fill ?? 'none', radius: first.radius ?? 0, textSize: first.textSize ?? TEXT_SIZE_DEFAULT },
    hasArea: chosen.some((d) => isAreaShape(d.tool ?? 'pen')),
    onlyBrush: chosen.every((d) => d.tool === 'brush')
  }
}
