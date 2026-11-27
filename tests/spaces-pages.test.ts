import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SidebarStore } from '../src/main/domain/sidebar-store'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { HOME_PAGE_ID } from '../src/shared/model'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-pages-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const W1 = '11111111-1111-4111-8111-111111111111'
const W2 = '22222222-2222-4222-8222-222222222222'
const W3 = '33333333-3333-4333-8333-333333333333'

/** Barra com schemaVersion 1: grupos e workspaces sem página. */
function writeV1(file: string): void {
  writeFileSync(file, JSON.stringify({
    type: 'sidebar', schemaVersion: 1,
    payload: {
      spaces: [{ id: 'g1', name: 'Clientes', collapsed: true, icon: 'folder', color: '#FF3B30' }],
      workspaces: [{ id: W1, name: 'Palco', spaceId: null }, { id: W2, name: 'Loja', spaceId: 'g1' }, { id: W3, name: 'Site', spaceId: 'g1' }],
      order: [W1, W2, W3], active: W2
    }
  }))
}

describe('migração da barra v1 → Espaços como páginas', () => {
  it('nada se perde: tudo vai para o Espaço inicial, com grupos, ordem, ativo e aparência', () => {
    const file = join(dir, 'sidebar.json')
    writeV1(file)
    const s = new SidebarStore(file).get()
    expect(s.pages).toEqual([{ id: HOME_PAGE_ID, name: 'Espaços de Trabalho', icon: 'music' }])
    expect(s.activePage).toBe(HOME_PAGE_ID)
    expect(s.spaces).toEqual([{ id: 'g1', name: 'Clientes', collapsed: true, icon: 'folder', color: '#FF3B30', pageId: HOME_PAGE_ID }])
    expect(s.workspaces.map((w) => [w.id, w.name, w.spaceId, w.pageId])).toEqual([
      [W1, 'Palco', null, HOME_PAGE_ID], [W2, 'Loja', 'g1', HOME_PAGE_ID], [W3, 'Site', 'g1', HOME_PAGE_ID]
    ])
    expect(s.order).toEqual([W1, W2, W3])
    expect(s.active).toBe(W2)
  })

  it('a primeira gravação passa a v2 e guarda a v1 no .bak', () => {
    const file = join(dir, 'sidebar.json')
    writeV1(file)
    const store = new SidebarStore(file)
    store.createPage({ name: 'Pessoal' })
    expect(JSON.parse(readFileSync(file, 'utf8')).schemaVersion).toBe(2)
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).schemaVersion).toBe(1)
    const again = new SidebarStore(file).get()
    expect(again.pages.map((p) => p.name)).toEqual(['Espaços de Trabalho', 'Pessoal'])
    expect(again.workspaces).toHaveLength(3)
  })

  it('arquivo de versão futura abre só para leitura', () => {
    const file = join(dir, 'sidebar.json')
    writeFileSync(file, JSON.stringify({ type: 'sidebar', schemaVersion: 3, payload: { spaces: [], workspaces: [], order: [], active: '' } }))
    const store = new SidebarStore(file)
    expect(store.readOnly).toBe(true)
    expect(() => store.createPage({ name: 'X' })).toThrow(/somente leitura/)
  })

  it('página citada que não existe mais devolve os itens ao Espaço inicial', () => {
    const file = join(dir, 'sidebar.json')
    writeFileSync(file, JSON.stringify({
      type: 'sidebar', schemaVersion: 2,
      payload: { pages: [{ id: 'p1', name: 'Pessoal', icon: 'folder' }], activePage: 'sumiu', spaces: [], workspaces: [{ id: W1, name: 'A', spaceId: null, pageId: 'sumiu' }], order: [W1], active: W1 }
    }))
    const s = new SidebarStore(file).get()
    expect(s.pages.map((p) => p.id)).toEqual([HOME_PAGE_ID, 'p1'])
    expect(s.activePage).toBe(HOME_PAGE_ID)
    expect(s.workspaces[0]?.pageId).toBe(HOME_PAGE_ID)
  })
})

