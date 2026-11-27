import { pickTerminalExtras } from './terminal-extras'
import { validateAppearance, type Appearance } from '../../shared/appearance'
import { existsSync, renameSync } from 'node:fs'
import { validateWorkspace } from './workspace-schema'
import { normalizeAgentCommand } from './command'
import { randomUUID } from 'node:crypto'
import { slugFloorName } from './floor-name'
import type { BandNode, CanvasGroup, CanvasNode, Connection, DockState, Drawing, DrawingPatch, FileTreeNode, Floor, FloorId, NewNode, NodePatch, PortalNode, TerminalNode, Workspace } from '../../shared/model'
import { isTwoPointKind } from '../../shared/model'
import { MAX_GROUP_NAME, MIN_GROUP, groupable, pruneGroups } from '../../shared/groups'
import { isNoteFilePath, noteFileName } from '../../shared/note-file'
import { insideRoot } from '../../shared/tree-path'
import { readEnvelope, writeEnvelopeAtomic } from './envelope'
import { reachable } from './reachability'
import { takesRole } from './terminal-extras'
import { isHeld, LockedError } from '../../shared/lock'

/** Voltar à raiz limpa a navegação. */
function treePatched(node: FileTreeNode, common: Partial<Pick<FileTreeNode, 'name' | 'pos' | 'size'>>, current: string | undefined): FileTreeNode {
  const { current: before, ...rest } = node
  const next = current === undefined ? before : insideRoot(current, node.root) ? undefined : current
  return { ...rest, ...common, ...(next !== undefined && { current: next }) }
}

export class WorkspaceStore {
  private workspace: Workspace
  private readonly readOnly: boolean
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly listeners = new Set<(ws: Workspace) => void>()

  private openingWarning?: string
  private savingWarning?: string
  private retryMs = 0
  private disposed = false
  private batchDepth = 0
  private batchDirty = false
  get warning(): string | undefined {
    return [this.openingWarning, this.savingWarning].filter(Boolean).join('; ') || undefined
  }

