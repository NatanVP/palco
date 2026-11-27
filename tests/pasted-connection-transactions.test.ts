import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import type { IpcDeps } from '../src/main/ipc'
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (ch: string, fn: never) => handlers.set(ch, fn), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() } }))
import { CH, registerIpc } from '../src/main/ipc'

const note = (name: string) => ({ kind: 'note', name, content: '', floorId: null, pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } })
let s: WorkspaceStore, other: WorkspaceStore, dir: string, off: () => void
const contents = { send: vi.fn() }, event = { sender: contents, senderFrame: { parent: null, url: 'file:///app' } }
const invoke = (ch: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(ch)!(event, ...args))
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'palco-cordas-')); s = new WorkspaceStore(join(dir, 'a.json')); other = new WorkspaceStore(join(dir, 'b.json'))
  handlers.clear()
  const registry = {
    active: () => s, activeId: () => s.get().id,
    get: (id: string) => { if (id === s.get().id) return s; if (id === other.get().id) return other; throw new Error('workspace inexistente') },
    storeOfNode: (id: string) => s.hasNode(id) ? s : other.hasNode(id) ? other : undefined,
    node: (id: string) => s.get().nodes[id] ?? other.get().nodes[id],
    onChange: (cb: (id: string, ws: unknown) => void) => s.onChange(ws => cb(ws.id, ws)), onSidebar: () => () => {}, warning: undefined
  }
  off = registerIpc({ registry, terminals: { spawn: vi.fn(), dispose: vi.fn(), onData: () => () => {}, onExit: () => () => {} }, floors: {}, portals: { register: vi.fn(), unregister: vi.fn() }, isPortalGuest: () => true, getWindow: () => ({ webContents: contents, isDestroyed: () => false }), isTrustedUrl: (url: string) => url === 'file:///app' } as unknown as IpcDeps)
})
afterEach(() => { off(); s.dispose(); other.dispose(); rmSync(dir, { recursive: true, force: true }) })

it('connection.add aponta para nós criados antes no mesmo lote (pelo índice), numa transação só', async () => {
  const ids = await invoke(CH.historyCommit, s.get().id, [
    { type: 'node.add', node: note('A') }, { type: 'node.add', node: note('B') },
    { type: 'connection.add', a: { op: 0 }, b: { op: 1 } }
  ]) as unknown[]
  const [a, b, conn] = ids as [string, string, { a: string; b: string }]
  expect(s.get().connections).toHaveLength(1)
  expect([conn.a, conn.b].sort()).toEqual([a, b].sort())
  await invoke(CH.historyUndo, s.get().id)
  expect(Object.keys(s.get().nodes)).toEqual([])
  expect(s.get().connections).toEqual([])
  expect(await invoke(CH.historyCanUndo, s.get().id)).toBe(false)
})

it('mistura referência e id existente', async () => {
  const old = s.addNode(note('Velha') as never)
  const ids = await invoke(CH.historyCommit, s.get().id, [{ type: 'node.add', node: note('Nova') }, { type: 'connection.add', a: old, b: { op: 0 } }]) as unknown[]
  expect(s.get().connections).toHaveLength(1)
  expect(s.get().connections[0]).toMatchObject(ids[1] as object)
})

it('referência inválida recusa o lote inteiro sem mudar nada', async () => {
  const bad = async (ops: unknown[]) => expect(invoke(CH.historyCommit, s.get().id, ops)).rejects.toThrow(/referência/)
  await bad([{ type: 'connection.add', a: { op: 0 }, b: { op: 1 } }])
  await bad([{ type: 'node.add', node: note('A') }, { type: 'connection.add', a: { op: 0 }, b: { op: 1 } }])
  await bad([{ type: 'node.add', node: note('A') }, { type: 'connection.add', a: { op: 0 }, b: { op: 2 } }, { type: 'node.add', node: note('B') }])
  await bad([{ type: 'drawing.add', drawing: { floorId: null, points: [{ x: 0, y: 0 }], color: '#fff', width: 2 } }, { type: 'node.add', node: note('B') }, { type: 'connection.add', a: { op: 0 }, b: { op: 1 } }])
  await bad([{ type: 'node.add', node: note('A') }, { type: 'connection.add', a: { op: '0' }, b: { op: 0 } }])
  await bad([{ type: 'node.add', node: note('A') }, { type: 'connection.add', a: { op: -1 }, b: { op: 0 } }])
  expect(Object.keys(s.get().nodes)).toEqual([])
  expect(await invoke(CH.historyCanUndo, s.get().id)).toBe(false)
})
