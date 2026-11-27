import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { reachable, resolveTarget } from '../../src/main/domain/reachability'
import type { FloorId, NewNode } from '../../src/shared/model'
let dir: string, store: WorkspaceStore
const terminal = (name: string, floorId: FloorId = null): NewNode => ({ kind: 'terminal', floorId, name, agent: 'shell', command: '', cwd: '/repo', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
beforeEach(() => { vi.useFakeTimers(); dir = mkdtempSync(join(process.cwd(), 'tests/domain/.bands-')); store = new WorkspaceStore(join(dir, 'ws')) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) })
it('expands X-band to members and reverses that connection without linking co-members', () => {
  const x = store.addNode(terminal('X')), a = store.addNode(terminal('A')), b = store.addNode(terminal('B'))
  const band = store.createBand('Team', [a, b, a], null)
  store.connect(x, band)
  expect(reachable(store.get(), x).map(n => n.id).sort()).toEqual([a, b, band].sort())
  expect(reachable(store.get(), a).map(n => n.id)).toEqual([x])
  expect(reachable(store.get(), b).map(n => n.id)).toEqual([x])
  expect(resolveTarget(store.get(), x, 'Team')).toMatchObject({ ok: true, node: { id: band } })
  store.connect(a, b)
  expect(reachable(store.get(), a).map(n => n.id)).toContain(b)
})
it('requires existing terminal members in the same floor and rejects cross-floor and band-band connections', () => {
  const floor = store.addFloor({ name: 'ui', repoRoot: '/repo', dir: '/repo.floors/ui', branch: 'palco/ui', baseRef: 'main' })
  const t = store.addNode(terminal('Ground')), far = store.addNode(terminal('Far', floor))
  const n = store.addNode({ kind: 'note', floorId: null, name: 'N', content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
  expect(() => store.createBand('bad', [t, far], null)).toThrow()
  expect(() => store.createBand('bad', [n], null)).toThrow()
  expect(() => store.createBand('bad', ['absent'], null)).toThrow()
  const a = store.createBand('a', [t], null), b = store.createBand('b', [t], null)
  expect(() => store.connect(a, b)).toThrow('banda não conecta com banda')
  // Terminais conversam entre floors (orquestrador no Ground, agente no floor); o resto não.
  expect(store.connect(t, far).b).toBe(far)
  const farNote = store.addNode({ kind: 'note', floorId: floor, name: 'FN', content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
  expect(() => store.connect(t, farNote)).toThrow('só terminais conectam entre floors')
  expect(() => store.connect(a, far)).toThrow('só terminais conectam entre floors')
  expect(() => store.bandAdd(a, far)).toThrow()
  expect(() => store.bandAdd(a, n)).toThrow()
})
it('adds members idempotently, removes them on delete, and dissolves without deleting terminals', () => {
  const a = store.addNode(terminal('A')), b = store.addNode(terminal('B'))
  const band = store.createBand('team', [a], null)
  store.bandAdd(band, b); store.bandAdd(band, b); store.bandRemove(band, a)
  expect(store.get().nodes[band]).toMatchObject({ members: [b] })
  store.bandAdd(band, a); store.removeNode(b)
  expect(store.get().nodes[band]).toMatchObject({ members: [a] })
  store.connect(a, band); store.dissolveBand(band)
  expect(store.get().nodes[band]).toBeUndefined()
  expect(store.get().nodes[a]).toBeDefined()
  expect(store.get().connections).toEqual([])
  expect(() => store.dissolveBand(a)).toThrow()
})
it('keeps direct cross-floor terminal edges, ignores cross-floor/stale band memberships, and cleans stale members on load', () => {
  const floor = store.addFloor({ name: 'ui', repoRoot: '/repo', dir: '/repo.floors/ui', branch: 'palco/ui', baseRef: 'main' })
  const x = store.addNode(terminal('X')), a = store.addNode(terminal('A')), far = store.addNode(terminal('Far', floor))
  const band = store.createBand('team', [a], null), ws = store.get()
  const node = ws.nodes[band]
  if (node?.kind !== 'band') throw new Error('bad fixture')
  node.members.push(far, 'removed', a)
  ws.connections.push({ id: 'good', a: x, b: band }, { id: 'direct', a: x, b: far })
  // far é alcançado só pela conexão direta; como membro da banda (outro floor) ele é ignorado
  expect(reachable(ws, x).map(n => n.id).sort()).toEqual([a, band, far].sort())
  ws.connections = ws.connections.filter(e => e.id !== 'direct')
  expect(reachable(ws, x).map(n => n.id).sort()).toEqual([a, band].sort())
  const file = join(dir, 'loaded')
  writeFileSync(file, JSON.stringify({ type: 'workspace', schemaVersion: 2, payload: ws }))
  expect(new WorkspaceStore(file).get().nodes[band]).toMatchObject({ members: [a] })
})
