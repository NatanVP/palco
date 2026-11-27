import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { RoutineStore } from '../../src/main/routines/routine-store'
import { startServer } from '../../src/main/server/http-server'
import { HEADER_TOKEN } from '../../src/shared/auth'
const transport = vi.hoisted(() => ({ handler: undefined as undefined | ((req: IncomingMessage, res: ServerResponse) => void) }))
vi.mock('node:http', async original => {
  const real = await original<typeof import('node:http')>(), { EventEmitter } = await import('node:events'), { writeFileSync } = await import('node:fs')
  const createServer = (handler: typeof transport.handler) => {
    transport.handler = handler
    return Object.assign(new EventEmitter(), { listen(path: string, cb: () => void) { writeFileSync(path, 'fake socket'); cb() }, close(cb: () => void) { cb() }, closeAllConnections() {} })
  }
  return { ...real, default: { ...real, createServer }, createServer }
})
it('routes every routine operation through the authenticated caller workspace without real sockets', async () => {
  const dir = mkdtempSync(join(process.cwd(), 'tests/server/.routine-handlers-'))
  let close: (() => Promise<void>) | undefined
  const registry = new WorkspaceRegistry(join(dir, 'workspaces'))
  try {
    const a = registry.active(), b = registry.get(registry.create('B'))
    const node = { kind: 'terminal' as const, floorId: null, name: 'Agent', agent: 'shell' as const, command: '', cwd: '/tmp', maestro: true, pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
    const aid = a.addNode(node), bid = b.addNode(node), routines = new RoutineStore(join(dir, 'routines.json')), runNow = vi.fn(() => 'ok')
    close = (await startServer(join(dir, 'socket'), { registry, broker: {} as never, terminals: { identify: (id: string) => ({ id, gen: 1 }) } as never, routines: { store: routines, runner: { runNow } as never } })).close
    const call = (who: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> => new Promise(resolve => {
      let status = 0
      const req = Object.assign(new EventEmitter(), { method, url: path, headers: { [HEADER_TOKEN]: who }, resume() {} })
      const res = Object.assign(new EventEmitter(), { writableFinished: false, writeHead(code: number) { status = code }, end(data: string) { res.writableFinished = true; resolve({ status, body: data }) } })
      transport.handler!(req as unknown as IncomingMessage, res as unknown as ServerResponse)
      queueMicrotask(() => { if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
    })
    const create = (who: string, name: string) => call(who, 'POST', '/routine/create', { name, content: who === aid ? 'only A' : 'only B', every: '5m' })
    expect((await create(aid, 'same')).status).toBe(200)
    expect((await create(bid, 'same')).status).toBe(200)
    expect((await create(aid, 'private-A')).status).toBe(200)
    expect((await create(aid, 'same')).status).toBe(409)
    const list = JSON.parse((await call(bid, 'GET', '/routine/list')).body)
    expect(list.map((r: { content: string }) => r.content)).toEqual(['only B'])
    expect((await call(bid, 'GET', '/routine/show?name=private-A')).status).toBe(404)
    for (const action of ['run', 'enable', 'disable', 'delete']) expect((await call(bid, 'POST', '/routine/' + action, { name: 'private-A' })).status).toBe(404)
    expect(runNow).not.toHaveBeenCalled()
    expect((await call(bid, 'POST', '/routine/run', { name: 'same' })).status).toBe(200)
    expect(runNow).toHaveBeenCalledWith(routines.list().find(r => r.workspaceId === registry.idOf(b))!.id)
    expect((await create(bid, 'private-A')).status).toBe(200)
  } finally { await close?.(); registry.flushAll(); for (const w of registry.list()) registry.get(w.id).dispose(); rmSync(dir, { recursive: true, force: true }) }
})
