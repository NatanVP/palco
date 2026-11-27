// @vitest-environment happy-dom
// Menus: regressões de seleção, permissões e ações sobre elementos.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  openPath: vi.fn(async () => ''), showItemInFolder: vi.fn(), writeText: vi.fn(async () => {}), write: vi.fn(async () => {}),
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}))
vi.mock('electron', () => ({
  shell: { openPath: electron.openPath, showItemInFolder: electron.showItemInFolder },
  clipboard: { writeText: electron.writeText, write: electron.write, read: vi.fn(async () => []), readText: vi.fn(async () => '') },
  ClipboardItem: class { constructor(readonly items: unknown) {} },
  session: { fromPartition: () => ({ clearStorageData: async () => {} }) },
  ipcMain: { handle: (c: string, fn: never) => electron.handlers.set(c, fn), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() }
}))
vi.mock('../src/renderer/src/nodes/TerminalView', () => ({ TerminalView: () => null }))

import { Canvas } from '../src/renderer/src/canvas/Canvas'
import { ContextualBar } from '../src/renderer/src/canvas/ContextualBar'
import { deleteOperations, movableNodeIds } from '../src/renderer/src/canvas/selection/group'
import { elementClipboard } from '../src/renderer/src/canvas/selection/clipboard'
import { fitCamera, unionBox } from '../src/renderer/src/canvas/commands/view'
import { useCanvasCommands } from '../src/renderer/src/canvas/commands/useCommands'
import { adoptPreferences, suspendShortcuts } from '../src/renderer/src/settings/preferences'
import { clipboardArea } from '../src/main/ipc/clipboard'
import { nodeStateArea } from '../src/main/ipc/node-state'
import { CH, registerIpc, type IpcDeps } from '../src/main/ipc'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { BaseActions } from '../src/main/server/base-actions'
import { TerminalManager } from '../src/main/pty/terminal-manager'
import { lazyTerminals } from '../src/main/pty/wake'
import { unloadNodes, wakeNode } from '../src/main/node-state'
import { defaultPreferences } from '../src/shared/preferences'
import { setLocale } from '../src/shared/i18n/runtime'
import type { CanvasNode, NewNode, TerminalNode, Workspace } from '../src/shared/model'

// A animação da barra (motion) não roda no happy-dom: cancelá-la ao desmontar soltaria um erro solto.
const animate = Element.prototype.animate
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true, writable: true }) })
afterAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true }) })

const base = { floorId: null, pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } }
const term = (extra: Partial<TerminalNode> = {}): NewNode => ({ kind: 'terminal', name: 'T', agent: 'shell', command: '', cwd: '/tmp', ...base, ...extra }) as NewNode
let dir: string
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'palco-menu-authority-'))) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

/** Os handlers privilegiados de verdade, com um store de verdade. */
function area() {
  const store = new WorkspaceStore(join(dir, 'ws.json'))
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = { handle: (c: string, fn: (...args: unknown[]) => unknown) => handlers.set(c, fn), listen: () => {}, send: () => {}, deps: { registry: { storeOfNode: (id: string) => (store.hasNode(id) ? store : undefined) }, terminals: {}, portals: {} } as never }
  nodeStateArea(ctx); clipboardArea(ctx)
  const call = async (name: string, ...args: unknown[]) => handlers.get(name)!(...args)
  const file = (path: string) => store.addNode({ kind: 'file', name: 'f', path, ...base })
  const tree = (root: string) => store.addNode({ kind: 'filetree', name: 'a', root, ...base })
  return { store, handlers, call, file, tree }
}

