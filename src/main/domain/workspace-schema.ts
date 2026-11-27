import { DRAW_FILLS, DRAW_KINDS, DRAW_PATTERNS } from '../../shared/model'
import type { AgentKind, Workspace } from '../../shared/model'
import { invalidNodeExtras } from './node-extras'
import { invalidTerminalExtras, takesRole } from './terminal-extras'
import { slugFloorName } from './floor-name'
import { normalizeAgentCommand } from './command'
import { pruneGroups } from '../../shared/groups'
import { isNoteFilePath } from '../../shared/note-file'
import { insideRoot } from '../../shared/tree-path'
import { isWebUrl } from '../../shared/link'
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const vector = (v: unknown): boolean => object(v) && finite(v.x) && finite(v.y)
const dockState = (v: unknown): boolean => object(v) && (v.edge === 'leading' || v.edge === 'trailing') && Array.isArray(v.memory) && v.memory.length <= 100 && v.memory.every((m) => text(m))
  && (v.dockedId === null || text(v.dockedId)) && (v.liftedId === null || text(v.liftedId))
const camera = (v: unknown): boolean => object(v) && vector(v.offset) && finite(v.zoom) && v.zoom > 0
const text = (v: unknown): v is string => typeof v === 'string'

export function validateWorkspace(value: unknown, warn: (message: string) => void = () => {}): Workspace {
  const fail = (): never => { throw new Error('workspace inválido') }
  if (!object(value) || !text(value.id) || !value.id || !text(value.name) || !object(value.nodes)
    || !Array.isArray(value.connections)) return fail()
  if (value.dockState !== undefined && !dockState(value.dockState)) { delete value.dockState; warn('dockState do Ground descartado') }
  if (!camera(value.camera)) { value.camera = { offset: { x: 0, y: 0 }, zoom: 1 }; warn('camera do Ground reparada') }
  // Workspaces sem andares são migrados para o Ground.
  if (value.floors === undefined) value.floors = {}
  if (value.activeFloor === undefined) value.activeFloor = null
  if (!object(value.floors)) return fail()
  const slugs = new Set<string>()
  for (const [id, floor] of Object.entries(value.floors)) {
    let slug: string | undefined
    try { if (object(floor) && text(floor.name)) slug = slugFloorName(floor.name) } catch { /* unrecoverable floor name */ }
    if (!object(floor) || !id || floor.id !== id || !slug || slugs.has(slug)
      || !['repoRoot', 'dir', 'branch', 'baseRef'].every(key => text(floor[key]) && ((floor[key] as string).trim() !== '' || (floor.plain === true && (key === 'branch' || key === 'baseRef'))))
      || !finite(floor.createdAt)) {
      delete value.floors[id]
      warn('floor inválido descartado')
      continue
    }
    slugs.add(slug)
    if (floor.dockState !== undefined && !dockState(floor.dockState)) { delete floor.dockState; warn('dockState de floor descartado') }
    if (!camera(floor.camera)) { floor.camera = { offset: { x: 0, y: 0 }, zoom: 1 }; warn('camera de floor reparada') }
    if (floor.copy !== undefined && floor.copy !== true) delete floor.copy
    const pr = floor.pullRequest
    if (pr !== undefined && !(object(pr) && Number.isInteger(pr.number) && text(pr.url) && text(pr.title) && typeof pr.sameRepository === 'boolean')) { delete floor.pullRequest; warn('pull request de floor inválido removido') }
    if (floor.status !== undefined && (!object(floor.status)
      || typeof floor.status.state !== 'string' || !['working', 'blocked', 'review', 'done'].includes(floor.status.state)
      || (floor.status.progress !== undefined && !text(floor.status.progress))
      || (floor.status.text !== undefined && !text(floor.status.text)))) {
      delete floor.status
      warn('status de floor inválido removido')
    }
  }
  if (value.stackNames !== undefined && (!object(value.stackNames) || !Object.values(value.stackNames).every(v => text(v)))) {
    delete value.stackNames
    warn('nomes de fichário inválidos removidos')
  }
  if (value.groups !== undefined && (!object(value.groups) || !Object.values(value.groups).every(g => object(g) && text(g.name) && (g.color === undefined || (text(g.color) && /^#[0-9a-fA-F]{6}$/.test(g.color)))))) {
    delete value.groups
    warn('grupos inválidos removidos')
  }
  for (const node of Object.values(value.nodes) as Array<Record<string, unknown>>) {
    if (!object(node)) continue
    if (node.groupId !== undefined && !text(node.groupId)) delete node.groupId
    if (node.current !== undefined && !(node.kind === 'filetree' && text(node.root) && text(node.current) && insideRoot(node.root, node.current))) delete node.current
    if (node.linkedFile !== undefined && !isNoteFilePath(node.linkedFile)) { delete node.linkedFile; warn('vínculo de nota com arquivo inválido removido') }
    if (node.fileMissing !== undefined && (node.fileMissing !== true || node.linkedFile === undefined)) delete node.fileMissing
  }
  if (value.groundStatus !== undefined && (!object(value.groundStatus) || typeof value.groundStatus.state !== 'string'
    || !['working', 'blocked', 'review', 'done'].includes(value.groundStatus.state)
    || (value.groundStatus.progress !== undefined && !text(value.groundStatus.progress))
    || (value.groundStatus.text !== undefined && !text(value.groundStatus.text)))) {
    delete value.groundStatus
    warn('status do térreo inválido removido')
  }
  if (!(value.activeFloor === null || (text(value.activeFloor) && Object.hasOwn(value.floors, value.activeFloor)))) {
    value.activeFloor = null
    warn('activeFloor inválido restaurado para Ground')
  }

  for (const [id, node] of Object.entries(value.nodes)) {
    if (object(node) && node.floorId === undefined) node.floorId = null
    if (object(node) && !(node.floorId === null || (text(node.floorId) && Object.hasOwn(value.floors, node.floorId)))) {
      node.floorId = null
      warn('floorId de nó inválido restaurado para Ground')
    }
    if (!object(node) || node.id !== id || !id || !text(node.name) || !vector(node.pos)
      || !object(node.size) || !finite(node.size.w) || node.size.w <= 0 || !finite(node.size.h) || node.size.h <= 0) return fail()
    // Marcas do menu do elemento: o que não for booleano sai com aviso.
    for (const key of ['positionLocked', 'redacted', 'unloaded', 'muted']) {
      if (node[key] !== undefined && typeof node[key] !== 'boolean') { delete node[key]; warn(`${key} inválido removido de '${node.name}'`) }
    }
    if (node.kind === 'note' || node.kind === 'portal') {
      // Campos opcionais de nota e portal (cor, fonte, trava, fichário, moldura): inválido sai com aviso.
      for (const key of invalidNodeExtras(node.kind, node)) {
        delete node[key]
        warn(`${key} inválido removido de '${node.name}'`)
      }
    }
    if (node.kind === 'note') { if (!text(node.content)) return fail() }
    else if (node.kind === 'terminal') {
      if (typeof node.agent !== 'string' || !['claude', 'codex', 'antigravity', 'shell', 'other'].includes(node.agent) || !text(node.command) || !text(node.cwd)) return fail()
      // Campos reparáveis: saem com aviso, o resto do workspace abre.
      if (node.autoStart !== undefined && typeof node.autoStart !== 'boolean') {
        delete node.autoStart
        warn(`autoStart inválido removido do terminal '${node.name}'`)
      }
      for (const key of invalidTerminalExtras(node)) {
        delete node[key]
        warn(`${key} inválido removido do terminal '${node.name}'`)
      }
      if (node.role !== undefined && (!text(node.role) || !node.role.trim() || !takesRole(node.agent))) {
        delete node.role
        warn(`role inválido removido do terminal '${node.name}'`)
      }
      if (node.recruitedBy !== undefined && !text(node.recruitedBy)) return fail()
      node.command = normalizeAgentCommand(node.agent as AgentKind, node.command)
    } else if (node.kind === 'text') { if (!text(node.text) || !finite(node.fontSize) || node.fontSize <= 0) return fail() }
    else if (node.kind === 'file') { if (!text(node.path)) return fail() }
    else if (node.kind === 'filetree') { if (!text(node.root)) return fail() }
    else if (node.kind === 'portal') { if (!text(node.url)) return fail() }
    else if (node.kind === 'band') {
      if (!Array.isArray(node.members) || !node.members.every(text)) return fail()
      // Visual inválido some (não derruba o workspace).
      if (node.icon !== undefined && (!text(node.icon) || node.icon.length > 48)) delete node.icon
      if (node.color !== undefined && (!text(node.color) || !/^#[0-9a-fA-F]{6}$/.test(node.color))) delete node.color
    }
    else if (node.kind === 'text') { if (!text(node.text) || !finite(node.fontSize) || node.fontSize <= 0) return fail() }
    else if (node.kind === 'file') { if (!text(node.path)) return fail() }
    else if (node.kind === 'filetree') { if (!text(node.root)) return fail() }
    else if (node.kind === 'link') { if (!isWebUrl(node.url)) return fail() }
    else return fail()
  }
  // Membership can become stale when a terminal is removed or moved. It never
  // grants reachability to missing, non-terminal or cross-floor nodes.
  for (const node of Object.values(value.nodes)) {
    if (object(node) && node.kind === 'band') node.members = [...new Set((node.members as string[]).filter(id => {
      const member = (value.nodes as Record<string, unknown>)[id]
      return object(member) && member.kind === 'terminal' && member.floorId === node.floorId
    }))]
  }
  for (const edge of value.connections) {
    if (!object(edge) || !text(edge.id) || !text(edge.a) || !text(edge.b)
      || !Object.hasOwn(value.nodes, edge.a) || !Object.hasOwn(value.nodes, edge.b)) return fail()
    const a = value.nodes[edge.a] as Record<string, unknown>, b = value.nodes[edge.b] as Record<string, unknown>
    // Entre floors só terminal↔terminal (orquestrador ↔ recrutado), como o store permite.
    if (a.floorId !== b.floorId && (a.kind !== 'terminal' || b.kind !== 'terminal')) return fail()
    if (a.kind === 'band' && b.kind === 'band') return fail()
  }
  if (value.drawings === undefined) value.drawings = []
  if (!Array.isArray(value.drawings)) return fail()
  value.drawings = (value.drawings as unknown[]).filter((d) => object(d) && text(d.id) && (d.floorId === null || text(d.floorId))
    && Array.isArray(d.points) && (d.points as unknown[]).every(vector) && text(d.color) && finite(d.width) && d.width > 0)
  // Ferramenta ou padrão desconhecidos (arquivo de versão futura ou editado à mão) saem; o traço fica, como caneta sólida.
  for (const d of value.drawings as Array<Record<string, unknown>>) {
    if (d.tool !== undefined && !(DRAW_KINDS as readonly unknown[]).includes(d.tool)) delete d.tool
    if (d.pattern !== undefined && !(DRAW_PATTERNS as readonly unknown[]).includes(d.pattern)) delete d.pattern
    if (d.fill !== undefined && !(DRAW_FILLS as readonly unknown[]).includes(d.fill)) delete d.fill
    if (d.radius !== undefined && !(finite(d.radius) && d.radius >= 0 && d.radius <= 200)) delete d.radius
    if (d.control !== undefined && !vector(d.control)) delete d.control
    if (d.rotation !== undefined && !(finite(d.rotation) && Math.abs(d.rotation) <= 1000)) delete d.rotation
    if (d.text !== undefined && !(typeof d.text === 'string' && d.text.length <= 5000)) delete d.text
    if (d.textSize !== undefined && !(finite(d.textSize) && d.textSize >= 8 && d.textSize <= 200)) delete d.textSize
  }
  pruneGroups(value as unknown as Workspace)
  return value as unknown as Workspace
}