describe('operações de Espaço', () => {
  const fresh = (): SidebarStore => {
    const store = new SidebarStore(join(dir, 'sidebar.json'))
    store.addWorkspace({ id: W1, name: 'Palco', spaceId: null })
    return store
  }

  it('criar, editar, trocar e apagar; o inicial não se apaga e recebe tudo de volta', () => {
    const store = fresh()
    const p = store.createPage({ name: 'Pessoal', icon: 'leaf', color: '#34C759' })
    expect(store.get().pages[1]).toEqual({ id: p, name: 'Pessoal', icon: 'leaf', color: '#34C759' })
    expect(store.createPage({ name: 'Sem ícone' }) && store.get().pages[2]?.icon).toBe('folder')
    store.switchPage(p)
    expect(store.get().activePage).toBe(p)
    store.addWorkspace({ id: W2, name: 'Loja', spaceId: null })
    const g = store.createSpace('Clientes')
    expect(store.get().workspaces.find((w) => w.id === W2)?.pageId).toBe(p)
    expect(store.get().spaces.find((s) => s.id === g)?.pageId).toBe(p)
    store.editPage(p, { name: 'Casa', color: null })
    expect(store.get().pages[1]).toEqual({ id: p, name: 'Casa', icon: 'leaf' })
    expect(() => store.removePage(HOME_PAGE_ID)).toThrow(/inicial/)
    store.removePage(p)
    const s = store.get()
    expect(s.pages.map((x) => x.id)).not.toContain(p)
    expect(s.activePage).toBe(HOME_PAGE_ID)
    expect(s.workspaces.find((w) => w.id === W2)?.pageId).toBe(HOME_PAGE_ID)
    expect(s.spaces.find((x) => x.id === g)?.pageId).toBe(HOME_PAGE_ID)
  })

  it('valida nome, ícone e cor do Espaço', () => {
    const store = fresh()
    expect(() => store.createPage({ name: '  ' })).toThrow()
    expect(() => store.createPage({ name: 'X', icon: 'nome de ícone grande demais' })).toThrow()
    expect(() => store.createPage({ name: 'X', color: 'red' })).toThrow()
    expect(() => store.switchPage('nao-existe')).toThrow()
  })

  it('mover para o grupo leva o workspace para a página do grupo; solto vai para a página ativa', () => {
    const store = fresh()
    const p = store.createPage({ name: 'Pessoal' })
    store.switchPage(p)
    const g = store.createSpace('Clientes')
    store.move(W1, g, 0)
    expect(store.get().workspaces[0]).toMatchObject({ spaceId: g, pageId: p })
    store.switchPage(HOME_PAGE_ID)
    store.move(W1, null, 0)
    expect(store.get().workspaces[0]).toMatchObject({ spaceId: null, pageId: HOME_PAGE_ID })
  })

  it('mover para outro Espaço (solto, no fim da lista daquela página)', () => {
    const store = fresh()
    const p = store.createPage({ name: 'Pessoal' })
    store.move(W1, null, 0, p)
    expect(store.get().workspaces[0]).toMatchObject({ spaceId: null, pageId: p })
    expect(store.get().activePage).toBe(HOME_PAGE_ID)
    expect(() => store.move(W1, null, 0, 'nao-existe')).toThrow()
  })

  it('aparência do workspace: ícone lucide ou emoji e cor; null limpa', () => {
    const store = fresh()
    store.setWorkspaceStyle(W1, { icon: 'rocket', color: '#AF52DE' })
    expect(store.get().workspaces[0]).toMatchObject({ icon: 'rocket', color: '#AF52DE' })
    store.setWorkspaceStyle(W1, { icon: '🎻' })
    expect(store.get().workspaces[0]).toMatchObject({ icon: '🎻', color: '#AF52DE' })
    store.setWorkspaceStyle(W1, { icon: null, color: null })
    expect(store.get().workspaces[0]?.icon).toBeUndefined()
    expect(store.get().workspaces[0]?.color).toBeUndefined()
    expect(() => store.setWorkspaceStyle(W1, { color: 'javascript:1' })).toThrow()
    const reopened = new SidebarStore(join(dir, 'sidebar.json'))
    expect(reopened.get().workspaces[0]?.icon).toBeUndefined()
  })

  it('a aparência sobrevive a reabrir o arquivo', () => {
    const store = fresh()
    store.setWorkspaceStyle(W1, { icon: 'rocket', color: '#AF52DE' })
    expect(new SidebarStore(join(dir, 'sidebar.json')).get().workspaces[0]).toMatchObject({ icon: 'rocket', color: '#AF52DE', pageId: HOME_PAGE_ID })
  })
})

describe('registro com páginas', () => {
  it('workspace novo nasce na página ativa e a barra devolvida traz as páginas', () => {
    const reg = new WorkspaceRegistry(join(dir, 'workspaces'))
    const p = reg.createPage({ name: 'Pessoal' })
    reg.switchPage(p)
    const id = reg.create('Notas')
    const bar = reg.sidebar()
    expect(bar.activePage).toBe(p)
    expect(bar.workspaces.find((w) => w.id === id)?.pageId).toBe(p)
    expect(bar.workspaces.filter((w) => w.pageId === HOME_PAGE_ID)).toHaveLength(1)
  })
})
