import type { CanvasNode, DockEdge, DockState } from '../../../shared/model'
import { LIFT_TOP_INSET, type PanelRect } from './lift'

export type { DockEdge, DockState }
export const EMPTY_DOCK: DockState = { dockedId: null, edge: 'trailing', memory: [], liftedId: null }

export type PanelKind = 'note' | 'wide' | 'tree'
export const panelKindOf = (n: Pick<CanvasNode, 'kind'>): PanelKind => (n.kind === 'note' ? 'note' : n.kind === 'filetree' ? 'tree' : 'wide')
/** Largura inicial do painel encaixado por tipo (`dockDefaultWidth`). */
export const dockDefaultWidth = (k: PanelKind): number => (k === 'note' ? 400 : k === 'tree' ? 340 : 520)

export const DOCK_MIN_WIDTH = 280
const GAP = 12, BOTTOM_LEADING = 16, BOTTOM_TRAILING = 64, MAX_SHARE = 0.5
/** Faixa de cada borda em que soltar o painel o encaixa, e quanto o encaixado precisa andar para o centro para virar elevado. */
export const DOCK_ZONE = 110
export const DOCK_LEAVE = 140

/** Retângulo do painel encaixado em pixels de tela: largura entre 280 px e metade da área livre, com altura limitada pelo rodapé. */
export function dockRect(kind: PanelKind, edge: DockEdge, view: { w: number; h: number }, o: { leadingInset: number; width?: number }): PanelRect {
  const max = Math.max((view.w - o.leadingInset) * MAX_SHARE, DOCK_MIN_WIDTH)
  const w = Math.min(Math.max(o.width ?? dockDefaultWidth(kind), DOCK_MIN_WIDTH), max)
  const y = LIFT_TOP_INSET, h = Math.max(view.h - y - (edge === 'trailing' ? BOTTOM_TRAILING : BOTTOM_LEADING), 240)
  return { x: edge === 'leading' ? o.leadingInset + GAP : view.w - w - GAP, y, w, h }
}

/**
 * Onde o painel arrastado vai parar: perto de uma borda encaixa nela; o já encaixado que anda 140 px para o centro vira elevado;
 * senão fica. A faixa da frente começa depois do recuo da barra lateral.
 */
export function dockZone(p: { x: number; translation: number }, s: DockState, view: { w: number; h: number }, leadingInset: number, id?: string): { kind: 'dock'; edge: DockEdge } | { kind: 'center' } | { kind: 'stay' } {
  if (p.x <= leadingInset + DOCK_ZONE) return { kind: 'dock', edge: 'leading' }
  if (p.x >= view.w - DOCK_ZONE) return { kind: 'dock', edge: 'trailing' }
  if (id !== undefined && s.dockedId === id && Math.abs(p.translation) >= DOCK_LEAVE) return { kind: 'center' }
  return { kind: 'stay' }
}

const remember = (memory: string[], id: string): string[] => (memory.includes(id) ? memory : [...memory, id])
/** Eleva o nó; se estava encaixado, deixa de estar. */
export const liftNode = (s: DockState, id: string): DockState => ({ ...s, dockedId: s.dockedId === id ? null : s.dockedId, liftedId: id })
export const dismissLift = (s: DockState): DockState => ({ ...s, liftedId: null })
/** Encaixa o nó na borda (troca o que estava encaixado) e o lembra; se estava elevado, deixa de estar. */
export const dockNode = (s: DockState, id: string, edge: DockEdge): DockState => ({ dockedId: id, edge, memory: remember(s.memory, id), liftedId: s.liftedId === id ? null : s.liftedId })
export const landDocked = (s: DockState): DockState => ({ ...s, dockedId: null })
/** Apresenta o nó: o que já foi encaixado volta encaixado; os outros são elevados. */
export const presentPanel = (s: DockState, id: string): DockState => (s.memory.includes(id) ? dockNode(s, id, s.edge) : liftNode(s, id))
/** O atalho de elevar: com algo elevado, recolhe; no encaixado, desencaixa; senão apresenta o nó. */
export function togglePanel(s: DockState, id: string): DockState {
  if (s.liftedId !== null) return dismissLift(s)
  if (s.dockedId === id) return landDocked(s)
  return presentPanel(s, id)
}

/** Tira do estado o que não existe mais (nó apagado, ou elevado e encaixado ao mesmo tempo: o encaixe vence). */
export function sanitizeDock(s: DockState, exists: ReadonlySet<string>): DockState {
  const dockedId = s.dockedId && exists.has(s.dockedId) ? s.dockedId : null
  const liftedId = s.liftedId && exists.has(s.liftedId) && s.liftedId !== dockedId ? s.liftedId : null
  return { dockedId, edge: s.edge, memory: s.memory.filter((id) => exists.has(id)), liftedId }
}
