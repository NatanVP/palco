import type { CanvasNode, FloorId, NewNode, Workspace } from '../../shared/model'
import type { WorkspaceStore } from './workspace-store'

/** `p` dentro de `from` passa para `to`; fora, fica como está. */
export function redirectPath(p: string, from: string | undefined, to: string): string {
  if (from === undefined || from === '') return p
  const base = from.replace(/\/+$/, '')
  if (p === base) return to
  if (p.startsWith(`${base}/`)) return to.replace(/\/+$/, '') + p.slice(base.length)
  return p
}

/**
 * Copia o layout inteiro de `source` (andares, nós, bandas, conexões) para `target`, com ids novos.
 * Caminhos dentro de `fromDir` vão para `toDir`. Nada é iniciado: os terminais só sobem quando alguém os abre.
 */
export function cloneWorkspaceLayout(source: Workspace, target: WorkspaceStore, fromDir: string | undefined, toDir: string): void {
  const move = (p: string): string => redirectPath(p, fromDir, toDir)
  const floorIds = new Map<string, string>()
  for (const f of Object.values(source.floors)) {
    const { id: _id, camera: _camera, createdAt: _createdAt, status: _status, ...rest } = f
    floorIds.set(f.id, target.addFloor({ ...rest, dir: move(f.dir), repoRoot: move(f.repoRoot) }))
  }
  const floorOf = (id: FloorId): FloorId => (id === null ? null : floorIds.get(id) ?? null)
  const nodeIds = new Map<string, string>()
  const all = Object.values(source.nodes)
  // Terminais primeiro (as bandas apontam para eles); quem recrutou quem só vale entre os copiados.
  const ordered: CanvasNode[] = [...all.filter((n) => n.kind !== 'band'), ...all.filter((n) => n.kind === 'band')]
  for (const n of ordered) {
    // O grupo é refeito no destino, abaixo.
    const { id: _id, groupId: _group, ...rest } = structuredClone(n)
    let copy = { ...rest, floorId: floorOf(n.floorId) } as NewNode
    // A nota ligada vira cópia solta: dois workspaces não escrevem no mesmo arquivo.
    if (copy.kind === 'note') { delete copy.linkedFile; delete copy.fileMissing }
    if (copy.kind === 'terminal') {
      const { recruitedBy, ...t } = copy
      copy = { ...t, cwd: move(t.cwd), ...(recruitedBy !== undefined && nodeIds.has(recruitedBy) ? { recruitedBy: nodeIds.get(recruitedBy)! } : {}) }
    } else if (copy.kind === 'band') {
      const members = copy.members.map((m) => nodeIds.get(m)).filter((m): m is string => m !== undefined)
      if (members.length === 0) continue
      copy = { ...copy, members }
    } else if ('path' in copy && typeof copy.path === 'string') {
      copy = { ...copy, path: move(copy.path) } as NewNode
    }
    nodeIds.set(n.id, target.addNode(copy))
  }
  for (const [id, group] of Object.entries(source.groups ?? {})) {
    const members = all.flatMap((n) => { const copied = n.groupId === id ? nodeIds.get(n.id) : undefined; return copied === undefined ? [] : [copied] })
    const created = members.length ? target.groupNodes(members) : null
    if (created === null) continue
    target.renameGroup(created, group.name)
    if (group.color !== undefined) target.setGroupColor(created, group.color)
  }
  for (const [stackId, name] of Object.entries(source.stackNames ?? {})) target.setStackName(stackId, name)
  for (const c of source.connections) {
    const a = nodeIds.get(c.a), b = nodeIds.get(c.b)
    if (a !== undefined && b !== undefined) target.connect(a, b)
  }
}
