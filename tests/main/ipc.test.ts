import { defaultPreferences } from '../../src/shared/preferences'
import { homedir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const listeners = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: Handler) => handlers.set(ch, fn),
    on: (ch: string, fn: Handler) => listeners.set(ch, fn),
    removeHandler: (ch: string) => handlers.delete(ch),
    removeAllListeners: (ch: string) => listeners.delete(ch)
  }
}))

import { CH, registerIpc } from '../../src/main/ipc'

const webContents = { id: 1, send: vi.fn(), once: vi.fn<(event: string, cb: () => void) => void>(), removeListener: vi.fn() }
const usageService = { snapshot: vi.fn(() => []), setVisible: vi.fn(), refresh: vi.fn(async () => {}), onChange: vi.fn(() => () => {}) }
const preferences = { get: vi.fn(() => defaultPreferences()), set: vi.fn((patch: object) => ({ ...defaultPreferences(), ...patch })), bind: vi.fn(() => ({ preferences: defaultPreferences(), conflicts: [] })), resetShortcuts: vi.fn(() => defaultPreferences()), onChange: vi.fn(() => () => {}) }
const win = { webContents, isDestroyed: () => false }
const good = { sender: webContents, senderFrame: { url: 'file:///app/index.html', parent: null } }
const evil = { sender: webContents, senderFrame: { url: 'https://evil.example/', parent: null } }
const other = { sender: { id: 2 }, senderFrame: { url: 'file:///app/index.html', parent: null } }
const subframe = { sender: webContents, senderFrame: { url: 'file:///app/index.html', parent: {} } }
const noFrame = { sender: webContents, senderFrame: null }

const term = { kind: 'terminal', name: 'T', agent: 'shell', command: '', cwd: '', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }

let store: Record<string, ReturnType<typeof vi.fn>>
let terminals: Record<string, ReturnType<typeof vi.fn>>
let floors: Record<string, ReturnType<typeof vi.fn>>
let portals: Record<string, ReturnType<typeof vi.fn>>
let lastRegistry: Record<string, ReturnType<typeof vi.fn>>
const registry = (): Record<string, ReturnType<typeof vi.fn>> => lastRegistry

