import { validWorkspaceId } from './workspace-id'
import { randomUUID } from 'node:crypto'
import { existsSync, renameSync } from 'node:fs'
import { HOME_PAGE_ID, type Sidebar, type SidebarPage, type Space, type WorkspaceMeta } from '../../shared/model'
import { readEnvelope, writeEnvelopeAtomic } from './envelope'

const TYPE = 'sidebar'
/** v2: Espaços como páginas (`pages`, `activePage`, `pageId`). Um v1 é lido e migrado: tudo vai para o Espaço inicial. */
const VERSION = 2
const HOME: SidebarPage = { id: HOME_PAGE_ID, name: 'Espaços de Trabalho', icon: 'music' }
const DEFAULT_PAGE_ICON = 'folder'

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
/** Nome de ícone lucide (kebab-case) ou um emoji (poucos code points). */
const validIcon = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && (/^[a-z0-9-]{1,48}$/.test(v) || [...v].length <= 8)
const validColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
const empty = (): Sidebar => ({ pages: [{ ...HOME }], activePage: HOME_PAGE_ID, spaces: [], workspaces: [], order: [], active: '' })

export interface PageInput { name: string; icon?: string; color?: string }
export interface PagePatch { name?: string; icon?: string; color?: string | null }
export interface WorkspaceStyle { icon?: string | null; color?: string | null }

/**
 * A barra lateral: spaces, workspaces (na ordem de exibição) e o ativo.
 * É reconstruível a partir dos arquivos de workspace, então um arquivo ilegível
 * vai para a quarentena e a barra recomeça (o registro reconcilia com o disco).
 */
export class SidebarStore {
  private state: Sidebar = empty()
  private readonly listeners = new Set<(s: Sidebar) => void>()
  readonly warnings: string[] = []
  private future = false
  get readOnly(): boolean { return this.future }
  assertWritable(): void { if (this.future) throw new Error('Barra lateral de versão futura: somente leitura') }

  constructor(private readonly file: string) {
    try {
      const { payload, readOnly } = readEnvelope<unknown>(file, TYPE, VERSION)
      this.future = readOnly
      if (readOnly) this.warnings.push('Barra lateral de versão futura: somente leitura')
      if (payload !== null) this.state = this.validate(payload)
    } catch {
      if (existsSync(file)) {
        try {
          renameSync(file, `${file}.corrompido-${new Date().toISOString().replace(/[:.]/g, '-')}`)
        } catch { /* sem quarentena: a barra é refeita e o arquivo será sobrescrito */ }
        this.warnings.push('Barra lateral ilegível: refeita a partir dos workspaces')
      }
    }
  }

  private validate(value: unknown): Sidebar {
    if (!object(value)) return empty()
    const pages: SidebarPage[] = [{ ...HOME }]
    for (const p of Array.isArray(value.pages) ? value.pages : []) {
      if (!object(p) || !text(p.id) || !text(p.name)) continue
      if (p.id === HOME_PAGE_ID) {
        // O inicial pode ter sido renomeado ou recolorido: guarda o que vier válido.
        pages[0] = { id: HOME_PAGE_ID, name: p.name, icon: validIcon(p.icon) ? p.icon : HOME.icon, ...(validColor(p.color) ? { color: p.color } : {}) }
        continue
      }
      if (pages.some((x) => x.id === p.id)) continue
      pages.push({ id: p.id, name: p.name, icon: validIcon(p.icon) ? p.icon : DEFAULT_PAGE_ICON, ...(validColor(p.color) ? { color: p.color } : {}) })
    }
    const pageOf = (v: unknown): string => (typeof v === 'string' && pages.some((p) => p.id === v) ? v : HOME_PAGE_ID)
    const spaces: Space[] = []
    for (const s of Array.isArray(value.spaces) ? value.spaces : []) {
      if (!object(s) || !text(s.id) || !text(s.name) || spaces.some((x) => x.id === s.id)) continue
      spaces.push({
        id: s.id, name: s.name, collapsed: s.collapsed === true, pageId: pageOf(s.pageId),
        ...(typeof s.icon === 'string' ? { icon: s.icon } : {}),
        ...(typeof s.color === 'string' ? { color: s.color } : {})
      })
    }
    const workspaces: WorkspaceMeta[] = []
    for (const w of Array.isArray(value.workspaces) ? value.workspaces : []) {
      if (object(w) && !validWorkspaceId(w.id)) { this.warnings.push('id de workspace inválido descartado'); continue }
      if (!object(w) || !validWorkspaceId(w.id) || !text(w.name) || workspaces.some((x) => x.id === w.id)) continue
      const group = typeof w.spaceId === 'string' ? spaces.find((s) => s.id === w.spaceId) : undefined
      workspaces.push({
        id: w.id, name: w.name, spaceId: group?.id ?? null,
        // No grupo, vale a página do grupo; solto, a página gravada (ou o inicial).
        pageId: group?.pageId ?? pageOf(w.pageId),
        ...(validIcon(w.icon) ? { icon: w.icon } : {}),
        ...(validColor(w.color) ? { color: w.color } : {}),
        ...(typeof w.dir === 'string' && w.dir.startsWith('/') ? { dir: w.dir } : {})
      })
    }
    return this.normalized({
      pages, activePage: pageOf(value.activePage), spaces, workspaces, order: [],
      active: typeof value.active === 'string' ? value.active : ''
    })
  }

