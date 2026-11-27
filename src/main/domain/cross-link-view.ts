import type { CanvasNode, CrossLinkEnd, CrossLinkView, WorkspaceMeta } from '../../shared/model'
import type { CrossLink } from './cross-links'

export interface CrossLinkLookup {
  node(id: string): CanvasNode | undefined
  /** Id do workspace dono do nó. */
  workspaceOf(id: string): string | undefined
  list(): WorkspaceMeta[]
}

/** Cordas entre workspaces com as duas pontas resolvidas (nome, workspace, andar); pontas que sumiram ficam de fora. */
export function crossLinkViews(links: readonly CrossLink[], lookup: CrossLinkLookup): CrossLinkView[] {
  const names = new Map(lookup.list().map((w) => [w.id, w.name]))
  const end = (id: string): CrossLinkEnd | undefined => {
    const node = lookup.node(id)
    const wsId = lookup.workspaceOf(id)
    if (!node || wsId === undefined) return undefined
    return { id, name: node.name, workspaceId: wsId, workspace: names.get(wsId) ?? wsId, floorId: node.floorId }
  }
  return links.flatMap((l) => {
    const a = end(l.a), b = end(l.b)
    return a && b && a.workspaceId !== b.workspaceId ? [{ id: l.id, a, b }] : []
  })
}
