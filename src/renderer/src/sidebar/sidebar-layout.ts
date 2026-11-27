import { HOME_PAGE_ID, type Sidebar, type WorkspaceMeta } from '../../../shared/model'
import { t } from '../i18n'

export const SIDEBAR_DEFAULT = 260
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 480

/** Largura da barra lateral entre 200 e 480 px; valor inválido volta ao padrão. */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_DEFAULT
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)))
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Filtro da barra: ignora caixa e acentos; vazio mostra tudo. */
export function filterWorkspaces<T extends Pick<WorkspaceMeta, 'name'>>(list: T[], query: string): T[] {
  const q = fold(query.trim())
  return q === '' ? list : list.filter((w) => fold(w.name).includes(q))
}

/** Texto da pílula de terminais: vazio com zero, "99+" acima de 99. */
export function countLabel(n: number): string {
  return n <= 0 ? '' : n > 99 ? '99+' : String(n)
}

/**
 * Índice de inserção de `dragged` no grupo, calculado sobre a lista COMPLETA do grupo (o filtro só esconde itens):
 * antes ou depois da âncora; sem âncora, no fim.
 */
export function dropIndex(groupIds: string[], dragged: string, anchor: { id: string; after: boolean } | undefined): number {
  const rest = groupIds.filter((id) => id !== dragged)
  const at = anchor ? rest.indexOf(anchor.id) : -1
  return at === -1 ? rest.length : at + (anchor!.after ? 1 : 0)
}

/** A barra lateral oculta sobrevive ao recarregar (por máquina, como a largura). */
export const SIDEBAR_HIDDEN_KEY = 'palco.sidebarHidden'

export function readSidebarHidden(storage: Storage): boolean {
  try { return storage.getItem(SIDEBAR_HIDDEN_KEY) === '1' } catch { return false }
}

export function writeSidebarHidden(storage: Storage, hidden: boolean): void {
  try { storage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? '1' : '0') } catch { /* sem storage: vale só nesta sessão */ }
}

/** Modo mini da barra lateral: recolhida, mostra o trilho. Vem ligado; por máquina, como o resto. */
export const SIDEBAR_RAIL_KEY = 'palco.miniSidebar'

export function readSidebarRail(storage: Storage): boolean {
  try { return storage.getItem(SIDEBAR_RAIL_KEY) !== '0' } catch { return true }
}

export function writeSidebarRail(storage: Storage, rail: boolean): void {
  try { storage.setItem(SIDEBAR_RAIL_KEY, rail ? '1' : '0') } catch { /* sem storage: vale só nesta sessão */ }
}

export interface RailState { hidden: boolean; rail: boolean }

/** "Alternar Mini Barra Lateral": aberta, liga o modo mini e recolhe; recolhida, só inverte o modo mini. */
export function toggleRail(s: RailState): RailState {
  return s.hidden ? { hidden: true, rail: !s.rail } : { hidden: true, rail: true }
}

/** O trilho aparece com a barra recolhida e o modo mini ligado; o item do menu marca nesse mesmo caso. */
export const railVisible = (s: RailState): boolean => s.hidden && s.rail

/** Com o trilho visível, os docks e o canvas da esquerda ganham este recuo (62 px: trilho de 52 + folga). */
export const RAIL_INSET = 62
export const railInset = (s: RailState): number => (railVisible(s) ? RAIL_INSET : 0)

/** Alt+seta no item do trilho: um passo dentro do mesmo grupo (soltos ou de um grupo); nas pontas, nada. */
export function railMove(sidebar: Pick<Sidebar, 'workspaces' | 'order' | 'activePage'>, id: string, dir: 1 | -1): { spaceId: string | null; index: number } | null {
  const me = sidebar.workspaces.find((w) => w.id === id)
  if (!me) return null
  const byId = new Map(sidebar.workspaces.map((w) => [w.id, w]))
  const group = sidebar.order.filter((x) => { const w = byId.get(x); return w && w.spaceId === me.spaceId && (w.pageId ?? HOME_PAGE_ID) === (me.pageId ?? HOME_PAGE_ID) })
  const at = group.indexOf(id), to = at + dir
  return at < 0 || to < 0 || to >= group.length ? null : { spaceId: me.spaceId, index: to }
}

export interface RailItem { id: string; name: string; icon: string | undefined; color: string | undefined; terminals: number; active: boolean; locked: boolean; attention: number }

/** Workspaces do Espaço ativo na ordem da barra (soltos e de grupos misturados, como `order` os lista). */
export function railItems(sidebar: Pick<Sidebar, 'workspaces' | 'order' | 'activePage' | 'active'>, attention: Readonly<Record<string, number>> = {}): RailItem[] {
  const byId = new Map(sidebar.workspaces.map((w) => [w.id, w]))
  return sidebar.order.flatMap((id) => {
    const w = byId.get(id)
    if (!w || (w.pageId ?? HOME_PAGE_ID) !== sidebar.activePage) return []
    return [{ id: w.id, name: w.name, icon: w.icon, color: w.color, terminals: w.terminals ?? 0, active: w.id === sidebar.active, locked: w.locked === true, attention: attention[w.id] ?? 0 }]
  })
}

/** Dica ao passar o mouse no item do trilho: o nome e quantos terminais. */
export function railHint(name: string, terminals: number): { text: string; detail: string | null } {
  return { text: name || t('sidebar.sidebar-layout.sem_titulo'), detail: terminals > 0 ? `${terminals} ${terminals === 1 ? 'terminal' : 'terminais'}` : null }
}
