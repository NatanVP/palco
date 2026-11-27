import type { CanvasNode, Drawing, Vec, Workspace } from '../../../../shared/model'

export interface Rect { x: number; y: number; w: number; h: number }
/** Ids selecionados: nós e desenhos (conjuntos separados). */
export interface CanvasSelection { nodes: ReadonlySet<string>; drawings: ReadonlySet<string> }
export interface Hits { nodes: string[]; drawings: string[] }

/** Retângulo do laço a partir de dois cantos, em qualquer direção. */
export function normRect(a: Vec, b: Vec): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

/** Metade da espessura que aparece na tela (marca-texto é 4×; o pincel tem raio = espessura). */
function halfStroke(d: Drawing): number {
  if (d.tool === 'highlighter') return d.width * 2
  if (d.tool === 'brush') return d.width
  return d.width / 2
}

/** Caixa do desenho com a espessura visível. */
export function drawingBox(d: Drawing): Rect {
  const xs = d.points.map((p) => p.x), ys = d.points.map((p) => p.y), pad = halfStroke(d)
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 }
}

export const frameRect = (n: Pick<CanvasNode, 'pos' | 'size'>): Rect => ({ x: n.pos.x, y: n.pos.y, w: n.size.w, h: n.size.h })

/** Interseção estrita dos retângulos: só encostar a borda, sem área em comum, não conta. */
export const intersects = (a: Rect, b: Rect): boolean =>
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)

/** O que o laço pega no andar ativo: nós (sem bandas; fichário vai inteiro) e desenhos que tocam o retângulo. */
export function lassoHits(rect: Rect, ws: Workspace): Hits {
  const floor = ws.activeFloor
  const nodes = Object.values(ws.nodes).filter((n) => n.floorId === floor && n.kind !== 'band' && intersects(rect, frameRect(n)))
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) {
    if (n.kind !== 'note' || !n.stackId) continue
    for (const m of Object.values(ws.nodes)) if (m.kind === 'note' && m.stackId === n.stackId && m.floorId === floor) ids.add(m.id)
  }
  const drawings = (ws.drawings ?? []).filter((d) => d.floorId === floor && intersects(rect, drawingBox(d))).map((d) => d.id)
  return { nodes: [...ids], drawings }
}

/** Ctrl+A: tudo o que há no andar ativo (nós sem bandas, o fichário inteiro, e os desenhos), esteja onde estiver. */
export function selectAllHits(ws: Workspace): Hits {
  const floor = ws.activeFloor
  const ids = new Set<string>()
  for (const n of Object.values(ws.nodes)) if (n.floorId === floor && n.kind !== 'band') ids.add(n.id)
  return { nodes: [...ids], drawings: (ws.drawings ?? []).filter((d) => d.floorId === floor).map((d) => d.id) }
}

/** Shift soma ao que já estava (união, sem alternar); sem Shift, o laço substitui a seleção. */
export function mergeSelection(prev: CanvasSelection, hits: Hits, additive: boolean): { nodes: Set<string>; drawings: Set<string> } {
  return additive
    ? { nodes: new Set([...prev.nodes, ...hits.nodes]), drawings: new Set([...prev.drawings, ...hits.drawings]) }
    : { nodes: new Set(hits.nodes), drawings: new Set(hits.drawings) }
}