  /** `order` acompanha sempre `workspaces`; o ativo existe sempre que há workspace. */
  private normalized(s: Sidebar): Sidebar {
    const order = s.workspaces.map((w) => w.id)
    const active = order.includes(s.active) ? s.active : (order[0] ?? '')
    const activePage = s.pages.some((p) => p.id === s.activePage) ? s.activePage : HOME_PAGE_ID
    return { ...s, order, active, activePage }
  }

  get(): Sidebar { return structuredClone(this.state) }

  onChange(cb: (s: Sidebar) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private commit(next: Sidebar): void {
    this.assertWritable()
    const normalized = this.normalized(next)
    writeEnvelopeAtomic(this.file, TYPE, VERSION, normalized)
    this.state = normalized
    for (const cb of this.listeners) {
      try { cb(this.get()) } catch { this.warnings.push('Falha ao notificar mudança na barra lateral') }
    }
  }

  flush(): void {
    this.assertWritable()
    writeEnvelopeAtomic(this.file, TYPE, VERSION, this.state)
  }

  /** Reconcilia com os workspaces do disco, sem avisar ninguém (uso na abertura). */
  reconcile(existing: Array<{ id: string; name: string }>, fallbackActive?: string): void {
    const ids = new Set(existing.map((w) => w.id))
    const kept = this.state.workspaces.filter((w) => ids.has(w.id))
    const names = new Map(existing.map((w) => [w.id, w.name]))
    const workspaces = [
      ...kept.map((w) => ({ ...w, name: names.get(w.id) ?? w.name })),
      ...existing.filter((w) => !kept.some((k) => k.id === w.id)).map((w) => ({ id: w.id, name: w.name, spaceId: null, pageId: HOME_PAGE_ID }))
    ]
    const active = ids.has(this.state.active) ? this.state.active : (fallbackActive ?? '')
    const next = this.normalized({ ...this.state, workspaces, active })
    if (!this.future) writeEnvelopeAtomic(this.file, TYPE, VERSION, next)
    this.state = next
  }

  workspaceByName(name: string): WorkspaceMeta | undefined {
    return this.state.workspaces.find((w) => same(w.name, name))
  }

  spaceByName(name: string): Space | undefined {
    return this.state.spaces.find((s) => same(s.name, name))
  }

  /** Grupos com o nome em todos os Espaços (ou só em `pageId`). */
  groupsByName(name: string, pageId?: string): Space[] {
    return this.state.spaces.filter((s) => same(s.name, name) && (pageId === undefined || (s.pageId ?? HOME_PAGE_ID) === pageId))
  }

  pageByName(name: string): SidebarPage | undefined {
    return this.state.pages.find((p) => same(p.name, name))
  }

  /** Pasta do projeto do workspace (caminho absoluto). */
  setWorkspaceDir(id: string, dir: string): void {
    if (!dir.startsWith('/')) throw new Error('pasta do workspace precisa ser absoluta')
    this.workspace(id)
    this.commit({ ...this.state, workspaces: this.state.workspaces.map((w) => (w.id === id ? { ...w, dir } : w)) })
  }

  /** Reordena o rodapé: o Espaço vai para a posição `index` (0 = primeiro). O inicial fica sempre em primeiro. */
  movePage(id: string, index: number): void {
    const page = this.page(id)
    if (id === HOME_PAGE_ID) throw new Error('o Espaço inicial fica sempre em primeiro')
    if (!Number.isInteger(index) || index < 0) throw new Error('posição inválida')
    const rest = this.state.pages.filter((p) => p.id !== id)
    rest.splice(Math.max(1, Math.min(index, rest.length)), 0, page)
    this.commit({ ...this.state, pages: rest })
  }

  assertFreeWorkspaceName(name: string, except?: string): string {
    if (!text(name) || name.trim().length > 120) throw new Error('nome de workspace inválido')
    const other = this.workspaceByName(name)
    if (other && other.id !== except) throw new Error(`workspace '${name.trim()}' já existe`)
    return name.trim()
  }

  /** Novo workspace: na página do grupo, ou (solto) na página ativa. */
  addWorkspace(meta: WorkspaceMeta): void {
    if (!validWorkspaceId(meta.id)) throw new Error('id de workspace inválido')
    const pageId = meta.spaceId !== null ? this.pageOfSpace(this.space(meta.spaceId)) : this.state.activePage
    this.commit({ ...this.state, workspaces: [...this.state.workspaces, { ...meta, pageId }] })
  }

  /** Ícone (lucide ou emoji) e cor do workspace; `null` limpa, ausente mantém. */
  setWorkspaceStyle(id: string, style: WorkspaceStyle): void {
    const meta = this.workspace(id)
    if (style.icon !== undefined && style.icon !== null && !validIcon(style.icon)) throw new Error('ícone inválido')
    if (style.color !== undefined && style.color !== null && !validColor(style.color)) throw new Error('cor inválida (use #RRGGBB)')
    const { icon: _i, color: _c, ...rest } = meta
    const icon = style.icon === undefined ? meta.icon : (style.icon ?? undefined)
    const color = style.color === undefined ? meta.color : (style.color ?? undefined)
    const next: WorkspaceMeta = { ...rest, ...(icon !== undefined ? { icon } : {}), ...(color !== undefined ? { color } : {}) }
    this.commit({ ...this.state, workspaces: this.state.workspaces.map((w) => (w.id === id ? next : w)) })
  }

  /** Cria um Espaço (página); o ícone padrão é a pasta. Não troca para ele (quem chama decide). */
  createPage(input: PageInput): string {
    const name = this.pageName(input.name)
    if (input.icon !== undefined && !validIcon(input.icon)) throw new Error('ícone inválido')
    if (input.color !== undefined && !validColor(input.color)) throw new Error('cor inválida (use #RRGGBB)')
    this.assertWritable()
    const id = randomUUID()
    const page: SidebarPage = { id, name, icon: input.icon ?? DEFAULT_PAGE_ICON, ...(input.color !== undefined ? { color: input.color } : {}) }
    this.commit({ ...this.state, pages: [...this.state.pages, page] })
    return id
  }

  editPage(id: string, patch: PagePatch): void {
    const page = this.page(id)
    if (patch.icon !== undefined && !validIcon(patch.icon)) throw new Error('ícone inválido')
    if (patch.color !== undefined && patch.color !== null && !validColor(patch.color)) throw new Error('cor inválida (use #RRGGBB)')
    const { color: _c, ...rest } = page
    const color = patch.color === undefined ? page.color : (patch.color ?? undefined)
    const next: SidebarPage = { ...rest, ...(patch.name !== undefined ? { name: this.pageName(patch.name) } : {}), ...(patch.icon !== undefined ? { icon: patch.icon } : {}), ...(color !== undefined ? { color } : {}) }
    this.commit({ ...this.state, pages: this.state.pages.map((p) => (p.id === id ? next : p)) })
  }

  /** Apaga o Espaço; os grupos e workspaces dele voltam para o Espaço inicial (nada se perde). */
  removePage(id: string): void {
    if (id === HOME_PAGE_ID) throw new Error('o Espaço inicial não pode ser apagado')
    this.page(id)
    const home = (pageId: string | undefined): string => (pageId === id ? HOME_PAGE_ID : (pageId ?? HOME_PAGE_ID))
    this.commit({
      ...this.state,
      pages: this.state.pages.filter((p) => p.id !== id),
      activePage: this.state.activePage === id ? HOME_PAGE_ID : this.state.activePage,
      spaces: this.state.spaces.map((s) => ({ ...s, pageId: home(s.pageId) })),
      workspaces: this.state.workspaces.map((w) => ({ ...w, pageId: home(w.pageId) }))
    })
  }

  switchPage(id: string): void {
    this.page(id)
    if (this.state.activePage === id) return
    this.commit({ ...this.state, activePage: id })
  }

  renameWorkspace(id: string, name: string): void {
    const clean = this.assertFreeWorkspaceName(name, id)
    this.workspace(id)
    this.commit({ ...this.state, workspaces: this.state.workspaces.map((w) => (w.id === id ? { ...w, name: clean } : w)) })
  }

  removeWorkspace(id: string): void {
    this.workspace(id)
    this.commit({ ...this.state, workspaces: this.state.workspaces.filter((w) => w.id !== id) })
  }

  setActive(id: string): void {
    this.workspace(id)
    if (this.state.active === id) return
    this.commit({ ...this.state, active: id })
  }

  /**
   * Põe o workspace no grupo (ou solto, com `null`) na posição `index` dentro desse grupo.
   * No grupo, ele vai para a página do grupo; solto, para `toPage` (padrão: a página ativa).
   */
  move(id: string, spaceId: string | null, index: number, toPage?: string): void {
    const meta = this.workspace(id)
    if (toPage !== undefined) this.page(toPage)
    const pageId = spaceId !== null ? this.pageOfSpace(this.space(spaceId)) : (toPage ?? this.state.activePage)
    if (!Number.isInteger(index) || index < 0) throw new Error('posição inválida')
    const rest = this.state.workspaces.filter((w) => w.id !== id)
    const group = rest.filter((w) => w.spaceId === spaceId && (spaceId !== null || (w.pageId ?? HOME_PAGE_ID) === pageId))
    const moved = { ...meta, spaceId, pageId }
    let at: number
    if (index < group.length) at = rest.indexOf(group[index]!)
    else if (group.length > 0) at = rest.indexOf(group[group.length - 1]!) + 1
    else at = rest.length
    rest.splice(at, 0, moved)
    this.commit({ ...this.state, workspaces: rest })
  }

  /** Grupo novo na página `pageId` (padrão: a ativa); o nome só não pode repetir dentro da mesma página. */
  createSpace(name: string, pageId?: string): string {
    if (!text(name) || name.trim().length > 120) throw new Error('nome de space inválido')
    if (pageId !== undefined) this.page(pageId)
    const page = pageId ?? this.state.activePage
    if (pageId === undefined ? this.spaceByName(name) : this.groupsByName(name, page).length > 0) throw new Error(`space '${name.trim()}' já existe`)
    const id = randomUUID()
    this.commit({ ...this.state, spaces: [...this.state.spaces, { id, name: name.trim(), collapsed: false, pageId: page }] })
    return id
  }

  renameSpace(id: string, name: string): void {
    this.space(id)
    if (!text(name) || name.trim().length > 120) throw new Error('nome de space inválido')
    const other = this.spaceByName(name)
    if (other && other.id !== id) throw new Error(`space '${name.trim()}' já existe`)
    this.commit({ ...this.state, spaces: this.state.spaces.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)) })
  }

  /** Apaga o space; os workspaces dele voltam para a lista solta (devolve os ids). */
  removeSpace(id: string): string[] {
    this.space(id)
    const freed = this.state.workspaces.filter((w) => w.spaceId === id).map((w) => w.id)
    this.commit({
      ...this.state,
      spaces: this.state.spaces.filter((s) => s.id !== id),
      workspaces: this.state.workspaces.map((w) => (w.spaceId === id ? { ...w, spaceId: null } : w))
    })
    return freed
  }

  toggleSpace(id: string): void {
    this.space(id)
    this.commit({ ...this.state, spaces: this.state.spaces.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s)) })
  }

  private workspace(id: string): WorkspaceMeta {
    const found = this.state.workspaces.find((w) => w.id === id)
    if (!found) throw new Error('workspace inexistente')
    return found
  }

  private page(id: string): SidebarPage {
    const found = this.state.pages.find((p) => p.id === id)
    if (!found) throw new Error('Espaço inexistente')
    return found
  }

  private pageOfSpace(space: Space): string { return space.pageId ?? HOME_PAGE_ID }

  private pageName(name: unknown): string {
    if (!text(name) || name.trim().length > 120) throw new Error('nome de Espaço inválido')
    return name.trim()
  }

  private space(id: string): Space {
    const found = this.state.spaces.find((s) => s.id === id)
    if (!found) throw new Error('space inexistente')
    return found
  }
}