beforeEach(() => {
  usageService.setVisible.mockClear()
  webContents.once.mockClear()
  handlers.clear()
  listeners.clear()
  store = {
    batchCanvas: vi.fn((fn: () => unknown) => fn()),
    assertRemovable: vi.fn(),
    get: vi.fn(() => ({
      nodes: {
        n1: { id: 'n1', kind: 'note', name: 'N', content: '', floorId: null },
        t1: { id: 't1', kind: 'terminal', name: 'T', agent: 'shell', floorId: null },
        t2: { id: 't2', kind: 'terminal', name: 'T2', agent: 'shell', floorId: 'f1' },
        p1: { id: 'p1', kind: 'portal', name: 'Web', url: 'about:blank', floorId: null },
        b1: { id: 'b1', kind: 'band', name: 'B', members: [], floorId: null }
      },
      connections: [],
      floors: { f1: { id: 'f1', name: 'ui', dir: '/work/ui' } }
    })),
    setActiveFloor: vi.fn(),
    createBand: vi.fn(() => 'b1'),
    bandAdd: vi.fn(),
    bandRemove: vi.fn(),
    dissolveBand: vi.fn(),
    addNode: vi.fn(() => 't1'),
    patchNode: vi.fn(),
    reconfigureTerminal: vi.fn(),
    removeNode: vi.fn(),
    connect: vi.fn(() => ({ id: 'c', a: 'a', b: 'b' })),
    disconnect: vi.fn(),
    setCamera: vi.fn(),
    addDrawing: vi.fn(() => 'd1'),
    removeDrawing: vi.fn(),
    onChange: vi.fn(() => () => {})
  }
  terminals = {
    spawn: vi.fn(),
    dispose: vi.fn(),
    kill: vi.fn(),
    snapshot: vi.fn(() => ({ data: '', seq: 0, gen: 1 })),
    write: vi.fn(),
    resize: vi.fn(() => {
      throw new Error('boom')
    }),
    isRunning: vi.fn(() => false),
    restart: vi.fn(),
    onData: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {})
  }
  floors = {
    create: vi.fn(async (input: unknown) => ({ id: 'f1', ...(input as object) })),
    land: vi.fn(async () => ({ ok: true, merged: 'palco/ui', into: 'main' })),
    remove: vi.fn(async () => undefined),
    setStatus: vi.fn()
  }
  portals = { register: vi.fn(), unregister: vi.fn() }
  // Registro de um workspace só, em volta do store simulado.
  const nodes = (): Record<string, { kind: string }> => (store.get as unknown as () => { nodes: Record<string, { kind: string }> })().nodes
  const registry = {
    active: () => store,
    activeId: () => 'w1',
    get: () => store,
    storeOfNode: (id: string) => (Object.hasOwn(nodes(), id) ? store : undefined),
    node: (id: string) => nodes()[id],
    onChange: vi.fn(() => () => {}),
    onSidebar: vi.fn(() => () => {}),
    sidebar: vi.fn(() => ({ spaces: [], workspaces: [], order: [], active: 'w1' })),
    createPage: vi.fn(() => 'p1'),
    editPage: vi.fn(),
    removePage: vi.fn(),
    switchPage: vi.fn(),
    setWorkspaceStyle: vi.fn(),
    saveIcon: vi.fn(),
    loadIcon: vi.fn(() => null),
    deleteIcon: vi.fn(),
    get warning() { return (store as unknown as { warning?: string }).warning }
  }
  lastRegistry = registry as never
  registerIpc({
    preferences: preferences as never,
    usageService: usageService as never,
    registry: registry as never,
    terminals: terminals as never,
    floors: floors as never,
    portals: portals as never,
    isPortalGuest: (id) => id === 42,
    getWindow: () => win as never,
    isTrustedUrl: (u) => u === 'file:///app/index.html',
    pickPath: async (kind) => (kind === 'dir' ? '/home/x' : '/home/x/a.png'),
    files: { read: fileRead, list: async () => [] },
    openExternal
  })
})

const openExternal = vi.fn(async (_url: string) => {})
const fileRead = vi.fn(async () => ({ kind: 'text', data: '', truncated: false }))

const invoke = (ch: string, event: unknown, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(ch)!(event, ...args))

describe('ipc: remetente', () => {
  it('aceita o frame principal da janela com URL confiável', async () => {
    await expect(invoke(CH.wsGet, good)).resolves.toBeDefined()
  })

  it.each([
    ['URL externa', evil],
    ['outro webContents', other],
    ['subframe', subframe],
    ['sem frame', noFrame]
  ])('recusa %s em todo handler', async (_n, event) => {
    for (const ch of handlers.keys()) await expect(invoke(ch, event)).rejects.toThrow(/remetente/)
    expect(store.addNode).not.toHaveBeenCalled()
    expect(store.setCamera).not.toHaveBeenCalled()
    expect(terminals.spawn).not.toHaveBeenCalled()
  })

  it('ignora (sem lançar) eventos send de remetente não confiável', () => {
    expect(() => listeners.get(CH.termWrite)!(evil, 't1', 'rm -rf /\r')).not.toThrow()
    expect(terminals.write).not.toHaveBeenCalled()
  })
})

