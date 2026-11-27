// Recuperação de partições, conexões e preferências ao reabrir workspaces.
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (ch: string, fn: never) => handlers.set(ch, fn), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() } }))
import { CH, registerIpc, type IpcDeps } from '../src/main/ipc'
import { IsolatedPortalStorage, portalCensus } from '../src/main/portal/isolated-storage'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { CrossLinkStore, pruneLinksAtStartup } from '../src/main/domain/cross-links'
import { AskBroker } from '../src/main/ask/ask-broker'
import { startServer } from '../src/main/server/http-server'
import { HEADER_TOKEN } from '../src/shared/auth'
import { parseDrawing } from '../src/main/validate'
import { matchShortcut, defaultShortcuts } from '../src/shared/shortcuts'
import { emptyForm, quickTileForm, toNewNode } from '../src/renderer/src/dialogs/new-terminal'
import { debouncedCopy } from '../src/renderer/src/nodes/copy-on-select'
import type { NewNode, TerminalNode } from '../src/shared/model'

let dir: string, registry: WorkspaceRegistry
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-portal-recovery-')); registry = new WorkspaceRegistry(join(dir, 'workspaces')) })
afterEach(() => { registry.flushAll(); rmSync(dir, { recursive: true, force: true }); vi.useRealTimers() })
const portal = (storage?: 'isolated' | 'workspace'): NewNode => ({ kind: 'portal', floorId: null, name: `P${Math.random()}`, url: 'https://example.com', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }, ...(storage ? { storage } : {}) }) as NewNode
const terminal = (name: string, extra: Partial<TerminalNode> = {}): NewNode => ({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }, ...extra }) as NewNode

describe('partição isolada de portal apagado', () => {
  const file = () => join(dir, 'isolated-portals.json')
  const boot = (clear = vi.fn(async (_partition: string) => {})) => ({ clear, storage: new IsolatedPortalStorage(file(), () => portalCensus(registry), clear) })
  it('é limpa na abertura seguinte (o desfazer ainda pode trazer o portal de volta nesta)', async () => {
    const store = registry.active(), gone = store.addNode(portal('isolated')), kept = store.addNode(portal('isolated')), shared = store.addNode(portal()), ws = store.addNode(portal('workspace'))
    const first = boot(); await first.storage.sweep(); first.storage.note()
    store.removeNode(gone); store.removeNode(shared); store.removeNode(ws); first.storage.note()
    expect(first.clear).not.toHaveBeenCalled()
    const next = boot(); await next.storage.sweep()
    expect(next.clear.mock.calls).toEqual([[`persist:portal-${gone}`]])
    const third = boot(); await third.storage.sweep(); expect(third.clear).not.toHaveBeenCalled()
    store.removeNode(kept); const fourth = boot(); await fourth.storage.sweep(); expect(fourth.clear.mock.calls).toEqual([[`persist:portal-${kept}`]])
  })
  it('se a limpeza falha, tenta de novo na próxima abertura', async () => {
    const store = registry.active(), id = store.addNode(portal('isolated'))
    boot().storage.note(); store.removeNode(id)
    await boot(vi.fn(async () => { throw new Error('ocupada') })).storage.sweep()
    const again = boot(); await again.storage.sweep(); expect(again.clear).toHaveBeenCalledWith(`persist:portal-${id}`)
  })
  it('com algum workspace ilegível, corrompido ou reparado não limpa nada', async () => {
    const id = registry.active().addNode(portal('isolated'))
    boot().storage.note(); registry.flushAll()
    const [workspaceFile] = readdirSync(join(dir, 'workspaces')).filter((f) => f.endsWith('.json'))
    writeFileSync(join(dir, 'workspaces', workspaceFile!), 'lixo')
    registry = new WorkspaceRegistry(join(dir, 'workspaces'))
    expect(registry.node(id)).toBeUndefined()
    const next = boot(); await next.storage.sweep(); expect(next.clear).not.toHaveBeenCalled()
  })
  it('arquivo de controle ilegível não apaga nada nem derruba a abertura', async () => {
    writeFileSync(file(), '{"a":'); const b = boot(); await expect(b.storage.sweep()).resolves.toBeUndefined(); expect(b.clear).not.toHaveBeenCalled()
  })
})