  /** `init` dá id e nome a um workspace que ainda não existe no disco (ou que foi para a quarentena). */
  constructor(private readonly file: string, init: { id?: string; name?: string } = {}) {
    this.workspace = {
      id: init.id ?? randomUUID(), name: init.name ?? 'Palco', nodes: {}, connections: [], camera: { offset: { x: 0, y: 0 }, zoom: 1 },
      floors: {}, activeFloor: null, drawings: []
    }
    this.readOnly = false
    try {
      const envelope = readEnvelope<unknown>(file, 'workspace', 2)
      this.readOnly = envelope.readOnly
      if (envelope.readOnly) this.openingWarning = 'Workspace de versão futura: somente leitura'
      if (envelope.payload !== null || existsSync(file)) this.workspace = validateWorkspace(envelope.payload, message => {
        this.openingWarning = [this.openingWarning, message].filter(Boolean).join('; ')
      })
    } catch (error) {
      // Future formats and unreadable files are never renamed or overwritten.
      const code = (error as NodeJS.ErrnoException).code
      if (this.readOnly || code) {
        this.readOnly = true
        this.openingWarning = 'Workspace indisponível: somente leitura'
      } else {
        try {
          renameSync(file, `${file}.corrompido-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
          this.openingWarning = 'Workspace corrompido preservado em quarentena; aberto vazio'
        } catch {
          this.readOnly = true
          this.openingWarning = 'Workspace corrompido; quarentena indisponível, somente leitura'
        }
      }
    }
  }

  get(): Workspace { return structuredClone(this.workspace) }

  /** Synchronous canvas batch: observers/persistence see one coherent final state. */
  batchCanvas<T>(change: () => T): T {
    this.batchDepth++
    try { return change() }
    finally {
      this.batchDepth--
      if (!this.batchDepth && this.batchDirty) { this.batchDirty = false; this.changed() }
    }
  }

  /** Main-only history restore: keeps camera, workspace metadata and floor lifecycle intact. */
  restoreCanvas(snapshot: Pick<Workspace, 'nodes' | 'connections' | 'drawings' | 'stackNames' | 'groups'>): void {
    this.assertWritable()
    const copy = structuredClone(snapshot)
    this.workspace.nodes = copy.nodes
    this.workspace.connections = copy.connections
    this.workspace.drawings = copy.drawings ?? []
    this.workspace.stackNames = copy.stackNames ?? {}
    this.workspace.groups = copy.groups ?? {}
    this.changed()
  }

  /** Sem cópia: o registro procura o dono de um terminal a cada requisição. */
  hasNode(id: string): boolean { return Object.hasOwn(this.workspace.nodes, id) }

  /** Cópia só dos nós escolhidos: quem sincroniza a cada mudança não clona o workspace inteiro. */
  pick<T extends CanvasNode>(match: (node: CanvasNode) => node is T): T[] {
    return structuredClone(Object.values(this.workspace.nodes).filter(match))
  }

  /** Terminais (ids), sem cópia do workspace inteiro. */
  terminalIds(): string[] {
    return Object.values(this.workspace.nodes).filter(node => node.kind === 'terminal').map(node => node.id)
  }

  rename(name: string): void {
    this.assertWritable()
    if (typeof name !== 'string' || !name.trim()) throw new Error('nome de workspace inválido')
    this.workspace.name = name.trim()
    this.changed()
  }

  addNode(node: NewNode): string {
    this.assertWritable()
    const id = randomUUID()
    const copy = structuredClone(node)
    this.assertFloor(copy.floorId)
    if (copy.kind === 'band') copy.members = this.bandMembers(copy.members, copy.floorId)
    if (copy.kind === 'terminal') copy.command = normalizeAgentCommand(copy.agent, copy.command)
    this.workspace.nodes[id] = { ...copy, id }
    this.changed()
    return id
  }

  /** Conta do terminal (`recruit --replace --account`); ausente = login padrão do CLI. Vale no próximo início. */
  setTerminalAccount(id: string, accountId?: string): void {
    this.assertWritable()
    const node = this.node(id)
    if (node.kind !== 'terminal') throw new Error('nó não é terminal')
    if (accountId !== undefined && (typeof accountId !== 'string' || !accountId.trim())) throw new Error('conta inválida')
    if (accountId === undefined) delete node.accountId
    else node.accountId = accountId
    this.changed()
  }

  setTerminalRole(id: string, role?: string): void {
    this.assertWritable()
    const node = this.node(id)
    if (node.kind !== 'terminal') throw new Error('nó não é terminal')
    if (role !== undefined && (typeof role !== 'string' || !role.trim() || !takesRole(node.agent))) throw new Error('role inválido para terminal')
    if (role === undefined) delete node.role
    else node.role = role
    this.changed()
  }

  /** Somente leitura (arquivo de versão futura): nada é gravado. */
  get isReadOnly(): boolean { return this.readOnly }
  /** O arquivo não pôde ser lido por inteiro (ilegível, de versão futura ou reparado): a falta de um nó não prova que ele foi apagado. */
  get incomplete(): boolean { return this.readOnly || this.openingWarning !== undefined }

  /** Aparência de um preset num terminal que já existe (`recruit --replace`): o tema e as fontes de antes saem; ícone, cor e tamanho só mudam se vierem. */
  setTerminalLook(id: string, look: Appearance): void {
    this.assertWritable()
    const node = this.node(id)
    if (node.kind !== 'terminal') throw new Error('nó não é terminal')
    const { themeId: _t, darkThemeId: _d, fontFamily: _f, chatFontFamily: _c, chatFontSize: _s, ...rest } = node
    this.workspace.nodes[id] = { ...rest, ...pickTerminalExtras(validateAppearance(look) as Record<string, unknown>) }
    this.changed()
  }

  patchNode(id: string, patch: NodePatch): void {
    this.assertWritable()
    const node = this.node(id)
    const { name, pos, size, content, url, text, fontSize, color, icon, monitor, chatMode, chatShowsShell, render, fontFamily, locked, stackId, chromeHidden, userAgent, storage, positionLocked, redacted, muted, current } = structuredClone(patch)
    const common = { ...(name !== undefined && { name }), ...(pos && { pos }), ...(size && { size }) }
    const moves = (!!pos && (pos.x !== node.pos.x || pos.y !== node.pos.y)) || (!!size && (size.w !== node.size.w || size.h !== node.size.h))
    if (moves) {
      // Bloqueado só se move no mesmo patch que o desbloqueia; o resto de um fichário preso só se move saindo dele.
      const own = node.positionLocked === true && positionLocked !== false
      const stack = node.positionLocked !== true && stackId !== null && isHeld(this.workspace.nodes, node)
      if (own || stack) throw new LockedError()
    }
    if (current !== undefined && (node.kind !== 'filetree' || !insideRoot(node.root, current))) throw new Error('a pasta fica fora da raiz da árvore')
    if (node.kind === 'note' && node.linkedFile && name !== undefined && name !== node.name) throw new Error('a nota ligada a um arquivo tem o nome do arquivo')
    if (node.kind === 'note') {
      // `null` tira a cor (volta ao padrão) e tira a nota do fichário. Renomear fixa o nome (não segue mais a 1ª linha).
      const { color: oldColor, stackId: oldStack, ...rest } = node
      if (name !== undefined) rest.nameFixed = true
      const nextColor = color === undefined ? oldColor : (color ?? undefined)
      const nextStack = stackId === undefined ? oldStack : (stackId ?? undefined)
      this.workspace.nodes[id] = {
        ...rest, ...common, ...(content !== undefined && { content }), ...(fontSize !== undefined && { fontSize }),
        ...(fontFamily !== undefined && { fontFamily }), ...(render !== undefined && { render }), ...(locked !== undefined && { locked }),
        ...(nextColor !== undefined && { color: nextColor }), ...(nextStack !== undefined && { stackId: nextStack })
      }
    } else {
      this.workspace.nodes[id] = node.kind === 'portal'
        ? portalPatched(node, { ...common, ...(url !== undefined && { url }), ...(chromeHidden !== undefined && { chromeHidden }), ...(storage !== undefined && { storage }) }, userAgent)
        : node.kind === 'text'
          ? { ...node, ...common, ...(text !== undefined && { text }), ...(fontSize !== undefined && { fontSize }) }
          : node.kind === 'filetree'
            ? treePatched(node, common, current)
          : node.kind === 'terminal'
            ? { ...node, ...common, ...(fontSize !== undefined && { fontSize }), ...(color != null && { color }), ...(icon !== undefined && { icon }), ...(monitor !== undefined && { monitor }), ...(chatMode !== undefined && { chatMode }), ...(chatShowsShell !== undefined && { chatShowsShell }) }
            : node.kind === 'band'
              ? { ...node, ...common, ...(color != null && { color }), ...(icon !== undefined && { icon }) }
              : { ...node, ...common }
    }
    // Marcas ligadas ficam gravadas; desligadas somem do arquivo.
    const next = this.workspace.nodes[id] as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries({ positionLocked, redacted, muted })) {
      if (value === true) next[key] = true
      else if (value === false) delete next[key]
    }
    this.changed()
  }

  /** "Descarregar" e o contrário. Não é edição do canvas: o desfazer não mexe nisto. */
  setUnloaded(id: string, unloaded: boolean): void {
    this.assertWritable()
    const node = this.node(id)
    if (node.kind !== 'terminal' && node.kind !== 'portal') throw new Error('só terminais e portais descarregam')
    if ((node.unloaded === true) === unloaded) return
    if (unloaded) node.unloaded = true
    else delete node.unloaded
    this.changed()
  }


  /**
   * Comando, pasta e agente do terminal (Editar terminal; o IPC já validou e reinicia o processo).
   * Se o agente muda, role e conta deixam de valer: role é de Claude/Codex e a conta é de um agente.
   */
  reconfigureTerminal(id: string, config: { command: string; cwd: string; agent: TerminalNode['agent'] }): void {
    this.assertWritable()
    const node = this.node(id)
    if (node.kind !== 'terminal') throw new Error('o nó não é um terminal')
    const { role, accountId, ...rest } = node
    const sameAgent = node.agent === config.agent
    this.workspace.nodes[id] = {
      ...rest, command: config.command, cwd: config.cwd, agent: config.agent,
      ...(sameAgent && role !== undefined ? { role } : {}),
      ...(sameAgent && accountId !== undefined ? { accountId } : {})
    }
    this.changed()
  }

  /** Antes de encerrar processos ou apagar em lote: um elemento bloqueado não sai. */
  assertRemovable(id: string): void {
    if (this.workspace.nodes[id]?.positionLocked) throw new LockedError()
  }

  /** `force`: desfazer uma criação que falhou no meio (partitura), mesmo que o nó tenha nascido bloqueado. */
  removeNode(id: string, opts: { force?: boolean } = {}): void {
    this.assertWritable()
    if (!Object.hasOwn(this.workspace.nodes, id)) return
    if (!opts.force) this.assertRemovable(id)
    delete this.workspace.nodes[id]
    for (const node of Object.values(this.workspace.nodes)) {
      if (node.kind === 'band') node.members = node.members.filter(member => member !== id)
    }
    this.workspace.connections = this.workspace.connections.filter(edge => edge.a !== id && edge.b !== id)
    pruneGroups(this.workspace)
    this.changed()
  }

  connect(a: string, b: string): Connection {
    this.assertWritable()
    if (a === b) throw new Error('autoconexão não permitida')
    const first = this.node(a), second = this.node(b)
    // Entre floors só terminal↔terminal: o orquestrador fala com agentes de outros floors.
    if (first.floorId !== second.floorId && (first.kind !== 'terminal' || second.kind !== 'terminal')) {
      throw new Error('só terminais conectam entre floors')
    }
    if (first.kind === 'band' && second.kind === 'band') throw new Error('banda não conecta com banda')
    const existing = this.workspace.connections.find(edge => edge.a === a && edge.b === b || edge.a === b && edge.b === a)
    if (existing) return { ...existing }
    if (first.kind === 'note' && second.kind === 'note' && reachable(this.workspace, a).some(node => node.id === b)) {
      throw new Error('ciclo entre notas não permitido')
    }
    const connection: Connection = { id: randomUUID(), a, b }
    this.workspace.connections.push(connection)
    this.changed()
    return { ...connection }
  }

  disconnect(id: string): void {
    this.assertWritable()
    const next = this.workspace.connections.filter(edge => edge.id !== id)
    if (next.length === this.workspace.connections.length) return
    this.workspace.connections = next
    this.changed()
  }

  addDrawing(d: Omit<Drawing, 'id'>): string {
    this.assertWritable()
    this.assertFloor(d.floorId)
    const id = randomUUID()
    ;(this.workspace.drawings ??= []).push({ ...structuredClone(d), id })
    this.changed()
    return id
  }

  /** Estilo de um desenho gravado (cor, largura, padrão, preenchimento, raio); desenho inexistente é erro. */
  patchDrawing(id: string, patch: DrawingPatch): void {
    this.assertWritable()
    const d = (this.workspace.drawings ?? []).find(x => x.id === id)
    if (!d) throw new Error('desenho inexistente')
    const { control, text, points, rotation, locked, order, ...style } = patch
    if (d.locked && locked !== false && (points !== undefined || control !== undefined || rotation !== undefined)) throw new LockedError()
    if (points && isTwoPointKind(d.tool) && points.length !== 2) throw new Error(`a forma ${d.tool} é definida por 2 pontos`)
    Object.assign(d, style)
    if (locked === true) d.locked = true
    else if (locked === false) delete d.locked
    if (order) {
      const rest = this.workspace.drawings!.filter(x => x.id !== id)
      this.workspace.drawings = order === 'front' ? [...rest, d] : [d, ...rest]
    }
    if (points) d.points = structuredClone(points)
    if (rotation !== undefined) { if (rotation === 0) delete d.rotation; else d.rotation = rotation }
    if (text === null || text === '') delete d.text
    else if (text !== undefined) d.text = text
    if (control === null) delete d.control
    else if (control !== undefined) d.control = structuredClone(control)
    this.changed()
  }

  removeDrawing(id: string): void {
    this.assertWritable()
    const list = this.workspace.drawings ?? []
    if (list.find(d => d.id === id)?.locked) throw new LockedError()
    const next = list.filter(d => d.id !== id)
    if (next.length === list.length) return
    this.workspace.drawings = next
    this.changed()
  }

  setCamera(camera: Workspace['camera']): void {
    this.assertWritable()
    if (this.workspace.activeFloor === null) this.workspace.camera = structuredClone(camera)
    else this.floor(this.workspace.activeFloor).camera = structuredClone(camera)
    this.changed()
  }

  /** Elevado/encaixado do andar à vista; não entra no histórico (como a câmera). */
  setDockState(state: DockState): void {
    this.assertWritable()
    if (this.workspace.activeFloor === null) this.workspace.dockState = structuredClone(state)
    else this.floor(this.workspace.activeFloor).dockState = structuredClone(state)
    this.changed()
  }

  addFloor(f: Omit<Floor, 'id' | 'camera' | 'createdAt'>): string {
    this.assertWritable()
    if (!f || typeof f.name !== 'string' || !['dir', 'branch', 'repoRoot', 'baseRef'].every(key =>
      typeof f[key as keyof typeof f] === 'string' && ((f[key as keyof typeof f] as string).trim() !== '' || (f.plain === true && (key === 'branch' || key === 'baseRef'))))) throw new Error('campos essenciais do floor inválidos')
    if (f.status !== undefined && (!f.status || !['working', 'blocked', 'review', 'done'].includes(f.status.state)
      || (f.status.progress !== undefined && typeof f.status.progress !== 'string')
      || (f.status.text !== undefined && typeof f.status.text !== 'string'))) throw new Error('status de floor inválido')
    if (this.findFloorByName(f.name)) throw new Error('floor já existe')
    const id = randomUUID()
    this.workspace.floors[id] = { ...structuredClone(f), id, createdAt: Date.now(), camera: { offset: { x: 0, y: 0 }, zoom: 1 } }
    this.changed()
    return id
  }

  /** Nova pasta de um andar sem checkout (`floor set-dir`). */
  setFloorDir(id: string, dir: string): void {
    this.assertWritable()
    this.floor(id).dir = dir
    this.changed()
  }

  findFloorByName(name: string): Floor | undefined {
    const slug = slugFloorName(name)
    const found = Object.values(this.workspace.floors).find(f => slugFloorName(f.name) === slug)
    return found && structuredClone(found)
  }

  setFloorStatus(id: string, status: Floor['status'] | null): void {
    this.assertWritable()
    const floor = this.floor(id)
    if (status == null) delete floor.status
    else floor.status = structuredClone(status)
    this.changed()
  }

  /** Nome automático da nota (segue a primeira linha): não fixa o nome. */
  renameNoteAuto(id: string, name: string): void {
    this.assertWritable()
    const node = this.node(id)
    if (node.kind !== 'note' || node.nameFixed || node.linkedFile) return
    if (typeof name !== 'string' || !name.trim()) throw new Error('nome de nota inválido')
    node.name = name
    this.changed()
  }

  /**
   * Agrupa dois ou mais elementos do andar do primeiro. Se eles já tocam exatamente um grupo, é ele que cresce;
   * senão nasce um novo. Devolve o id, ou `null` se não há o que agrupar.
   */
  groupNodes(ids: string[]): string | null {
    this.assertWritable()
    const found = ids.map((id) => this.workspace.nodes[id]).filter((n): n is CanvasNode => n !== undefined)
    const targets = [...new Set(found.filter((n) => groupable(n) && n.floorId === found[0]!.floorId))]
    if (targets.length < MIN_GROUP) return null
    const groups = (this.workspace.groups ??= {})
    const touched = new Set(targets.flatMap((n) => (n.groupId !== undefined && Object.hasOwn(groups, n.groupId) ? [n.groupId] : [])))
    const id = touched.size === 1 ? [...touched][0]! : randomUUID()
    groups[id] ??= { name: '' }
    for (const n of targets) n.groupId = id
    pruneGroups(this.workspace)
    this.changed()
    return id
  }

  /** Solta só os elementos passados. */
  ungroupNodes(ids: string[]): void {
    this.assertWritable()
    for (const id of ids) delete this.workspace.nodes[id]?.groupId
    pruneGroups(this.workspace)
    this.changed()
  }

  private group(id: string): CanvasGroup {
    const group = this.workspace.groups?.[id]
    if (!group || !Object.hasOwn(this.workspace.groups!, id)) throw new Error('grupo inexistente')
    return group
  }

  /** O nome pode ficar vazio. */
  renameGroup(id: string, name: string): void {
    this.assertWritable()
    if (typeof name !== 'string' || name.trim().length > MAX_GROUP_NAME) throw new Error('nome de grupo inválido')
    this.group(id).name = name.trim()
    this.changed()
  }

  setGroupColor(id: string, color: string | null): void {
    this.assertWritable()
    if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('cor de grupo inválida')
    const group = this.group(id)
    if (color === null) delete group.color
    else group.color = color
    this.changed()
  }

  /** `wanted`, ou "wanted 2", "wanted 3"… se outro elemento do mesmo andar já se chama assim. */
  private freeName(wanted: string, self: CanvasNode): string {
    const taken = new Set(Object.values(this.workspace.nodes).filter((n) => n !== self && n.floorId === self.floorId).map((n) => n.name.toLowerCase()))
    let name = wanted
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${wanted} ${i}`
    return name
  }

  /** Texto vindo do arquivo ligado (ou a marca de que ele faltou); vale mesmo com a nota travada. */
  setLinkedContent(id: string, content: string, missing: boolean): void {
    const node = this.node(id)
    if (node.kind !== 'note' || !node.linkedFile || (node.content === content && (node.fileMissing === true) === missing)) return
    this.assertWritable()
    node.content = content
    if (missing) node.fileMissing = true
    else delete node.fileMissing
    this.changed()
  }

  linkNote(id: string, path: string): void {
    this.assertWritable()
    const node = this.node(id)
    if (node.kind !== 'note') throw new Error('o nó não é uma nota')
    if (!isNoteFilePath(path)) throw new Error('a nota só se liga a um arquivo .md, .markdown ou .txt')
    node.linkedFile = path
    node.name = this.freeName(noteFileName(path), node)
    delete node.fileMissing
    this.changed()
  }

  /** A nota volta a viver só no palco; o arquivo fica onde está. */
  unlinkNote(id: string): void {
    this.assertWritable()
    const node = this.node(id)
    if (node.kind !== 'note') throw new Error('o nó não é uma nota')
    delete node.linkedFile
    delete node.fileMissing
    this.changed()
  }

  /** Nome de um fichário; `null` volta ao id. */
  setStackName(stackId: string, name: string | null): void {
    this.assertWritable()
    const names = { ...(this.workspace.stackNames ?? {}) }
    if (name === null) delete names[stackId]
    else names[stackId] = name.trim()
    this.workspace.stackNames = names
    this.changed()
  }

  /** Linha de status do térreo; `null` limpa. */
  setGroundStatus(status: Workspace['groundStatus'] | null): void {
    this.assertWritable()
    if (status == null) delete this.workspace.groundStatus
    else this.workspace.groundStatus = structuredClone(status)
    this.changed()
  }

  setActiveFloor(id: FloorId): void {
    this.assertWritable()
    this.assertFloor(id)
    this.workspace.activeFloor = id
    this.changed()
  }

  removeFloor(id: string): string[] {
    this.assertWritable()
    this.floor(id)
    const removed = Object.values(this.workspace.nodes).filter(node => node.floorId === id)
    const terminals = removed.filter(node => node.kind === 'terminal').map(node => node.id)
    // Remove in one mutation/notification, never publish an intermediate dangling graph.
    const ids = new Set(removed.map(node => node.id))
    for (const nodeId of ids) delete this.workspace.nodes[nodeId]
    for (const node of Object.values(this.workspace.nodes)) {
      if (node.kind === 'band') node.members = node.members.filter(member => !ids.has(member))
    }
    this.workspace.connections = this.workspace.connections.filter(edge => !ids.has(edge.a) && !ids.has(edge.b))
    delete this.workspace.floors[id]
    if (this.workspace.drawings) this.workspace.drawings = this.workspace.drawings.filter(d => d.floorId !== id)
    if (this.workspace.activeFloor === id) this.workspace.activeFloor = null
    pruneGroups(this.workspace)
    this.changed()
    return terminals
  }

  createBand(name: string, members: string[], floorId: FloorId): string {
    this.assertWritable()
    if (typeof name !== 'string' || !name.trim()) throw new Error('nome de banda inválido')
    if (!Array.isArray(members) || members.length === 0 || !members.every(id => typeof id === 'string')) throw new Error('banda precisa de membros válidos')
    return this.addNode({ kind: 'band', name, members, floorId, pos: { x: 0, y: 0 }, size: { w: 240, h: 160 } })
  }

  bandAdd(bandId: string, terminalId: string): void {
    this.assertWritable()
    const band = this.band(bandId)
    band.members = this.bandMembers([...band.members, terminalId], band.floorId)
    this.changed()
  }

  bandRemove(bandId: string, terminalId: string): void {
    this.assertWritable()
    const band = this.band(bandId)
    band.members = band.members.filter(id => id !== terminalId)
    this.changed()
  }

  dissolveBand(bandId: string): void {
    this.assertWritable()
    this.band(bandId)
    this.removeNode(bandId)
  }

  private assertFloor(id: FloorId): void { if (id !== null) this.floor(id) }
  private floor(id: string): Floor {
    if (!Object.hasOwn(this.workspace.floors, id)) throw new Error('floor inexistente')
    return this.workspace.floors[id]!
  }
  private band(id: string): BandNode {
    const node = this.node(id)
    if (node.kind !== 'band') throw new Error('nó não é banda')
    return node
  }
  private bandMembers(members: string[], floorId: FloorId): string[] {
    for (const id of members) {
      const node = this.node(id)
      if (node.kind !== 'terminal' || node.floorId !== floorId) throw new Error('membro deve ser terminal do mesmo floor')
    }
    return [...new Set(members)]
  }

  onChange(cb: (ws: Workspace) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** Retained references cannot schedule or recreate files after removal. */
  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.retryMs = 0
    this.listeners.clear()
  }

  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.disposed || this.readOnly) return
    try {
      writeEnvelopeAtomic(this.file, 'workspace', 2, this.workspace)
      this.retryMs = 0
      this.savingWarning = undefined
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      this.savingWarning = `Falha ao salvar workspace${typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : ''}; nova tentativa agendada`
      this.retryMs = Math.min(this.retryMs ? this.retryMs * 2 : 1000, 30000)
      this.schedule(this.retryMs)
      throw error
    }
  }

  private node(id: string) {
    if (!Object.hasOwn(this.workspace.nodes, id)) throw new Error('nó inexistente')
    return this.workspace.nodes[id]!
  }

  private assertWritable(): void {
    if (this.disposed) throw new Error('workspace fechado')
    if (this.readOnly) throw new Error('workspace somente leitura')
  }

  private schedule(delay: number): void {
    if (this.disposed) return
    this.timer = setTimeout(() => {
      // flush records the warning and schedules backoff before propagating.
      try { this.flush() } catch { /* deferred failures must not escape the event loop */ }
    }, delay)
  }

  private changed(): void {
    if (this.batchDepth) { this.batchDirty = true; return }
    if (!this.retryMs) { clearTimeout(this.timer); this.schedule(300) }
    for (const listener of this.listeners) listener(this.get())
  }
}

/** Portal com o patch aplicado; `userAgent` vazio tira o override (volta ao padrão do Chromium). */
function portalPatched(node: PortalNode, fields: Partial<PortalNode>, userAgent: string | undefined): PortalNode {
  const { userAgent: old, ...rest } = node
  const ua = userAgent === undefined ? old : (userAgent.trim() || undefined)
  return { ...rest, ...fields, ...(ua !== undefined && { userAgent: ua }) }
}