describe('ipc: validação de payload', () => {
  it('node:add inválido é recusado; válido cria e sobe o terminal', async () => {
    await expect(invoke(CH.nodeAdd, good, { ...term, size: null })).rejects.toThrow()
    await expect(invoke(CH.nodeAdd, good, 'x')).rejects.toThrow()
    expect(store.addNode).not.toHaveBeenCalled()
    await expect(invoke(CH.nodeAdd, good, term)).resolves.toBe('t1')
    expect(terminals.spawn).toHaveBeenCalledOnce()
  })

  it('câmera inválida não chega ao store', async () => {
    await expect(invoke(CH.wsCamera, good, { offset: { x: 0, y: 0 }, zoom: 0 })).rejects.toThrow()
    expect(store.setCamera).not.toHaveBeenCalled()
    await invoke(CH.wsCamera, good, { offset: { x: 0, y: 0 }, zoom: 1 })
    expect(store.setCamera).toHaveBeenCalledOnce()
  })

  it('node:patch valida pelo tipo do nó alvo', async () => {
    await expect(invoke(CH.nodePatch, good, 't1', { content: 'x' })).rejects.toThrow()
    await expect(invoke(CH.nodePatch, good, 'n1', { content: 'x' })).resolves.toBeUndefined()
    await expect(invoke(CH.nodePatch, good, 'inexistente', { name: 'x' })).rejects.toThrow()
    expect(store.patchNode).toHaveBeenCalledTimes(1)
  })

  it('resize com NaN é recusado sem lançar; erro do manager também não escapa', () => {
    expect(() => listeners.get(CH.termResize)!(good, 't1', NaN, 32)).not.toThrow()
    expect(terminals.resize).not.toHaveBeenCalled()
    expect(() => listeners.get(CH.termResize)!(good, 't1', 80, 24)).not.toThrow()
    expect(terminals.resize).toHaveBeenCalledWith('t1', 80, 24)
  })

  it('write com tipo errado é ignorado sem lançar', () => {
    expect(() => listeners.get(CH.termWrite)!(good, 't1', { x: 1 })).not.toThrow()
    expect(terminals.write).not.toHaveBeenCalled()
    listeners.get(CH.termWrite)!(good, 't1', 'ls\r')
    expect(terminals.write).toHaveBeenCalledWith('t1', 'ls\r')
  })
})

describe('ipc: ciclo de vida', () => {
  it('remover o nó descarta o terminal (dispose) e remove do store', async () => {
    await invoke(CH.nodeRemove, good, 't1')
    expect(terminals.dispose).toHaveBeenCalledWith('t1')
    expect(store.removeNode).toHaveBeenCalledWith('t1')
  })
})

describe('ipc: aviso do store', () => {
  it('palco:meta:warning devolve store.warning (ou null) e só para o remetente autorizado', async () => {
    expect(await invoke(CH.metaWarning, good)).toBeNull()
    ;(store as unknown as { warning?: string }).warning = 'arquivo corrompido: cópia em workspace.json.corrompido'
    expect(await invoke(CH.metaWarning, good)).toBe('arquivo corrompido: cópia em workspace.json.corrompido')
    await expect(invoke(CH.metaWarning, evil)).rejects.toThrow(/remetente/)
  })
})

