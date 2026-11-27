import type { FloorId, Vec, Workspace } from '../../../shared/model'
import { fmt } from '../i18n'

/** Uma ponta da corda no menu: ícone (nome lucide do terminal ou o tipo do nó), cor e, se estiver em outro andar, o andar. */
export interface RopeEndpoint { nodeId: string; floorId: FloorId; name: string; icon: string; tint: string | null; place: string | null }
export interface RopeRow { ropeId: string; endpoints: RopeEndpoint[] }

function endpointOf(ws: Workspace, id: string): (RopeEndpoint & { cx: number }) | null {
  const n = ws.nodes[id]
  if (!n) return null
  const place = n.floorId === ws.activeFloor ? null : (n.floorId === null ? 'Ground' : (ws.floors[n.floorId]?.name ?? n.floorId))
  const icon = n.kind === 'terminal' ? (n.icon ?? 'terminal') : n.kind === 'band' ? (n.icon ?? 'band') : n.kind
  const tint = (n.kind === 'terminal' || n.kind === 'band') ? (n.color ?? null) : null
  return { nodeId: n.id, floorId: n.floorId, name: n.name, icon, tint, place, cx: n.pos.x + n.size.w / 2 }
}

/** Linhas do menu, na ordem pedida (a corda de cima primeiro); cordas ou pontas que não existem mais ficam de fora. */
export function ropeRows(ws: Workspace, ropeIds: readonly string[]): RopeRow[] {
  const rows: RopeRow[] = []
  for (const ropeId of ropeIds) {
    const c = ws.connections.find((x) => x.id === ropeId)
    const a = c && endpointOf(ws, c.a), b = c && endpointOf(ws, c.b)
    if (!c || !a || !b) continue
    const [left, right] = [a, b].sort((p, q) => p.cx - q.cx)
    rows.push({ ropeId, endpoints: [left!, right!].map(({ cx: _cx, ...e }) => e) })
  }
  return rows
}

/** "A e B", para o leitor de tela e o rótulo do botão de cortar. */
export function ropeLabel(row: RopeRow): string {
  return fmt().list(row.endpoints.map((e) => e.name))
}

/** Centrado no clique, 6 px abaixo (acima se não couber), com 8 px de margem da janela. */
export function popoverPosition(at: { x: number; y: number }, box: { w: number; h: number }, view: { w: number; h: number }): { left: number; top: number } {
  const margin = 8, gap = 6
  const left = Math.max(margin, Math.min(at.x - box.w / 2, view.w - margin - box.w))
  const below = at.y + gap
  const top = below + box.h > view.h - margin ? Math.max(margin, at.y - gap - box.h) : below
  return { left, top }
}

/** Os ids de corda sob o ponteiro (do mais acima ao mais abaixo), sem repetir. */
export function uniqueRopeIds(ids: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))]
}

/** Limiares de acerto (px de tela) do palco: o menor que alcança alguma corda manda; ele alarga em +6, até 14. */
export const ROPE_THRESHOLDS = [3, 8, 14] as const
export const ROPE_WIDEN = 6
export const ROPE_MAX = 14

function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
/** Menor distância do ponto à polilinha (um ponto só vale como ponto; sem pontos, infinita). */
export function distanceToPolyline(p: Vec, points: readonly Vec[]): number {
  if (!points.length) return Infinity
  if (points.length === 1) return Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y)
  let best = Infinity
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1]!, points[i]!))
  return best
}
/**
 * As cordas que um clique pega: os limiares 3/8/14 px de tela são divididos pelo zoom; acha o MENOR em que alguma
 * corda está a essa distância, alarga em +6 px (teto 14) e devolve todas as cordas dentro, a de cima (a última da lista) primeiro.
 * Por isso duas cordas a ~9 px viram duas linhas no mesmo menu.
 */
export function ropesAt(ropes: ReadonlyArray<{ id: string; points: readonly Vec[] }>, world: Vec, zoom: number): string[] {
  const z = zoom > 0 ? zoom : 1
  const dist = ropes.map(r => ({ id: r.id, d: distanceToPolyline(world, r.points) }))
  const hit = ROPE_THRESHOLDS.find(t => dist.some(r => r.d <= t / z))
  if (hit === undefined) return []
  const wide = Math.min(hit + ROPE_WIDEN, ROPE_MAX) / z
  return dist.filter(r => r.d <= wide).map(r => r.id).reverse()
}
