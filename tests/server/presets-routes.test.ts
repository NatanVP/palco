// Pure route handlers: authorization is still enforced by the HTTP server, without sockets here.
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { RoleStore } from '../../src/main/agents/roles'
import { PresetStore, AgentCatalog } from '../../src/main/agents/presets'
import { createAgentRoutes } from '../../src/main/agents/routes'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
it('assigns only a reachable/self agent, persists for next boot, and gives explicit statuses', () => {
  vi.useFakeTimers()
  const dir = mkdtempSync(join(process.cwd(), 'tests/server/.presets-'))
  try {
    const roles = new RoleStore(join(dir, 'roles')), catalog = new AgentCatalog(new PresetStore(join(dir, 'presets.json'), roles), roles)
    const store = new WorkspaceStore(join(dir, 'workspace.json'))
    const id = store.addNode({ kind: 'terminal', floorId: null, name: 'A', agent: 'claude', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
    const caller = store.get().nodes[id]!
    if (caller.kind !== 'terminal') throw new Error('fixture')
    const routes = createAgentRoutes(catalog, store)
    const call = (route: string, body: Record<string, unknown>) => routes[route]!({ caller, body, url: new URL('http://palco') })
    call('POST /role/create', { name: 'review', text: 'Review carefully' })
    expect(call('POST /role/assign', { name: 'A', role: 'review' }).body).toContain('reinício')
    expect(store.get().nodes[id]).toMatchObject({ role: 'review' })
    expect(() => call('POST /preset/create', { name: 'bad', agent: 'shell', role: 'review' })).toThrowError(expect.objectContaining({ status: 400 }))
    expect(() => call('POST /preset/create', { name: 'bad', agent: 'claude', role: 'missing' })).toThrowError(expect.objectContaining({ status: 404 }))
    call('POST /role/assign', { name: 'A', none: true })
    expect(store.get().nodes[id]).not.toHaveProperty('role')
  } finally { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})
it('protects canonical role aliases and references held only by saved partituras', async () => {
  vi.useFakeTimers(); const dir = mkdtempSync(join(process.cwd(), 'tests/server/.presets-'))
  try {
    const { PartituraStore } = await import('../../src/main/partituras/partitura-store')
    const roles = new RoleStore(join(dir, 'roles')), catalog = new AgentCatalog(new PresetStore(join(dir, 'p.json'), roles), roles), lib = new PartituraStore(join(dir, 'parts'))
    roles.create('Tech Lead', 'Review')
    const store = new WorkspaceStore(join(dir, 'ws'))
    const node = { kind: 'terminal' as const, floorId: null, name: 'A', agent: 'claude' as const, command: 'claude', cwd: '/tmp', role: 'Tech Lead', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
    const id = store.addNode(node), caller = store.get().nodes[id]!
    if (caller.kind !== 'terminal') throw new Error('fixture')
    const routes = createAgentRoutes(catalog, store, lib)
    const ctx = { caller, body: { name: 'tech-lead' }, url: new URL('http://palco') }
    expect(() => routes['POST /role/delete']!(ctx)).toThrowError(expect.objectContaining({ status: 409 }))
    lib.save({ name: 'saved', createdAt: new Date().toISOString(), nodes: [{ ...node, key: 'a' }], connections: [], bands: [] })
    store.removeNode(id)
    expect(() => routes['POST /role/delete']!(ctx)).toThrowError(expect.objectContaining({ status: 409 }))
  } finally { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})
it('does not delete a role referenced only by a saved partitura', async () => {
  vi.useFakeTimers(); const dir = mkdtempSync(join(process.cwd(), 'tests/server/.presets-'))
  try {
    const { PartituraStore } = await import('../../src/main/partituras/partitura-store')
    const roles = new RoleStore(join(dir, 'roles')); roles.create('review', 'Review')
    const lib = new PartituraStore(join(dir, 'parts')), store = new WorkspaceStore(join(dir, 'ws'))
    const node = { kind: 'terminal' as const, floorId: null, name: 'A', role: 'review', agent: 'claude' as const, command: 'claude', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
    const id = store.addNode({ ...node, role: undefined }), caller = store.get().nodes[id]!
    if (caller.kind !== 'terminal') throw new Error('fixture')
    lib.save({ name: 'saved', createdAt: new Date().toISOString(), nodes: [{ ...node, key: 'a' }], connections: [], bands: [] })
    const routes = createAgentRoutes(new AgentCatalog(new PresetStore(join(dir, 'p.json'), roles), roles), store, lib)
    expect(() => routes['POST /role/delete']!({ caller, body: { name: 'review' }, url: new URL('http://palco') })).toThrowError(expect.objectContaining({ status: 409 }))
  } finally { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})