describe("copiar arquivo só por nó, com o alvo conferido", () => {
  beforeEach(() => vi.clearAllMocks())
  it('não existe canal que receba um caminho ou bytes do renderer para a área de transferência', () => {
    expect([...area().handlers.keys()].filter((k) => /clipboard:(writeFile|writePng)/.test(k))).toEqual([])
  })
  it('copia o arquivo do nó; recusa caminho avulso, nó de outro tipo, pasta e link que sai da pasta dele', async () => {
    const a = area(); mkdirSync(join(dir, 'p')); mkdirSync(join(dir, 'fora'))
    writeFileSync(join(dir, 'p', 'a.txt'), 'conteúdo'); writeFileSync(join(dir, 'fora', 'segredo.txt'), 'não')
    expect(await a.call('palco:nodeState:copyFile', a.file(join(dir, 'p', 'a.txt')))).toBe(true)
    expect(electron.writeText).toHaveBeenCalledWith('conteúdo')
    electron.writeText.mockClear()
    await expect(a.call('palco:nodeState:copyFile', join(dir, 'p', 'a.txt'))).rejects.toThrow()
    await expect(a.call('palco:nodeState:copyFile', a.store.addNode({ kind: 'text', name: 't', text: 'x', fontSize: 20, ...base }))).rejects.toThrow()
    await expect(a.call('palco:nodeState:copyFile', a.file(join(dir, 'p')))).rejects.toThrow()
    symlinkSync(join(dir, 'fora', 'segredo.txt'), join(dir, 'p', 'link.txt'))
    await expect(a.call('palco:nodeState:copyFile', a.file(join(dir, 'p', 'link.txt')))).rejects.toThrow(/link/)
    symlinkSync(join(dir, 'p', 'a.txt'), join(dir, 'p', 'dentro.txt'))
    expect(await a.call('palco:nodeState:copyFile', a.file(join(dir, 'p', 'dentro.txt')))).toBe(true)
    expect(electron.writeText).toHaveBeenCalledTimes(1)
  })
})

describe("Abrir nunca entrega executável, lançador, script ou AppImage ao sistema", () => {
  beforeEach(() => vi.clearAllMocks())
  const make = (name: string, content: string | Buffer, mode?: number): string => { const p = join(dir, name); writeFileSync(p, content); if (mode) chmodSync(p, mode); return p }
  it.each([
    ['bit de execução', 'prog.txt', 'oi', 0o755],
    ['.desktop sem execução', 'x.desktop', '[Desktop Entry]\nExec=sh -c id\n', 0],
    ['entrada de desktop disfarçada', 'x.txt', '[Desktop Entry]\nExec=id\n', 0],
    ['AppImage', 'App.AppImage', 'qualquer', 0],
    ['script por extensão', 'run.sh', 'echo oi', 0],
    ['script por shebang', 'sem-extensao', '#!/bin/sh\necho oi\n', 0],
    ['binário ELF renomeado', 'foto.png', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), 0],
    ['executável do Windows', 'doc.pdf', Buffer.from('MZ\x90\x00resto'), 0],
    ['pacote', 'p.deb', 'x', 0],
    ['atalho de internet', 'a.url', '[InternetShortcut]', 0]
  ])('%s: mostra na pasta e não abre', async (_label, name, content, mode) => {
    const a = area()
    expect(await a.call('palco:nodeState:open', a.file(make(name, content, mode)))).toBe('revealed')
    expect(electron.openPath).not.toHaveBeenCalled(); expect(electron.showItemInFolder).toHaveBeenCalledWith(join(dir, name))
  })
  it('arquivo comum abre pelo caminho real; link para um executável não abre; link que sai da pasta é recusado', async () => {
    const a = area(); const plain = make('nota.txt', 'oi')
    expect(await a.call('palco:nodeState:open', a.file(plain))).toBe('opened'); expect(electron.openPath).toHaveBeenCalledWith(plain)
    electron.openPath.mockClear()
    make('prog', '#!/bin/sh\n', 0o755); symlinkSync(join(dir, 'prog'), join(dir, 'inocente.txt'))
    expect(await a.call('palco:nodeState:open', a.file(join(dir, 'inocente.txt')))).toBe('revealed'); expect(electron.openPath).not.toHaveBeenCalled()
    mkdirSync(join(dir, 'p')); symlinkSync(plain, join(dir, 'p', 'fuga.txt'))
    await expect(a.call('palco:nodeState:open', a.file(join(dir, 'p', 'fuga.txt')))).rejects.toThrow(/link/)
  })
  it('só nó arquivo abre; Mostrar na Pasta de uma árvore exige que a raiz seja pasta de verdade', async () => {
    const a = area(); const exe = make('x.desktop', '[Desktop Entry]\n'); mkdirSync(join(dir, 'raiz'))
    await expect(a.call('palco:nodeState:open', a.tree(join(dir, 'raiz')))).rejects.toThrow()
    await expect(a.call('palco:nodeState:reveal', a.tree(exe))).rejects.toThrow(); expect(electron.openPath).not.toHaveBeenCalled()
    await a.call('palco:nodeState:reveal', a.tree(join(dir, 'raiz'))); expect(electron.openPath).toHaveBeenCalledWith(join(dir, 'raiz'))
    mkdirSync(join(dir, 'p')); symlinkSync(join(dir, 'raiz'), join(dir, 'p', 'atalho'))
    await expect(a.call('palco:nodeState:reveal', a.tree(join(dir, 'p', 'atalho')))).rejects.toThrow(/link/)
    await expect(a.call('palco:nodeState:reveal', a.file(join(dir, 'nao-existe')))).rejects.toThrow()
    await a.call('palco:nodeState:reveal', a.file(exe)); expect(electron.showItemInFolder).toHaveBeenCalledWith(exe)
  })
})