describe('ipc: floors', () => {
  it('floor:create valida o payload e delega ao FloorService', async () => {
    await expect(invoke(CH.floorCreate, good, { name: '', fromDir: '/r' })).rejects.toThrow()
    await expect(invoke(CH.floorCreate, good, { name: 'ui' })).rejects.toThrow()
    await expect(invoke(CH.floorCreate, good, 'x')).rejects.toThrow()
    await expect(invoke(CH.floorCreate, good, { name: 'ui', fromDir: '/r', branch: 5 })).rejects.toThrow()
    expect(floors.create).not.toHaveBeenCalled()
    await invoke(CH.floorCreate, good, { name: 'ui', fromDir: '/r', branch: 'b', from: 'main', extra: 'x' })
    expect(floors.create).toHaveBeenCalledWith({ name: 'ui', fromDir: '/r', branch: 'b', from: 'main' })
  })

  it("floor:create troca '~' pela pasta pessoal", async () => {
    await invoke(CH.floorCreate, good, { name: 'ui', fromDir: '~' })
    expect(floors.create).toHaveBeenLastCalledWith({ name: 'ui', fromDir: homedir() })
  })

  it('floor:switch aceita id ou null (Ground)', async () => {
    await invoke(CH.floorSwitch, good, 'f1')
    await invoke(CH.floorSwitch, good, null)
    expect(store.setActiveFloor!.mock.calls).toEqual([['f1'], [null]])
    await expect(invoke(CH.floorSwitch, good, 5)).rejects.toThrow()
    await expect(invoke(CH.floorSwitch, good, undefined)).rejects.toThrow()
  })

  it('floor:land e floor:remove só passam opções booleanas conhecidas', async () => {
    expect(await invoke(CH.floorLand, good, 'f1', { into: 'main', deleteBranch: true, keepFloor: false, lixo: 1 })).toEqual({ ok: true, merged: 'palco/ui', into: 'main' })
    expect(floors.land).toHaveBeenCalledWith('f1', { into: 'main', deleteBranch: true, keepFloor: false })
    await invoke(CH.floorLand, good, 'f1')
    expect(floors.land).toHaveBeenLastCalledWith('f1', {})
    await expect(invoke(CH.floorLand, good, 'f1', { deleteBranch: 'sim' })).rejects.toThrow()
    await invoke(CH.floorRemove, good, 'f1', { force: true, keepBranch: true })
    expect(floors.remove).toHaveBeenCalledWith('f1', { force: true, keepBranch: true })
    await expect(invoke(CH.floorRemove, good, 'f1', { force: 1 })).rejects.toThrow()
    await expect(invoke(CH.floorRemove, good, { id: 'f1' })).rejects.toThrow()
  })

  it('floor:setStatus valida estado e progresso; null limpa', async () => {
    await invoke(CH.floorSetStatus, good, 'f1', { state: 'review', progress: '2/3' })
    expect(floors.setStatus).toHaveBeenCalledWith('f1', { state: 'review', progress: '2/3' })
    await invoke(CH.floorSetStatus, good, 'f1', null)
    expect(floors.setStatus).toHaveBeenLastCalledWith('f1', null)
    await expect(invoke(CH.floorSetStatus, good, 'f1', { state: 'explodiu' })).rejects.toThrow()
    await expect(invoke(CH.floorSetStatus, good, 'f1', { state: 'done', progress: 'x'.repeat(500) })).rejects.toThrow()
  })

  it('remetente não autorizado não chega aos floors', async () => {
    for (const ch of [CH.floorCreate, CH.floorSwitch, CH.floorLand, CH.floorRemove, CH.floorSetStatus]) {
      await expect(invoke(ch, evil, 'f1')).rejects.toThrow(/remetente/)
    }
    expect(floors.create).not.toHaveBeenCalled()
    expect(floors.remove).not.toHaveBeenCalled()
  })
})

describe('ipc: bandas', () => {
  it('band:create deriva o floor do primeiro membro e valida a lista', async () => {
    expect(await invoke(CH.bandCreate, good, 'time', ['t1', 't2'])).toBe('b1')
    expect(store.createBand).toHaveBeenCalledWith('time', ['t1', 't2'], null)
    await invoke(CH.bandCreate, good, 'ui', ['t2'])
    expect(store.createBand).toHaveBeenLastCalledWith('ui', ['t2'], 'f1')
    await expect(invoke(CH.bandCreate, good, 'x', [])).rejects.toThrow(/membro/)
    await expect(invoke(CH.bandCreate, good, 'x', ['inexistente'])).rejects.toThrow()
    await expect(invoke(CH.bandCreate, good, '', ['t1'])).rejects.toThrow()
    await expect(invoke(CH.bandCreate, good, 'x', 'okay')).rejects.toThrow()
    await expect(invoke(CH.bandCreate, good, 'x', [1])).rejects.toThrow()
  })

  it('band:add, remove e dissolve', async () => {
    await invoke(CH.bandAdd, good, 'b1', 't1')
    await invoke(CH.bandRemove, good, 'b1', 't1')
    await invoke(CH.bandDissolve, good, 'b1')
    expect(store.bandAdd).toHaveBeenCalledWith('b1', 't1')
    expect(store.bandRemove).toHaveBeenCalledWith('b1', 't1')
    expect(store.dissolveBand).toHaveBeenCalledWith('b1')
    await expect(invoke(CH.bandAdd, good, 5, 't1')).rejects.toThrow()
    await expect(invoke(CH.bandAdd, evil, 'b1', 't1')).rejects.toThrow(/remetente/)
  })
})

