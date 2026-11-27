import { MAX_HISTORY_BATCH, type HistoryOperation } from '../../../../shared/api'
import type { CanvasNode, Drawing, FloorId, NewNode, Vec, Workspace } from '../../../../shared/model'
import { snap } from '../camera'
import { t } from '../../i18n'
import { isHeld, removableIds } from '../../../../shared/lock'
import { MIN_GROUP } from '../../../../shared/groups'
import { drawingBox, frameRect, type Rect } from './lasso'

/** O main recusa lotes grandes demais; o renderer confere antes de enviar para avisar em vez de falhar em silêncio. */
export const batchTooLarge = (ops: readonly unknown[]): boolean => ops.length > MAX_HISTORY_BATCH
export const batchTooLargeMessage = (): string => t('canvas.selection.group.selecao_grande_demais', { max: MAX_HISTORY_BATCH })

/** Elemento bloqueado (ou nota com o conteúdo travado) fica onde está: a seleção o inclui, mas o movimento (arrasto, setas) o ignora. */
export const isLockedNode = (n: CanvasNode): boolean => n.positionLocked === true || (n.kind === 'note' && n.locked === true)
/** A mesma pergunta com o fichário em conta (`shared/lock.ts`): um membro bloqueado segura o conjunto. */
export const isImmovable = (ws: Workspace, n: CanvasNode): boolean => isLockedNode(n) || isHeld(ws.nodes, n)
/** Dos ids da seleção, os que podem se mover (existem, não são banda nem estão presos no lugar). */
export const movableNodeIds = (ws: Workspace, ids: readonly string[]): string[] => ids.filter((id) => { const n = ws.nodes[id]; return !!n && n.kind !== 'band' && !isImmovable(ws, n) })

/** Apagar a seleção (menos o que está bloqueado): um lote só (uma transação; Ctrl+Z traz tudo de volta, terminal com processo novo). */
export function deleteOperations(ws: Workspace, nodeIds: readonly string[], drawingIds: readonly string[]): HistoryOperation[] {
  return [
    ...removableIds(ws.nodes, nodeIds).map((id): HistoryOperation => ({ type: 'node.remove', id })),
    ...drawingIds.filter((id) => ws.drawings?.some((d) => d.id === id && !d.locked)).map((id): HistoryOperation => ({ type: 'drawing.remove', id }))
  ]
}

const withoutId = ({ id: _id, ...rest }: Drawing): Omit<Drawing, 'id'> => rest
const shiftPoints = (d: Omit<Drawing, 'id'>, by: Vec): Omit<Drawing, 'id'> => ({ ...d, points: d.points.map((p) => ({ x: p.x + by.x, y: p.y + by.y })) })

/**
 * Mover a seleção pelo mesmo delta (encaixado na grade, para nós e desenhos ficarem alinhados), numa transação.
 * O histórico não tem patch de desenho: o desenho movido é recriado deslocado no mesmo lote.
 */
export function moveOperations(ws: Workspace, nodeIds: readonly string[], drawingIds: readonly string[], delta: Vec, opts: { snap?: boolean } = {}): HistoryOperation[] {
  const by = opts.snap === false ? { x: delta.x, y: delta.y } : { x: snap(delta.x), y: snap(delta.y) }
  if (by.x === 0 && by.y === 0) return []
  const drawings = (ws.drawings ?? []).filter((d) => drawingIds.includes(d.id) && !d.locked)
  return [
    ...nodeIds.flatMap((id): HistoryOperation[] => {
      const n = ws.nodes[id]
      return n && n.kind !== 'band' && !isImmovable(ws, n) ? [{ type: 'node.patch', id, patch: { pos: { x: n.pos.x + by.x, y: n.pos.y + by.y } } }] : []
    }),
    ...drawings.flatMap((d): HistoryOperation[] => [{ type: 'drawing.remove', id: d.id }, { type: 'drawing.add', drawing: shiftPoints(withoutId(d), by) }])
  ]
}