describe("Descarregar só marca depois de o processo sair de verdade", () => {
  const fakePty = (exitsOn: string | null) => {
    let onExit: (e: { exitCode: number }) => void = () => {}
    const signals: string[] = []
    const manager = new TerminalManager({
      socketPath: join(dir, 's.sock'), palcoBin: '/opt/palco/bin/palco', env: { SHELL: '/bin/bash' }, stopTimeoutMs: 40, killTimeoutMs: 40,
      spawnPty: (() => ({ pid: 999_999, onData: () => {}, onExit: (cb: typeof onExit) => { onExit = cb }, write: () => {}, resize: () => {}, kill: () => {} })) as never,
      signalProcess: (_pid, signal) => { signals.push(signal); if (signal === exitsOn) setTimeout(() => onExit({ exitCode: 137 }), 5) }
    })
    return { manager, signals }
  }
  const setup = (manager: TerminalManager) => {
    const store = new WorkspaceStore(join(dir, 'ws.json')), id = store.addNode(term())
    manager.spawn(store.get().nodes[id] as TerminalNode)
    return { store, id, deps: { registry: { storeOfNode: () => store }, terminals: manager, portals: { unregister: vi.fn() } } }
  }
  it('processo que ignora o SIGTERM leva SIGKILL; a marca só entra depois da saída', async () => {
    const { manager, signals } = fakePty('SIGKILL'), { store, id, deps } = setup(manager)
    const done = unloadNodes(deps, [id])
    expect((store.get().nodes[id] as TerminalNode).unloaded).toBeUndefined()
    await done
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']); expect((store.get().nodes[id] as TerminalNode).unloaded).toBe(true)
    expect(manager.isRunning(id)).toBe(false); expect(manager.hasSession(id)).toBe(false)
  })
  it('processo que não morre: falha, não marca e continua contado como rodando', async () => {
    const { manager } = fakePty(null), { store, id, deps } = setup(manager)
    await expect(unloadNodes(deps, [id])).rejects.toThrow(/não encerrou/)
    expect((store.get().nodes[id] as TerminalNode).unloaded).toBeUndefined(); expect(manager.isRunning(id)).toBe(true)
  })
  it('com um shell de verdade que ignora HUP e TERM, o PID deixa de existir', async () => {
    const manager = new TerminalManager({ socketPath: join(dir, 's.sock'), palcoBin: '/opt/palco/bin/palco', env: { SHELL: '/bin/bash', PS1: '$ ' }, stopTimeoutMs: 300, killTimeoutMs: 3000 })
    try {
      const { store, id, deps } = setup(manager)
      manager.write(id, `trap "" HUP TERM; echo $$ > ${join(dir, 'pid')}; sleep 60\r`)
      for (let i = 0; i < 200 && !(existsSync(join(dir, 'pid')) && readFileSync(join(dir, 'pid'), 'utf8').trim()); i++) await new Promise((r) => setTimeout(r, 25))
      const pid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim())
      await unloadNodes(deps, [id])
      expect(() => process.kill(pid, 0)).toThrow(); expect((store.get().nodes[id] as TerminalNode).unloaded).toBe(true)
    } finally { manager.killAll() }
  }, 20_000)
})

