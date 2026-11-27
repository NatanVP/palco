import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { assertWorkspaceId } from './workspace-id'
import { dirname, join } from 'node:path'
import type { CanvasNode, Sidebar, Workspace, WorkspaceMeta } from '../../shared/model'
import { readEnvelope } from './envelope'
import { SidebarStore, type PageInput, type PagePatch, type WorkspaceStyle } from './sidebar-store'
import { deleteWorkspaceIcon, loadWorkspaceIcon, saveWorkspaceIcon } from '../workspace-icon'
import { WorkspaceStore } from './workspace-store'

const FILE = /^([A-Za-z0-9_-]{1,128})\.json$/
const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

/** Primeiro caminho livre: `base`, `base-2`, `base-3`… (nunca sobrescreve uma cópia anterior). */
function freePath(base: string): string {
  if (!existsSync(base)) return base
  for (let i = 2; ; i++) if (!existsSync(`${base}-${i}`)) return `${base}-${i}`
}

/**
 * Vários workspaces: um `WorkspaceStore` por arquivo em `<dir>/<id>.json` e a
 * barra lateral em `sidebar.json`. Os ids de nó são UUIDs, únicos entre todos
 * os workspaces, então o dono de um terminal se acha pelo id dele.
 */
export class WorkspaceRegistry {
  private readonly stores = new Map<string, WorkspaceStore>()
  private readonly unsubscribe = new Map<string, () => void>()
  private readonly bar: SidebarStore
  private readonly listeners = new Set<(id: string, ws: Workspace) => void>()
  private readonly removals = new Set<(id: string) => void>()
  private readonly notes: string[] = []
  private rebuilt = false

  constructor(private readonly dir: string, legacyFile?: string, sidebarFile = join(dirname(dir), 'sidebar.json')) {
    mkdirSync(dir, { recursive: true })
    const migrated = legacyFile ? this.migrate(legacyFile) : undefined
    for (const entry of readdirSync(dir)) {
      const match = FILE.exec(entry)
      if (match) this.open(match[1]!)
    }
    this.bar = new SidebarStore(sidebarFile)
    this.notes.push(...this.bar.warnings)
    // Workspace citado na barra cujo arquivo sumiu: é refeito vazio, com o mesmo id e nome.
    for (const meta of this.bar.get().workspaces) if (!this.stores.has(meta.id) && !this.bar.readOnly) {
      this.rebuilt = true
      this.recoverRemoval(meta.id)
      this.open(meta.id, meta.name).flush()
    }
    if (this.stores.size === 0) this.open(randomUUID(), 'Palco').flush()
    this.bar.reconcile([...this.stores].map(([id, s]) => ({ id, name: s.get().name })), migrated)
  }