describe('editar o terminal entra no desfazer', () => {
  const restart = vi.fn(async (_node: TerminalNode) => {}), running = new Set<string>()
  const contents = { send: vi.fn() }, event = { sender: contents, senderFrame: { parent: null, url: 'file:///app' } }
  const invoke = (ch: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(ch)!(event, ...args))
  let off: () => void
  beforeEach(() => {
    handlers.clear(); vi.clearAllMocks(); running.clear()
    off = registerIpc({ registry, terminals: { spawn: vi.fn(), dispose: vi.fn(), restart, hasSession: (id: string) => running.has(id), onData: () => () => {}, onExit: () => () => {} }, floors: {}, portals: { register: vi.fn(), unregister: vi.fn() }, isPortalGuest: () => true, getWindow: () => ({ webContents: contents, isDestroyed: () => false }), isTrustedUrl: (url: string) => url === 'file:///app' } as unknown as IpcDeps)
  })
  afterEach(() => off())
  it('um Ctrl+Z desfaz comando, pasta e aparência de uma vez e reinicia o processo vivo com o comando antigo', async () => {
    const store = registry.active(), id = store.addNode(terminal('T', { command: 'bash', agent: 'other' })); running.add(id)
    await invoke(CH.termReconfigure, id, { command: 'zsh', cwd: '/' }, { color: '#ff0000' })
    expect(await invoke(CH.historyCanUndo, store.get().id)).toBe(true)
    restart.mockClear(); await invoke(CH.historyUndo, store.get().id)
    expect(store.get().nodes[id]).toMatchObject({ command: 'bash', cwd: '/tmp' }); expect(store.get().nodes[id]).not.toHaveProperty('color')
    expect(restart).toHaveBeenCalledOnce(); expect(restart.mock.calls[0]![0]).toMatchObject({ id, command: 'bash' })
    restart.mockClear(); await invoke(CH.historyRedo, store.get().id)
    expect(store.get().nodes[id]).toMatchObject({ command: 'zsh', cwd: '/', color: '#ff0000' }); expect(restart.mock.calls[0]![0]).toMatchObject({ command: 'zsh' })
  })
  it('terminal parado volta à configuração antiga sem iniciar', async () => {
    const store = registry.active(), id = store.addNode(terminal('T', { command: 'bash', agent: 'other', autoStart: false }))
    await invoke(CH.termReconfigure, id, { command: 'zsh', cwd: '/' }); restart.mockClear()
    await invoke(CH.historyUndo, store.get().id)
    expect(store.get().nodes[id]).toMatchObject({ command: 'bash' }); expect(restart).not.toHaveBeenCalled()
  })
  it('mudar só a aparência não reinicia no desfazer', async () => {
    const store = registry.active(), id = store.addNode(terminal('T')); running.add(id)
    await invoke(CH.nodePatch, id, { color: '#00ff00' }); restart.mockClear(); await invoke(CH.historyUndo, store.get().id)
    expect(restart).not.toHaveBeenCalled()
  })
})

describe('cordas entre workspaces e o desfazer', () => {
  let server: { close(): Promise<void> } | undefined
  afterEach(async () => { await server?.close(); server = undefined })
  it('listar não apaga a corda de um terminal apagado: ela volta quando ele volta', async () => {
    const here = registry.active(), me = here.addNode(terminal('Eu', { agent: 'claude', maestro: true }))
    const other = registry.get(registry.create('Outro')), peer = other.addNode(terminal('Par'))
    registry.switch(here.get().id)
    const links = new CrossLinkStore(join(dir, 'links.json')); links.connect(me, peer)
    const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout }, { shellIdleMs: 60000, settleMs: 0 })
    const socket = join(dir, 's.sock')
    server = await startServer(socket, { registry, broker, links, terminals: { spawn: () => {}, dispose: () => {}, screenText: () => '', markReady: () => {}, notePromptHook: () => {}, isRunning: () => true, hasSession: () => true, agentState: () => 'ready', identify: () => ({ id: me, gen: 1 }) } } as never)
    const list = () => new Promise<string>((resolve, reject) => { http.get({ socketPath: socket, path: '/list', headers: { [HEADER_TOKEN]: 'tok' } }, (res) => { let data = ''; res.setEncoding('utf8'); res.on('data', (c) => (data += c)); res.on('end', () => resolve(data)) }).on('error', reject) })
    expect(await list()).toContain('Par @ Outro')
    const snapshot = other.get()
    other.removeNode(peer)
    expect(await list()).not.toContain('Par @ Outro')
    other.restoreCanvas(snapshot)
    expect(await list()).toContain('Par @ Outro')
  })
  it('na abertura, saem as cordas de nós que não existem mais, a menos que algum workspace esteja incompleto', () => {
    const a = registry.active().addNode(terminal('A')), links = new CrossLinkStore(join(dir, 'links.json'))
    links.connect(a, 'sumido')
    pruneLinksAtStartup(links, { node: (id) => registry.node(id), complete: false }); expect(links.list()).toHaveLength(1)
    pruneLinksAtStartup(links, { node: (id) => registry.node(id), complete: true }); expect(links.list()).toEqual([])
  })
})