describe("a marca de descarregado só sai se o início der certo", () => {
  const setup = (terminals: { startConfirmed(n: TerminalNode): Promise<void>; dispose(id: string): void }) => {
    const store = new WorkspaceStore(join(dir, 'ws.json')), id = store.addNode(term()); store.setUnloaded(id, true)
    return { store, id, deps: { registry: { storeOfNode: () => store }, terminals: { ...terminals, unload: vi.fn(), isRunning: () => false }, portals: { unregister: vi.fn() } } }
  }
  it('falha ao iniciar mantém descarregado, limpa a partida e continua fora do relançamento', async () => {
    const dispose = vi.fn(), { store, id, deps } = setup({ startConfirmed: async () => { throw new Error('spawn falhou') }, dispose })
    await expect(wakeNode(deps, id)).rejects.toThrow('spawn falhou')
    expect((store.get().nodes[id] as TerminalNode).unloaded).toBe(true); expect(dispose).toHaveBeenCalledWith(id); expect(lazyTerminals(store.get())).toEqual([])
  })
  it('início confirmado tira a marca', async () => {
    const { store, id, deps } = setup({ startConfirmed: async () => {}, dispose: vi.fn() })
    await wakeNode(deps, id); expect((store.get().nodes[id] as TerminalNode).unloaded).toBeUndefined()
  })
  const manager = (extra: Record<string, unknown> = {}) => new TerminalManager({ socketPath: join(dir, 's.sock'), palcoBin: '/opt/palco/bin/palco', env: { SHELL: '/bin/bash' }, startGraceMs: 150, ...extra })
  it('o manager rejeita quando o spawn lança, quando o processo sai na hora e quando o ambiente falha', async () => {
    const broken = manager({ spawnPty: (() => { throw new Error('sem pty') }) as never })
    await expect(broken.startConfirmed({ ...term(), id: 'a' } as TerminalNode)).rejects.toThrow('sem pty')
    const dies = manager({ spawnPty: (() => ({ pid: 999_999, onData: () => {}, onExit: (cb: (e: { exitCode: number }) => void) => { setTimeout(() => cb({ exitCode: 1 }), 20) }, write: () => {}, resize: () => {}, kill: () => {} })) as never })
    await expect(dies.startConfirmed({ ...term(), id: 'b' } as TerminalNode)).rejects.toThrow(/não iniciou/)
    const remote = manager({ environments: { prepare: async () => ({ error: 'contêiner indisponível' }) } })
    await expect(remote.startConfirmed({ ...term(), id: 'c', environment: { kind: 'docker', container: 'x' } } as never)).rejects.toThrow(/não iniciou/)
  })
  it('o manager confirma um shell de verdade que fica de pé', async () => {
    const real = manager()
    try { await real.startConfirmed({ ...term(), id: 'd' } as TerminalNode); expect(real.isRunning('d')).toBe(true) } finally { real.killAll() }
  })
})