  /**
   * Copia o arquivo único de workspace para `<dir>/<id>.json` e só depois renomeia o
   * original para `.migrado`. Interrompida em qualquer ponto, a próxima abertura
   * termina o trabalho; se o novo já existe, ele vence (nada é sobrescrito).
   */
  private migrate(legacy: string): string | undefined {
    if (!existsSync(legacy)) return undefined
    let id: unknown
    try {
      const { payload } = readEnvelope<{ id?: unknown }>(legacy, 'workspace', Number.MAX_SAFE_INTEGER)
      id = payload?.id
    } catch {
      this.notes.push('workspace.json antigo ilegível: não migrado (o arquivo continua lá)')
      return undefined
    }
    if (typeof id !== 'string' || !FILE.test(`${id}.json`)) {
      this.notes.push('workspace.json antigo sem id válido: não migrado (o arquivo continua lá)')
      return undefined
    }
    const target = join(this.dir, `${id}.json`)
    if (!existsSync(target)) {
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        copyFileSync(legacy, temporary)
        const fd = openSync(temporary, 'r')
        try { fsyncSync(fd) } finally { closeSync(fd) }
        renameSync(temporary, target)
      } finally {
        rmSync(temporary, { force: true })
      }
    }
    renameSync(legacy, freePath(`${legacy}.migrado`))
    return id
  }

  private recoverRemoval(id: string): void {
    assertWorkspaceId(id)
    const file = join(this.dir, `${id}.json`)
    const archived = readdirSync(this.dir).filter(name => name.startsWith(`${id}.json.removido-`)).sort().at(-1)
    if (archived && !existsSync(file)) {
      renameSync(join(this.dir, archived), file)
      this.syncDirectory()
      this.notes.push('Remoção interrompida recuperada a partir do arquivo preservado')
    }
  }

  private syncDirectory(): void {
    const fd = openSync(this.dir, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }

  private open(id: string, name?: string): WorkspaceStore {
    assertWorkspaceId(id)
    const store = new WorkspaceStore(join(this.dir, `${id}.json`), { id, ...(name === undefined ? {} : { name }) })
    this.stores.set(id, store)
    this.unsubscribe.set(id, store.onChange((ws) => {
      for (const cb of this.listeners) cb(id, ws)
    }))
    return store
  }

  /** Avisos do registro (migração, barra) e do workspace ativo. */
  get warning(): string | undefined {
    return [...this.notes, this.active().warning].filter(Boolean).join('; ') || undefined
  }

  list(): WorkspaceMeta[] { return this.bar.get().workspaces }
  openStores(): WorkspaceStore[] { return [...this.stores.values()] }
  /** Todos os workspaces foram lidos por inteiro nesta abertura. */
  complete(): boolean { return !this.rebuilt && !this.bar.readOnly && [...this.stores.values()].every((s) => !s.incomplete) }
  sidebar(): Sidebar {
    const bar = this.bar.get()
    return { ...bar, workspaces: bar.workspaces.map((w) => ({ ...w, terminals: this.stores.get(w.id)?.terminalIds().length ?? 0, ...(this.stores.get(w.id)?.isReadOnly ? { locked: true } : {}) })) }
  }

  get(id: string): WorkspaceStore {
    const store = this.stores.get(id)
    if (!store) throw new Error('workspace inexistente')
    return store
  }

  activeId(): string { return this.bar.get().active }
  active(): WorkspaceStore { return this.get(this.activeId()) }

  switch(id: string): void {
    this.get(id)
    this.bar.setActive(id)
  }

  storeOfNode(nodeId: string): WorkspaceStore | undefined {
    for (const store of this.stores.values()) if (store.hasNode(nodeId)) return store
    return undefined
  }

  idOf(store: WorkspaceStore): string | undefined {
    for (const [id, s] of this.stores) if (s === store) return id
    return undefined
  }

  node(id: string): CanvasNode | undefined {
    return this.storeOfNode(id)?.get().nodes[id]
  }

  /** Os nós de todos os workspaces (para quem só tem o id: rotinas, broker). */
  allNodes(): Record<string, CanvasNode> {
    return Object.assign({}, ...[...this.stores.values()].map((s) => s.get().nodes)) as Record<string, CanvasNode>
  }

  create(name: string, spaceId: string | null = null): string {
    this.bar.assertWritable()
    const clean = this.bar.assertFreeWorkspaceName(name)
    if (spaceId !== null && !this.bar.get().spaces.some((s) => s.id === spaceId)) throw new Error('space inexistente')
    const id = randomUUID()
    const store = this.open(id, clean)
    store.flush()
    this.bar.addWorkspace({ id, name: clean, spaceId })
    return id
  }

  rename(id: string, name: string): void {
    const store = this.get(id)
    this.bar.renameWorkspace(id, name)
    store.rename(name)
  }

  /**
   * Tira o workspace da barra e devolve os terminais dele (quem chama os encerra).
   * O arquivo não é apagado: vira `<id>.json.removido-<data>`.
   */
  remove(id: string): string[] {
    const store = this.get(id)
    if (this.stores.size === 1) throw new Error('não dá para remover o último workspace')
    this.bar.assertWritable()
    const terminals = store.terminalIds()
    store.flush() // A failed flush keeps the live workspace and its retry registered.
    const file = join(this.dir, `${id}.json`), archive = freePath(`${file}.removido-${stamp()}`)
    renameSync(file, archive)
    try {
      this.syncDirectory()
      // Sidebar commit publishes only after persistence. Keep all stores alive for its listeners.
      this.bar.removeWorkspace(id)
    } catch (error) {
      try { renameSync(archive, file); this.syncDirectory() }
      catch { this.notes.push('Remoção interrompida: arquivo preservado; será recuperado na próxima abertura') }
      throw error
    }
    store.dispose()
    this.unsubscribe.get(id)?.()
    this.unsubscribe.delete(id)
    this.stores.delete(id)
    for (const cb of this.removals) cb(id)
    return terminals
  }

  /** Avisa depois que um workspace saiu de vez (já fora da barra): quem guarda coisas por workspace limpa as dele. */
  onRemoved(cb: (id: string) => void): () => void {
    this.removals.add(cb)
    return () => { this.removals.delete(cb) }
  }

  move(id: string, spaceId: string | null, index: number, toPage?: string): void {
    this.get(id)
    this.bar.move(id, spaceId, index, toPage)
  }

  createSpace(name: string, pageId?: string): string { return this.bar.createSpace(name, pageId) }
  groupsByName(name: string, pageId?: string) { return this.bar.groupsByName(name, pageId) }
  pageByName(name: string) { return this.bar.pageByName(name) }
  movePage(id: string, index: number): void { this.bar.movePage(id, index) }
  setWorkspaceDir(id: string, dir: string): void { this.bar.setWorkspaceDir(id, dir) }
  renameSpace(id: string, name: string): void { this.bar.renameSpace(id, name) }
  removeSpace(id: string): string[] { return this.bar.removeSpace(id) }
  toggleSpace(id: string): void { this.bar.toggleSpace(id) }

  // Espaços (páginas da barra lateral) e aparência do workspace.
  createPage(input: PageInput): string { return this.bar.createPage(input) }
  editPage(id: string, patch: PagePatch): void { this.bar.editPage(id, patch) }
  removePage(id: string): void { this.bar.removePage(id) }
  switchPage(id: string): void { this.bar.switchPage(id) }
  setWorkspaceStyle(id: string, style: WorkspaceStyle): void {
    this.get(id)
    this.bar.setWorkspaceStyle(id, style)
  }

  /** Imagem própria do workspace em `<dir>/<id>/icon.png` (o registro só lê `*.json`, a pasta não atrapalha). */
  saveIcon(id: string, png: Uint8Array): void {
    this.get(id)
    saveWorkspaceIcon(this.dir, id, png)
  }
  loadIcon(id: string): string | null { return this.stores.has(id) ? loadWorkspaceIcon(this.dir, id) : null }
  deleteIcon(id: string): void {
    this.get(id)
    deleteWorkspaceIcon(this.dir, id)
  }

  workspaceByName(name: string): WorkspaceMeta | undefined { return this.bar.workspaceByName(name) }
  spaceByName(name: string) { return this.bar.spaceByName(name) }

  /** Mudança em qualquer workspace, com o id dele. */
  onChange(cb: (id: string, ws: Workspace) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  onSidebar(cb: (s: Sidebar) => void): () => void { return this.bar.onChange(cb) }

  /** Grava todos; uma falha não impede os outros de gravar. */
  flushAll(): void {
    let first: unknown
    for (const store of this.stores.values()) {
      try { store.flush() } catch (error) { first ??= error }
    }
    if (first !== undefined) throw first
  }
}