describe('ipc: portais e nós novos', () => {
  it('portal:register só aceita webview filho da janela, de um nó portal existente', () => {
    listeners.get(CH.portalRegister)!(good, 'p1', 42)
    expect(portals.register).toHaveBeenCalledWith('p1', 42)
    portals.register!.mockClear()
    listeners.get(CH.portalRegister)!(good, 'p1', 7) // webContents que não é convidado da janela
    listeners.get(CH.portalRegister)!(good, 't1', 42) // nó que não é portal
    listeners.get(CH.portalRegister)!(good, 'nao-existe', 42)
    listeners.get(CH.portalRegister)!(good, 'p1', '42')
    listeners.get(CH.portalRegister)!(good, 'p1', -1)
    listeners.get(CH.portalRegister)!(good, 'p1', 1.5)
    listeners.get(CH.portalRegister)!(evil, 'p1', 42)
    expect(portals.register).not.toHaveBeenCalled()
  })

  it('node:add aceita portal com URL permitida e recusa o resto', async () => {
    const portal = { kind: 'portal', floorId: null, name: 'Web', url: 'https://a.com/', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }
    await invoke(CH.nodeAdd, good, portal)
    await invoke(CH.nodeAdd, good, { ...portal, url: 'about:blank' })
    expect(store.addNode).toHaveBeenCalledTimes(2)
    store.addNode!.mockClear()
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a.com', 'x'.repeat(3000), 5]) {
      await expect(invoke(CH.nodeAdd, good, { ...portal, url }), String(url)).rejects.toThrow()
    }
    await expect(invoke(CH.nodeAdd, good, { ...portal, kind: 'band', members: [] })).rejects.toThrow()
    expect(store.addNode).not.toHaveBeenCalled()
  })

  it('node:patch aceita url só em portal', async () => {
    await invoke(CH.nodePatch, good, 'p1', { url: 'https://b.com/' })
    expect(store.patchNode).toHaveBeenCalledWith('p1', { url: 'https://b.com/' })
    await expect(invoke(CH.nodePatch, good, 'p1', { url: 'javascript:1' })).rejects.toThrow()
    await expect(invoke(CH.nodePatch, good, 't1', { url: 'https://b.com/' })).rejects.toThrow()
  })

  it('remover um portal o desregistra; terminal novo num floor começa na pasta da worktree', async () => {
    await invoke(CH.nodeRemove, good, 'p1')
    expect(portals.unregister).toHaveBeenCalledWith('p1')
    await invoke(CH.nodeAdd, good, { ...term, floorId: 'f1' })
    expect(store.addNode).toHaveBeenLastCalledWith(expect.objectContaining({ floorId: 'f1', cwd: '/work/ui' }))
  })
})
it('persists the canonical role name when a node is created through IPC', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs'), { join } = await import('node:path')
  const { RoleStore } = await import('../../src/main/agents/roles')
  const { PresetStore, AgentCatalog } = await import('../../src/main/agents/presets')
  const dir = mkdtempSync(join(process.cwd(), 'tests/main/.role-'))
  try {
    const roles = new RoleStore(join(dir, 'roles')); roles.create('Tech Lead', 'Review')
    const oneWorkspace = { active: () => store, activeId: () => 'w1', get: () => store, storeOfNode: () => store, node: () => undefined, onChange: () => () => {}, onSidebar: () => () => {}, sidebar: () => ({ spaces: [], workspaces: [], order: [], active: 'w1' }) }
    registerIpc({ registry: oneWorkspace as never, terminals: terminals as never, floors: floors as never, portals: portals as never, agents: new AgentCatalog(new PresetStore(join(dir, 'presets.json'), roles), roles), isPortalGuest: () => false, getWindow: () => win as never, isTrustedUrl: () => true })
    await invoke(CH.nodeAdd, good, { ...term, agent: 'claude', command: 'claude', role: 'Tech Lead' })
    expect(store.addNode).toHaveBeenCalledWith(expect.objectContaining({ role: 'tech-lead' }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

describe('ipc: desenho e arquivos', () => {
  it('drawing:add valida o traço antes do store', async () => {
    const stroke = { floorId: null, points: [{ x: 0, y: 0 }], color: '#fff', width: 2 }
    await expect(invoke(CH.drawAdd, good, { ...stroke, color: 'red;}' })).rejects.toThrow()
    expect(store.addDrawing).not.toHaveBeenCalled()
    await expect(invoke(CH.drawAdd, good, stroke)).resolves.toBe('d1')
    await invoke(CH.drawRemove, good, 'd1')
    expect(store.removeDrawing).toHaveBeenCalledWith('d1')
  })

  it('files:read só aceita caminho absoluto; files:pick só file ou dir', async () => {
    await expect(invoke(CH.fileRead, good, 'relativo.txt')).rejects.toThrow()
    expect(fileRead).not.toHaveBeenCalled()
    await invoke(CH.fileRead, good, '/tmp/a.txt')
    expect(fileRead).toHaveBeenCalledWith('/tmp/a.txt')
    await expect(invoke(CH.filePick, good, 'dir')).resolves.toBe('/home/x')
    await expect(invoke(CH.filePick, good, 'qualquer')).rejects.toThrow()
  })
})

describe('ipc: avisos de presets, roles, partituras e terminais no banner', () => {
  it('meta:warning junta os avisos extras e manda o banner novo quando eles mudam', async () => {
    let extra: string | undefined = 'presets.json ilegível'
    let notify: () => void = () => {}
    const registry = {
      active: () => store, activeId: () => 'w1', get: () => store, storeOfNode: () => undefined, node: () => undefined,
      onChange: vi.fn(() => () => {}), onSidebar: vi.fn(() => () => {}), sidebar: vi.fn(), warning: 'workspace recuperado'
    }
    registerIpc({
      registry: registry as never, terminals: terminals as never, floors: floors as never, portals: portals as never,
      isPortalGuest: () => false, getWindow: () => win as never, isTrustedUrl: (u) => u === 'file:///app/index.html',
      notices: { get: () => [extra, undefined, 'roles ilegíveis ignorados: x.md'], onChange: (cb) => { notify = cb; return () => {} } }
    })
    expect(await invoke(CH.metaWarning, good)).toBe('workspace recuperado; presets.json ilegível; roles ilegíveis ignorados: x.md')
    webContents.send.mockClear()
    extra = undefined
    notify()
    expect(webContents.send).toHaveBeenCalledWith(CH.metaWarningChanged, 'workspace recuperado; roles ilegíveis ignorados: x.md')
  })
})


describe('IPC contas e uso por conta', () => {
  it('preserva accountId validado ao criar terminal', async () => {
    await invoke(CH.nodeAdd, good, { ...term, agent: 'claude', command: 'claude', accountId: 'a2' })
    expect(store.addNode).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 'a2' }))
    await expect(invoke(CH.nodeAdd, good, { ...term, accountId: {} })).rejects.toThrow()
  })
  it('valida visibilidade e id para refresh mesmo sem serviço', async () => {
    await expect(invoke('palco:usage:setVisible', good, 'true')).rejects.toThrow(/visibilidade/)
    await expect(invoke('palco:usage:refresh', good, {})).rejects.toThrow()
    await expect(invoke('palco:accounts:add', evil, {})).rejects.toThrow(/remetente/)
  })
})

it('viewers independentes e reload limpam interesse de uso', async () => {
  await invoke('palco:usage:setVisible', good, true, 'rings')
  await invoke('palco:usage:setVisible', good, true, 'panel')
  await invoke('palco:usage:setVisible', good, false, 'panel')
  expect(usageService.setVisible).toHaveBeenLastCalledWith(true)
  const reloaded = webContents.once.mock.calls.find(([event]) => event === 'did-navigate')?.[1]
  expect(reloaded).toBeTypeOf('function')
  reloaded!()
  expect(usageService.setVisible).toHaveBeenLastCalledWith(false)
})

describe('ipc: Espaços (páginas) e ícone do workspace', () => {
  const W = '11111111-1111-4111-8111-111111111111'
  it('valida os payloads de Espaço antes do registro', async () => {
    const reg = registry()
    await expect(invoke(CH.pageCreate, good, { name: 'Pessoal', icon: 'leaf', color: '#34C759' })).resolves.toBe('p1')
    expect(reg.createPage).toHaveBeenLastCalledWith({ name: 'Pessoal', icon: 'leaf', color: '#34C759' })
    await expect(invoke(CH.pageCreate, good, 'Pessoal')).rejects.toThrow()
    await expect(invoke(CH.pageCreate, good, { name: 'X', icon: 5 })).rejects.toThrow()
    await invoke(CH.pageEdit, good, 'p1', { color: null })
    expect(reg.editPage).toHaveBeenLastCalledWith('p1', { color: null })
    await expect(invoke(CH.pageEdit, good, 'p1', { extra: 1 })).rejects.toThrow()
    await invoke(CH.pageSwitch, good, 'p1')
    expect(reg.switchPage).toHaveBeenLastCalledWith('p1')
    await invoke(CH.pageRemove, good, 'p1')
    expect(reg.removePage).toHaveBeenLastCalledWith('p1')
    await expect(invoke(CH.pageRemove, evil, 'p1')).rejects.toThrow(/remetente/)
  })
  it('aparência do workspace e icon.png: bytes só como Uint8Array; avisa a tela quando muda', async () => {
    const reg = registry()
    await invoke(CH.wsStyle, good, W, { icon: 'rocket', color: null })
    expect(reg.setWorkspaceStyle).toHaveBeenLastCalledWith(W, { icon: 'rocket', color: null })
    await expect(invoke(CH.wsStyle, good, W, { name: 'x' })).rejects.toThrow()
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await invoke(CH.wsIconSave, good, W, png)
    expect(reg.saveIcon).toHaveBeenLastCalledWith(W, png)
    expect(webContents.send).toHaveBeenCalledWith(CH.wsIconChanged, W)
    await expect(invoke(CH.wsIconSave, good, W, 'não é bytes')).rejects.toThrow()
    await expect(invoke(CH.wsIconSave, good, '../x', png)).rejects.toThrow()
    await expect(invoke(CH.wsIconLoad, good, W)).resolves.toBeNull()
    await invoke(CH.wsIconDelete, good, W)
    expect(reg.deleteIcon).toHaveBeenLastCalledWith(W)
  })
})

describe('ipc: Editar terminal (comando e pasta) e Reiniciar', () => {
  it('reconfigure valida, grava e reinicia com a configuração nova; pasta ruim não toca em nada', async () => {
    await invoke(CH.termReconfigure, good, 't1', { command: 'codex', cwd: homedir() })
    expect(store.reconfigureTerminal).toHaveBeenLastCalledWith('t1', { command: 'codex', cwd: homedir(), agent: 'codex' })
    expect(terminals.restart).toHaveBeenCalledTimes(1)
    await expect(invoke(CH.termReconfigure, good, 't1', { command: 'codex', cwd: '/nao/existe/mesmo' })).rejects.toThrow(/não existe/)
    await expect(invoke(CH.termReconfigure, good, 'n1', { command: 'codex', cwd: homedir() })).rejects.toThrow(/terminal/)
    await expect(invoke(CH.termReconfigure, evil, 't1', { command: 'codex', cwd: homedir() })).rejects.toThrow(/remetente/)
    expect(store.reconfigureTerminal).toHaveBeenCalledTimes(1)
    expect(terminals.restart).toHaveBeenCalledTimes(1)
  })
  it('restart reinicia de verdade, inclusive com o processo rodando', async () => {
    terminals.isRunning!.mockReturnValue(true)
    await invoke(CH.termRestart, good, 't1')
    expect(terminals.restart).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })
})

describe('ipc: abrir portal no navegador externo', () => {
  it('só http/https chegam ao shell.openExternal', async () => {
    openExternal.mockClear()
    await invoke(CH.shellOpenExternal, good, 'https://example.com/x')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/x')
    await expect(invoke(CH.shellOpenExternal, good, 'file:///etc/passwd')).rejects.toThrow(/http/)
    await expect(invoke(CH.shellOpenExternal, good, 'javascript:alert(1)')).rejects.toThrow()
    await expect(invoke(CH.shellOpenExternal, evil, 'https://example.com/')).rejects.toThrow(/remetente/)
    expect(openExternal).toHaveBeenCalledTimes(1)
  })
})

describe('ipc: Editar terminal atômico (aparência + comando/pasta)', () => {
  it('pasta inválida: nada é gravado (nem nome, nem aparência, nem monitor) e nada reinicia', async () => {
    store.patchNode!.mockClear(); store.reconfigureTerminal!.mockClear(); terminals.restart!.mockClear()
    await expect(invoke(CH.termReconfigure, good, 't1', { command: 'codex', cwd: '/nao/existe/mesmo' }, { name: 'Novo', monitor: true })).rejects.toThrow(/não existe/)
    await expect(invoke(CH.termReconfigure, good, 't1', { command: 'codex', cwd: homedir() }, { color: 'vermelho' })).rejects.toThrow()
    expect(store.patchNode).not.toHaveBeenCalled()
    expect(store.reconfigureTerminal).not.toHaveBeenCalled()
    expect(terminals.restart).not.toHaveBeenCalled()
  })
  it('tudo válido: grava aparência e configuração e espera o restart', async () => {
    store.patchNode!.mockClear(); store.reconfigureTerminal!.mockClear(); terminals.restart!.mockClear()
    let finish!: () => void
    terminals.restart!.mockImplementation(() => new Promise<void>((r) => { finish = r }))
    let settled = false
    const call = invoke(CH.termReconfigure, good, 't1', { command: 'codex', cwd: homedir() }, { name: 'Novo', monitor: true }).then(() => { settled = true })
    await new Promise((r) => setTimeout(r, 0))
    expect(store.patchNode).toHaveBeenCalledWith('t1', { name: 'Novo', monitor: true })
    expect(store.reconfigureTerminal).toHaveBeenCalledWith('t1', { command: 'codex', cwd: homedir(), agent: 'codex' })
    expect(settled).toBe(false)
    finish()
    await call
    expect(settled).toBe(true)
    terminals.restart!.mockReset()
  })
})

describe('ipc: cordas entre workspaces', () => {
  it('links:remove valida o id e chama a remoção; sem links, não quebra', async () => {
    const remove = vi.fn()
    registerIpc({
      registry: lastRegistry as never, terminals: terminals as never, floors: floors as never, portals: portals as never,
      isPortalGuest: () => false, getWindow: () => win as never, isTrustedUrl: (u) => u === 'file:///app/index.html',
      links: { list: () => [], goTo: vi.fn(), remove }
    })
    await invoke(CH.linksRemove, good, 'l-1')
    expect(remove).toHaveBeenCalledWith('l-1')
    await expect(invoke(CH.linksRemove, good, 42)).rejects.toThrow()
    await expect(invoke(CH.linksRemove, evil, 'l-1')).rejects.toThrow()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})

describe('preferências: IPC validado', () => {
  it('carrega, aplica patch e grava atalho pela rota dedicada', async () => {
    expect(await invoke(CH.prefsGet, good)).toEqual(defaultPreferences())
    await invoke(CH.prefsSet, good, { appearance: 'light' }); expect(preferences.set).toHaveBeenCalledWith({ appearance: 'light' })
    await invoke(CH.prefsBind, good, 'undo', { key: 'u', mod: true }); expect(preferences.bind).toHaveBeenCalledWith('undo', { key: 'u', mod: true })
    await invoke(CH.prefsReset, good); expect(preferences.resetShortcuts).toHaveBeenCalled()
  })
  it('não aceita snapshots de atalhos via patch nem ids inventados', async () => {
    await expect(invoke(CH.prefsSet, good, { shortcuts: {} })).rejects.toThrow()
    await expect(invoke(CH.prefsSet, good, [])).rejects.toThrow()
    await expect(invoke(CH.prefsBind, good, '__proto__', null)).rejects.toThrow()
  })
})

it('remover workspace pela interface usa o registro e encerra terminais e portais', async () => {
  registry().remove = vi.fn(() => ['t1', 't2'])
  await invoke(CH.wsRemove, good, 'w1')
  expect(registry().remove).toHaveBeenCalledExactlyOnceWith('w1')
  expect(terminals.dispose).toHaveBeenCalledWith('t1'); expect(terminals.dispose).toHaveBeenCalledWith('t2')
  expect(portals.unregister).toHaveBeenCalledExactlyOnceWith('p1')
})