describe("a trava vale no store e no main", () => {
  const store = () => new WorkspaceStore(join(dir, 'ws.json'))
  const rect = { floorId: null, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#fff', width: 2, tool: 'rect' as const }
  it('nó bloqueado não se apaga, não se move e não muda de tamanho; renomear e desbloquear continuam', () => {
    const s = store(), id = s.addNode(term({ positionLocked: true } as never))
    expect(() => s.removeNode(id)).toThrow(/bloqueado/)
    expect(() => s.patchNode(id, { pos: { x: 40, y: 0 } })).toThrow(/bloqueado/)
    expect(() => s.patchNode(id, { size: { w: 900, h: 600 } })).toThrow(/bloqueado/)
    s.patchNode(id, { name: 'Outro', pos: { x: 0, y: 0 } })
    s.patchNode(id, { positionLocked: false, pos: { x: 40, y: 0 } }); s.removeNode(id); expect(s.get().nodes[id]).toBeUndefined()
  })
  it('desenho bloqueado não se apaga nem muda de geometria; a cor e a ordem mudam', () => {
    const s = store(), id = s.addDrawing(rect); s.patchDrawing(id, { locked: true })
    expect(() => s.removeDrawing(id)).toThrow(/bloqueado/)
    expect(() => s.patchDrawing(id, { points: [{ x: 5, y: 5 }, { x: 9, y: 9 }] })).toThrow(/bloqueado/)
    expect(() => s.patchDrawing(id, { rotation: 1 })).toThrow(/bloqueado/)
    s.patchDrawing(id, { color: '#000000', order: 'front' }); s.patchDrawing(id, { locked: false }); s.removeDrawing(id)
  })
  it('fichário: com um membro bloqueado, os outros não se movem nem mudam de tamanho (mas podem sair dele)', () => {
    const s = store()
    const note = (name: string, extra = {}) => s.addNode({ kind: 'note', name, content: '', stackId: 'f1', ...base, ...extra } as NewNode)
    note('A', { positionLocked: true }); const b = note('B')
    expect(() => s.patchNode(b, { pos: { x: 100, y: 0 } })).toThrow(/bloqueado/); expect(() => s.patchNode(b, { size: { w: 500, h: 300 } })).toThrow(/bloqueado/)
    s.patchNode(b, { stackId: null, pos: { x: 400, y: 0 } })
  })
  it('banda: dissolver uma bloqueada é recusado; pela CLI, apagar uma nota bloqueada também', () => {
    const s = store(), m = s.addNode(term()), band = s.createBand('B', [m], null); s.patchNode(band, { positionLocked: true })
    expect(() => s.dissolveBand(band)).toThrow(/bloqueado/)
    const caller = s.addNode(term({ name: 'C' } as never)), n = s.addNode({ kind: 'note', name: 'N', content: '', ...base, positionLocked: true } as NewNode); s.connect(caller, n)
    expect(() => new BaseActions(s, s.get().nodes[caller] as TerminalNode).delete('N', false)).toThrow(/bloqueado/)
    expect(s.get().nodes[n]).toBeDefined()
  })
  it('IPC: apagar um bloqueado não mata o processo dele; um lote com bloqueado não aplica nada', async () => {
    electron.handlers.clear()
    const s = store(), dispose = vi.fn(), contents = { send: vi.fn() }
    const id = s.addNode(term({ positionLocked: true } as never)), free = s.addNode(term({ name: 'L' } as never))
    const registry = { active: () => s, activeId: () => s.get().id, get: () => s, storeOfNode: (x: string) => (s.hasNode(x) ? s : undefined), node: (x: string) => s.get().nodes[x], onChange: () => () => {}, onSidebar: () => () => {}, warning: undefined }
    const off = registerIpc({ registry, terminals: { spawn: vi.fn(), dispose, restart: vi.fn(), onData: () => () => {}, onExit: () => () => {} }, floors: {}, portals: { register: vi.fn(), unregister: vi.fn() }, isPortalGuest: () => true, getWindow: () => ({ webContents: contents, isDestroyed: () => false }), isTrustedUrl: () => true } as unknown as IpcDeps)
    try {
      const invoke = async (ch: string, ...args: unknown[]) => electron.handlers.get(ch)!({ sender: contents, senderFrame: { parent: null, url: 'x' } }, ...args)
      await expect(invoke(CH.nodeRemove, id)).rejects.toThrow(/bloqueado/); expect(dispose).not.toHaveBeenCalled()
      await expect(invoke(CH.historyCommit, s.get().id, [{ type: 'node.remove', id: free }, { type: 'node.remove', id }])).rejects.toThrow(/bloqueado/)
      expect(Object.keys(s.get().nodes)).toHaveLength(2); expect(dispose).not.toHaveBeenCalled()
    } finally { off() }
  })
})

// ---------- renderer ----------
const wsWith = (patch: Record<string, Partial<CanvasNode>> = {}, extra: Partial<Workspace> = {}): Workspace => {
  const nodes: Record<string, CanvasNode> = {
    a: { id: 'a', kind: 'note', name: 'A', content: 'a', stackId: 's', ...base },
    b: { id: 'b', kind: 'note', name: 'B', content: 'b', stackId: 's', ...base },
    x: { id: 'x', kind: 'text', name: 'X', text: 'x', fontSize: 20, ...base, pos: { x: 600, y: 0 } },
    t: { id: 't', kind: 'terminal', name: 'T', agent: 'shell', command: '', cwd: '/', ...base, pos: { x: 1200, y: 0 } },
    m: { id: 'm', kind: 'terminal', name: 'M', agent: 'shell', command: '', cwd: '/', ...base, pos: { x: 0, y: 500 } },
    band: { id: 'band', kind: 'band', name: 'Time', members: ['m'], ...base }
  }
  for (const [k, v] of Object.entries(patch)) nodes[k] = { ...nodes[k]!, ...v } as CanvasNode
  return { id: 'w', name: 'W', nodes, connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 }, drawings: [{ id: 'd1', floorId: null, points: [{ x: 10, y: 300 }, { x: 60, y: 350 }], color: '#fff', width: 4, tool: 'rect', locked: true }], ...extra }
}
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
let api: ReturnType<typeof makeApi>
const makeApi = () => ({
  workspace: { get: async () => wsWith(), onChange: () => () => {} }, workspaces: { sidebar: async () => ({ workspaces: [] }) },
  node: { add: vi.fn(), patch: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
  history: { commit: vi.fn(async (_w: string, ops: unknown[]) => ops.map(() => 'n')) },
  presets: { list: vi.fn(async () => []) }, partitura: { list: vi.fn(async () => []) }, band: { dissolve: vi.fn(async () => {}) }, portal: { register: vi.fn() },
  nodeState: { unload: vi.fn(), wake: vi.fn(), reveal: vi.fn(async () => {}), open: vi.fn(async () => 'revealed' as const), copyFile: vi.fn(async () => true) },
  clipboard: { writeText: vi.fn(async () => {}), read: vi.fn(async () => ({ text: '', files: [], image: false })) }, preferences: { set: vi.fn() }, terminal: { setFocused: vi.fn() }
})
const dom = () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); suspendShortcuts(false); setLocale('pt-BR'); elementClipboard.clear()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); api = makeApi(); Object.assign(window, { palco: api })
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals() })
}
const mount = async (ws: Workspace, extra: Record<string, unknown> = {}) => {
  const spy = { onSelectOnly: vi.fn(), onSelectMany: vi.fn(), onConfirm: vi.fn(), onFail: vi.fn(), onNotice: vi.fn() }
  await act(async () => root.render(createElement(Canvas, { ws, camera: ws.camera, onCamera: vi.fn(), linkFrom: null, onLink: vi.fn(), selectedConn: null, onSelectConn: vi.fn(), selection: new Set<string>(), onToggleSelect: vi.fn(), onGoToFloor: vi.fn(), ...spy, ...extra })))
  const el = host.querySelector<HTMLElement>('.canvas')!
  el.setPointerCapture = vi.fn(); el.releasePointerCapture = vi.fn(); el.hasPointerCapture = () => true
  return { el, ...spy }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const rightClick = async (target: Element) => act(async () => { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 100 })); await tick() })
