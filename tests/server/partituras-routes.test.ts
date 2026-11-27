import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { PartituraStore } from '../../src/main/partituras/partitura-store'
import { createPartituraRoutes } from '../../src/main/partituras/routes'
it('creates/inserts through the same pure HTTP handlers and never starts commands when disabled', () => {
  vi.useFakeTimers(); const dir = mkdtempSync(join(process.cwd(), 'tests/server/.parts-'))
  try {
    const store = new WorkspaceStore(join(dir, 'ws')), lib = new PartituraStore(join(dir, 'parts')), spawned: string[] = []
    const id = store.addNode({ kind: 'terminal', floorId: null, name: 'Rev', agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
    const caller = store.get().nodes[id]!
    if (caller.kind !== 'terminal') throw new Error('fixture')
    const routes = createPartituraRoutes(lib, store, node => { spawned.push(node.id) }, undefined, () => {})
    const call = (route: string, body: Record<string, unknown>) => routes[route]!({ caller, body, url: new URL('http://palco') })
    call('POST /partitura/create', { name: 'saved', noteText: false })
    call('POST /partitura/insert', { name: 'saved', commands: false })
    expect(spawned).toEqual([])
    call('POST /partitura/insert', { name: 'saved', commands: true })
    expect(spawned).toHaveLength(1)
    expect(() => call('POST /partitura/insert', { name: 'saved', commands: 'off' })).toThrow()
  } finally { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})
it('compensates all inserted nodes and started PTYs when a later spawn fails', () => {
  vi.useFakeTimers(); const dir = mkdtempSync(join(process.cwd(), 'tests/server/.parts-'))
  try {
    const store = new WorkspaceStore(join(dir, 'ws')), lib = new PartituraStore(join(dir, 'parts'))
    const base = { kind: 'terminal' as const, floorId: null, agent: 'shell' as const, command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
    const id = store.addNode({ ...base, name: 'A' }); store.addNode({ ...base, name: 'B' })
    const before = store.get(), caller = before.nodes[id]!
    if (caller.kind !== 'terminal') throw new Error('fixture')
    const attempts: string[] = [], disposed: string[] = []
    const routes = createPartituraRoutes(lib, store, n => { attempts.push(n.id); if (attempts.length === 2) throw new Error('PTY failed') }, undefined, id => { disposed.push(id) })
    const ctx = { caller, body: { name: 'saved', commands: true }, url: new URL('http://palco') }
    routes['POST /partitura/create']!(ctx)
    expect(() => routes['POST /partitura/insert']!(ctx)).toThrow('PTY failed')
    expect(store.get()).toEqual(before)
    expect(disposed).toEqual(attempts)
  } finally { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})