/** O que vai para a área de transferência do canvas: configurações (nunca processo, saída ou sessão) e a caixa de tudo. */
export interface CanvasClip {
  nodes: NewNode[]
  drawings: Array<Omit<Drawing, 'id'>>
  /** Cordas com as duas pontas copiadas, pelo índice em `nodes`; corda para um nó que ficou de fora não vem. */
  connections: Array<{ a: number; b: number }>
  /** Grupos com dois ou mais elementos entre os copiados, pelos índices em `nodes`. */
  groups?: Array<{ members: number[]; name: string; color?: string }>
  /** Nomes dos fichários copiados, pelo `stackId` de origem. */
  stackNames?: Record<string, string>
  box: Rect
}

/** Cópia do nó sem id nem vínculos: o terminal leva comando, pasta, conta, role e aparência; sobe processo novo ao colar. */
function cloneNode(n: CanvasNode): NewNode | null {
  const base = { floorId: n.floorId, name: n.name, pos: { ...n.pos }, size: { ...n.size }, ...(n.positionLocked && { positionLocked: true }) }
  switch (n.kind) {
    case 'terminal': {
      const { agent, command, cwd, accountId, role, color, icon, fontSize, monitor, themeId, darkThemeId, fontFamily, chatFontFamily, chatFontSize, environment, redacted } = n
      return {
        kind: 'terminal', ...base, agent, command, cwd,
        ...(themeId !== undefined && { themeId }), ...(darkThemeId !== undefined && { darkThemeId }), ...(fontFamily !== undefined && { fontFamily }),
        ...(chatFontFamily !== undefined && { chatFontFamily }), ...(chatFontSize !== undefined && { chatFontSize }), ...(environment !== undefined && { environment }), ...(redacted && { redacted }),
        ...(accountId !== undefined && { accountId }), ...(role !== undefined && { role }), ...(color !== undefined && { color }),
        ...(icon !== undefined && { icon }), ...(fontSize !== undefined && { fontSize }), ...(monitor !== undefined && { monitor })
      }
    }
    case 'note': {
      const { content, color, fontSize, fontFamily, locked, stackId, redacted, linkedFile } = n
      return {
        kind: 'note', ...base, content, ...(linkedFile !== undefined && { linkedFile }), ...(stackId !== undefined && { stackId }), ...(redacted && { redacted }),
        ...(color != null && { color }), ...(fontSize !== undefined && { fontSize }), ...(fontFamily !== undefined && { fontFamily }), ...(locked !== undefined && { locked })
      }
    }
    case 'portal': {
      const { url, userAgent, storage, muted } = n
      return { kind: 'portal', ...base, url, ...(muted && { muted }), ...(userAgent !== undefined && { userAgent }), ...(storage !== undefined && { storage }) }
    }
    case 'text': return { kind: 'text', ...base, text: n.text, fontSize: n.fontSize }
    case 'file': return { kind: 'file', ...base, path: n.path }
    case 'filetree': return { kind: 'filetree', ...base, root: n.root }
    case 'link': return { kind: 'link', ...base, url: n.url }
    default: return null
  }
}