const item = (id: string) => document.querySelector<HTMLButtonElement>(`[data-menu-id="${id}"]`)!
const click = async (id: string) => act(async () => { item(id).click(); await tick() })
const header = (id: string) => host.querySelector(`[data-node-id="${id}"] .node-header`)!
const drag = async (el: HTMLElement, from: Element) => {
  const ev = async (target: Element, type: string, x: number) => act(async () => { target.dispatchEvent(new PointerEvent(type, { button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, clientX: x, clientY: x, bubbles: true })) })
  await ev(from, 'pointerdown', 10); await ev(el, 'pointermove', 90); await ev(el, 'pointerup', 90)
}

describe("a trava vale no renderer", () => {
  dom()
  it('apagar em lote (tecla, menu, barra) deixa os bloqueados de fora, inclusive desenhos e fichários', () => {
    const ws = wsWith({ t: { positionLocked: true }, a: { positionLocked: true } })
    expect(deleteOperations(ws, ['a', 'b', 'x', 't'], ['d1'])).toEqual([{ type: 'node.remove', id: 'x' }])
  })
  it('menu de um bloqueado: Apagar desabilitado; de um desenho bloqueado também', async () => {
    await mount(wsWith({ x: { positionLocked: true } }))
    await rightClick(header('x')); expect(item('delete').disabled).toBe(true)
    await rightClick(host.querySelector('.drawing-hit')!); expect(item('delete').disabled).toBe(true)
    await rightClick(header('t')); expect(item('delete').disabled).toBe(false)
  })
  it('numa seleção mista, Apagar do menu leva só os livres', async () => {
    await mount(wsWith({ x: { positionLocked: true } }), { selection: new Set(['x', 't']) })
    await rightClick(header('t')); await click('delete'); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'node.remove', id: 't' }])
  })
  it('banda: com um membro bloqueado, Apagar Banda fica desabilitado; banda bloqueada nem desagrupa', async () => {
    await mount(wsWith({ m: { positionLocked: true } }))
    await rightClick(host.querySelector('.band-label')!); expect(item('delete').disabled).toBe(true); expect(item('dissolve').disabled).toBe(false)
    await mount(wsWith({ band: { positionLocked: true } }))
    await rightClick(host.querySelector('.band-label')!); expect(item('delete').disabled).toBe(true); expect(item('dissolve').disabled).toBe(true)
  })
  it('a barra de ações não apaga um bloqueado', async () => {
    const ws = wsWith({ t: { positionLocked: true } })
    await act(async () => root.render(<ContextualBar ws={ws} selection={new Set(['t'])} linkFrom={null} onLink={vi.fn()} onEdit={vi.fn()} onCreateBand={vi.fn()} onFocus={vi.fn()} onCleared={vi.fn()} onError={vi.fn()} modeHint={null} />))
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Excluir terminal"]')!.disabled).toBe(true)
  })
})