describe('formas de desenho', () => {
  const base = { floorId: null, color: '#FF3B30', width: 3 }
  const p = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }))
  it.each(['line', 'arrow', 'rect', 'ellipse', 'star'])('%s tem exatamente dois pontos', (tool) => {
    expect(() => parseDrawing({ ...base, tool, points: p(1) })).toThrow(/2 pontos/)
    expect(() => parseDrawing({ ...base, tool, points: p(3) })).toThrow(/2 pontos/)
    expect(parseDrawing({ ...base, tool, points: p(2) }).points).toHaveLength(2)
  })
  it('traço livre continua com muitos pontos', () => { for (const tool of ['pen', 'brush', 'highlighter', undefined]) expect(parseDrawing({ ...base, ...(tool ? { tool } : {}), points: p(5) }).points).toHaveLength(5) })
  it('um patch também não deixa a forma com outra quantidade de pontos', () => {
    const store = registry.active(), id = store.addDrawing({ ...base, tool: 'rect', points: p(2) } as never)
    expect(() => store.patchDrawing(id, { points: p(3) })).toThrow(/2 pontos/)
    expect(store.get().drawings![0]!.points).toHaveLength(2)
  })
})

describe('apagar pede a tecla exata', () => {
  const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }) as KeyboardEvent
  const hit = (e: KeyboardEvent) => matchShortcut('deleteSelection', e, defaultShortcuts())
  it('Delete, Backspace e Ctrl+W apagam', () => { for (const e of [ev('Delete'), ev('Backspace'), ev('w', { ctrlKey: true })]) expect(hit(e)).toBe(true) })
  it('Ctrl+Delete, Shift+Delete e Alt+Backspace não', () => { for (const e of [ev('Delete', { ctrlKey: true }), ev('Delete', { shiftKey: true }), ev('Backspace', { altKey: true })]) expect(hit(e)).toBe(false) })
})

describe('tamanho de fonte do terminal', () => {
  const frame = { pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }
  it('o padrão das preferências não é congelado no nó', () => { expect(toNewNode(emptyForm(), frame, null, [])).not.toHaveProperty('fontSize') })
  it('um tamanho escolhido ou de preset fica no nó', () => {
    expect(toNewNode({ ...emptyForm(), fontSize: 17 }, frame, null, [])).toMatchObject({ fontSize: 17 })
    const form = quickTileForm({ name: 'P', command: 'claude', icon: 'terminal', preset: { name: 'P', command: 'claude', appearance: { fontSize: 19 } } } as never, [])
    expect(toNewNode({ ...emptyForm(), ...form }, frame, null, [])).toMatchObject({ fontSize: 19 })
  })
})

describe('copiar ao selecionar', () => {
  it('só escreve quando a seleção para de mudar, com o último texto', () => {
    vi.useFakeTimers()
    const write = vi.fn(), copy = debouncedCopy(write, 150)
    copy.push('a'); vi.advanceTimersByTime(100); copy.push('ab'); vi.advanceTimersByTime(100); copy.push('abc'); expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150); expect(write.mock.calls).toEqual([['abc']])
    copy.push(''); vi.advanceTimersByTime(300); expect(write).toHaveBeenCalledOnce()
    copy.push('x'); copy.dispose(); vi.advanceTimersByTime(300); expect(write).toHaveBeenCalledOnce()
  })
})