function union(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Copia os nós (sem bandas) e os desenhos selecionados. */
export function captureSelection(ws: Workspace, nodeIds: readonly string[], drawingIds: readonly string[]): CanvasClip {
  const nodes = nodeIds.flatMap((id) => { const n = ws.nodes[id]; return n ? [n] : [] })
  const clones: NewNode[] = [], index = new Map<string, number>()
  for (const n of nodes) {
    const c = cloneNode(n)
    if (c) { index.set(n.id, clones.length); clones.push(c) }
  }
  const connections = ws.connections.flatMap((c) => {
    const a = index.get(c.a), b = index.get(c.b)
    return a !== undefined && b !== undefined ? [{ a, b }] : []
  })
  const drawings = (ws.drawings ?? []).filter((d) => drawingIds.includes(d.id))
  const groups = Object.entries(ws.groups ?? {}).flatMap(([id, group]) => {
    const members = nodes.flatMap((n) => { const at = index.get(n.id); return n.groupId === id && at !== undefined ? [at] : [] })
    return members.length >= MIN_GROUP ? [{ members, name: group.name, ...(group.color !== undefined && { color: group.color }) }] : []
  })
  const stackNames = Object.fromEntries(nodes.flatMap((n) => {
    const name = n.kind === 'note' && n.stackId ? ws.stackNames?.[n.stackId] : undefined
    return name === undefined ? [] : [[(n as { stackId: string }).stackId, name]]
  }))
  return {
    nodes: clones,
    connections,
    ...(groups.length && { groups }),
    ...(Object.keys(stackNames).length > 0 && { stackNames }),
    drawings: drawings.map(withoutId),
    box: union([...nodes.filter((n) => n.kind !== 'band').map(frameRect), ...drawings.map(drawingBox)])
  }
}

/** "Nome", "Nome 2", "Nome 3"... sem diferenciar maiúsculas; a cópia de "Nome 2" segue a série ("Nome 3"). */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base
  const stem = base.replace(/ \d+$/, '') || base
  for (let i = 2; ; i++) {
    const name = `${stem} ${i}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

/**
 * Colar (ou duplicar): um lote de node.add e drawing.add deslocados, no andar ativo, com nomes únicos, e as cordas
 * internas como connection.add apontando para os node.add pelo índice no lote. Tudo numa transação.
 */
export function pasteOperations(
  clip: CanvasClip, offset: Vec, existingNames: readonly string[], floorId: FloorId, newStackId: () => string = () => crypto.randomUUID()
): HistoryOperation[] {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()))
  // Fichário copiado inteiro vira um fichário novo (um id por fichário de origem); nota que veio sem as outras fica solta.
  const perStack = new Map<string, number>()
  for (const n of clip.nodes) if (n.kind === 'note' && n.stackId) perStack.set(n.stackId, (perStack.get(n.stackId) ?? 0) + 1)
  const stackIds = new Map<string, string>()
  const nodes = clip.nodes.map((n): HistoryOperation => {
    const name = uniqueName(n.name, taken)
    taken.add(name.toLowerCase())
    const { stackId: from, ...rest } = n as NewNode & { stackId?: string }
    const stackId = n.kind === 'note' && from && (perStack.get(from) ?? 0) >= 2
      ? (stackIds.get(from) ?? stackIds.set(from, newStackId()).get(from)!)
      : undefined
    return { type: 'node.add', node: { ...rest, ...(stackId && { stackId }), name, floorId, pos: { x: n.pos.x + offset.x, y: n.pos.y + offset.y } } as NewNode }
  })
  const drawings = clip.drawings.map((d): HistoryOperation => ({ type: 'drawing.add', drawing: { ...shiftPoints(d, offset), floorId } }))
  // Os node.add vêm primeiro: o índice do nó na cópia é o índice da operação no lote.
  const ropes = (clip.connections ?? []).map((c): HistoryOperation => ({ type: 'connection.add', a: { op: c.a }, b: { op: c.b } }))
  const groups = (clip.groups ?? []).map((g): HistoryOperation => ({ type: 'group.create', members: g.members.map((op) => ({ op })), name: g.name, ...(g.color !== undefined && { color: g.color }) }))
  const names = [...stackIds].flatMap(([from, id]): HistoryOperation[] => (clip.stackNames?.[from] === undefined ? [] : [{ type: 'stack.rename', id, name: clip.stackNames[from]! }]))
  return [...nodes, ...drawings, ...ropes, ...groups, ...names]
}

/** Deslocamento para colar: a caixa copiada vai para o centro da vista; cada colagem repetida soma 30. */
export function pasteOffset(box: Rect, viewCenter: Vec, repeat: number): Vec {
  return { x: Math.round(viewCenter.x - (box.x + box.w / 2) + 30 * repeat), y: Math.round(viewCenter.y - (box.y + box.h / 2) + 30 * repeat) }
}

/** Duplicar: a cópia aparece 30 unidades abaixo e à direita. */
export const DUPLICATE_OFFSET: Vec = { x: 30, y: 30 }