describe("fichário com um membro bloqueado não se move", () => {
  dom()
  it('a regra de mover leva o conjunto: nenhuma nota do fichário se move', () => {
    expect(movableNodeIds(wsWith({ a: { positionLocked: true } }), ['b', 'x'])).toEqual(['x'])
  })
  it('arrastar e redimensionar a aba livre não grava nada', async () => {
    const c = await mount(wsWith({ b: { positionLocked: true } }))
    await drag(c.el, header('a'))
    expect(api.history.commit).not.toHaveBeenCalled()
    expect(host.querySelector('[data-node-id="a"] .resize-handle')).toBeNull()
  })
  it('Desempilhar Tudo solta todos, mas o bloqueado fica onde está', async () => {
    await mount(wsWith({ b: { positionLocked: true } }))
    await rightClick(header('a')); await click('unstack')
    expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'node.patch', id: 'a', patch: { stackId: null, pos: { x: 340, y: 0 } } }, { type: 'node.patch', id: 'b', patch: { stackId: null } }])
  })
})

describe("comandos de câmera ignoram a trava", () => {
  dom()
  it('caixa vazia não gera NaN', () => {
    const cam = fitCamera(unionBox([]), { w: 1000, h: 800 })
    expect([cam.zoom, cam.offset.x, cam.offset.y].every(Number.isFinite)).toBe(true)
  })
  it.each(['zoomSelection', 'toggleFocus'] as const)('%s num elemento bloqueado enquadra ele', async (kind) => {
    const changeCamera = vi.fn(), ws = wsWith({ x: { positionLocked: true } })
    let run!: ReturnType<typeof useCanvasCommands>
    function Probe() {
      run = useCanvasCommands({ dock: { dockedId: null, edge: 'trailing', memory: [], liftedId: null }, setDock: vi.fn(), ws: { current: ws }, camera: { current: ws.camera }, view: { current: { w: 1000, h: 800 } }, sidebar: { current: null }, selection: new Set(['x']), setSelection: vi.fn(), changeCamera, switchWorkspace: async () => {}, toggleMinimap: vi.fn(), openSearch: vi.fn(), notify: vi.fn() })
      return null
    }
    await act(async () => root.render(<Probe />))
    run({ kind })
    const cam = changeCamera.mock.calls[0]![0] as { zoom: number; offset: { x: number; y: number } }
    expect([cam.zoom, cam.offset.x, cam.offset.y].every(Number.isFinite)).toBe(true)
    // O centro da caixa do elemento fica no centro da vista.
    expect(cam.offset.x + (600 + 150) * cam.zoom).toBeCloseTo(500); expect(cam.offset.y + 100 * cam.zoom).toBeCloseTo(400)
  })
})

describe('Abrir que vira "mostrar na pasta" avisa o usuário', () => {
  dom()
  it('o renderer diz por que não abriu', async () => {
    const ws = wsWith(); ws.nodes.f = { id: 'f', kind: 'file', name: 'x.desktop', path: '/tmp/x.desktop', ...base, pos: { x: 900, y: 500 } }
    Object.assign(window.palco, { files: { read: async () => ({ kind: 'binary', data: '', truncated: false }) } })
    const c = await mount(ws)
    await rightClick(header('f')); await click('open')
    expect(c.onNotice).toHaveBeenCalledWith(expect.stringMatching(/pasta/))
  })
})

describe("o botão direito não engole o menu de outro lugar", () => {
  dom()
  const pointer = async (target: Element, type: string, x: number) => act(async () => { target.dispatchEvent(new PointerEvent(type, { button: 2, buttons: type === 'pointerup' ? 0 : 2, pointerId: 3, clientX: x, clientY: 100, bubbles: true, cancelable: true })) })
  const menuOn = async (target: Element) => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }); await act(async () => { target.dispatchEvent(ev) }); return ev }
  const enabled = () => adoptPreferences({ ...defaultPreferences(), rightDragPansCanvas: true })
  it('Linux (contextmenu no aperto): depois do arrasto, um campo fora do canvas tem o menu dele', async () => {
    enabled(); const c = await mount(wsWith()), field = document.createElement('input'); document.body.append(field)
    await pointer(c.el, 'pointerdown', 10); await menuOn(c.el); await pointer(c.el, 'pointermove', 80); await pointer(c.el, 'pointerup', 80)
    expect((await menuOn(field)).defaultPrevented).toBe(false)
  })
  it('Windows (contextmenu no soltar): engole só o do canvas e logo em seguida', async () => {
    enabled(); const c = await mount(wsWith()), field = document.createElement('input'); document.body.append(field)
    const dragRight = async () => { await pointer(c.el, 'pointerdown', 10); await pointer(c.el, 'pointermove', 80); await pointer(c.el, 'pointerup', 80) }
    await dragRight(); expect((await menuOn(c.el)).defaultPrevented).toBe(true); expect(document.querySelector('.cmenu-menu')).toBeNull()
    await dragRight(); expect((await menuOn(field)).defaultPrevented).toBe(false)
    await dragRight(); await new Promise((r) => setTimeout(r, 120)); await menuOn(c.el); expect(document.querySelector('.cmenu-menu')).toBeTruthy()
  })
})

describe('menor: Mostrar Tamanho tem efeito nos três modos', () => {
  dom()
  const ws = () => { const w = wsWith(); w.nodes.p = { id: 'p', kind: 'portal', name: 'P', url: 'about:blank', ...base, pos: { x: 900, y: 500 } }; return w }
  it.each([['always', true, true], ['onResize', false, true], ['never', false, false]] as const)('%s', async (mode, atRest, whileResizing) => {
    adoptPreferences({ ...defaultPreferences(), portalSizeReadout: mode })
    const c = await mount(ws())
    expect(!!host.querySelector('.portal-size')).toBe(atRest)
    const handle = host.querySelector('[data-node-id="p"] .resize-handle')!
    const ev = async (target: Element, type: string, x: number) => act(async () => { target.dispatchEvent(new PointerEvent(type, { button: 0, buttons: 1, pointerId: 1, clientX: x, clientY: x, bubbles: true })) })
    await ev(handle, 'pointerdown', 10); await ev(c.el, 'pointermove', 80)
    expect(!!host.querySelector('.portal-size')).toBe(whileResizing)
  })
})
