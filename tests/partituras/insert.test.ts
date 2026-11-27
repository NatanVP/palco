import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { capturePartitura, insertPartitura } from '../../src/main/partituras/insert'
import { PartituraStore } from '../../src/main/partituras/partitura-store'
import type { Partitura } from '../../src/shared/model'
let dir: string, store: WorkspaceStore
beforeEach(() => { vi.useFakeTimers(); dir = mkdtempSync(join(process.cwd(), 'tests/partituras/.data-')); store = new WorkspaceStore(join(dir, 'ws')) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) })
function capture(): Partitura {
  const t = store.addNode({ kind: 'terminal', floorId: null, name: 'Rev', agent: 'claude', command: 'claude', role: 'review', cwd: '/old', recruitedBy: 'old-owner', pos: { x: 100, y: 200 }, size: { w: 300, h: 200 } })
  const note = store.addNode({ kind: 'note', floorId: null, name: 'Plan', content: 'private note fixture', pos: { x: 450, y: 210 }, size: { w: 240, h: 160 } })
  const band = store.createBand('Team', [t], null)
  store.patchNode(band, { pos: { x: 80, y: 180 } })
  store.connect(note, band)
  return { ...capturePartitura(store.get(), null, { noteText: false }), name: 'Team', createdAt: new Date().toISOString() }
}
it('captures relative positions, strips ownership, and preserves band endpoints across two inserts', () => {
  const p = capture()
  const lib = new PartituraStore(join(dir, 'partituras'))
  lib.save(p); expect(new PartituraStore(join(dir, 'partituras')).get('Team')).toEqual(p)
  expect(p.nodes.every(n => n.pos.x >= 0 && n.pos.y >= 0)).toBe(true)
  expect(p.nodes.find(n => n.kind === 'note')).toMatchObject({ content: '' })
  expect(p.nodes.find(n => n.kind === 'terminal')).not.toHaveProperty('recruitedBy')
  const target = new WorkspaceStore(join(dir, 'target'))
  const first = insertPartitura(target, p, null, { x: 100, y: 300 }, { commands: true })
  const second = insertPartitura(target, p, null, { x: 800, y: 300 }, { commands: false })
  expect(first).toHaveLength(1); expect(second).toEqual([])
  const ws = target.get(), terminals = Object.values(ws.nodes).filter(n => n.kind === 'terminal')
  expect(terminals.map(n => n.name)).toEqual(['Rev', 'Rev 2'])
  expect(terminals[1]).toMatchObject({ autoStart: false, role: 'review' })
  const bands = Object.values(ws.nodes).filter(n => n.kind === 'band')
  expect(bands.map(n => n.members)).toEqual([[terminals[0]!.id], [terminals[1]!.id]])
  for (const edge of ws.connections) {
    const a = ws.nodes[edge.a]!, b = ws.nodes[edge.b]!
    expect(a.name.endsWith(' 2')).toBe(b.name.endsWith(' 2'))
  }
  target.flush()
  expect(new WorkspaceStore(join(dir, 'target')).get()).toEqual(ws)
})
it('rejects a broken graph before mutating the target and rebases cwd to the destination floor', () => {
  const p = capture(), target = new WorkspaceStore(join(dir, 'target'))
  const floor = target.addFloor({ name: 'new', repoRoot: '/repo', dir: '/repo.floors/new', branch: 'palco/new', baseRef: 'main' })
  expect(() => insertPartitura(target, { ...p, connections: [{ a: 'missing', b: 'also missing' }] }, floor, { x: 0, y: 0 }, { commands: true })).toThrow()
  expect(target.get().nodes).toEqual({})
  const [id] = insertPartitura(target, p, floor, { x: 0, y: 0 }, { commands: true })
  expect(target.get().nodes[id!]).toMatchObject({ cwd: '/repo.floors/new', floorId: floor })
})
it('terminal com cwd que não existe mais cai para a pasta do destino (floor ou home)', async () => {
  const { homedir } = await import('node:os')
  const p: Partitura = {
    name: 'Velha', createdAt: new Date().toISOString(), connections: [], bands: [],
    nodes: [
      { key: 'a', kind: 'terminal', floorId: null, name: 'Sumiu', agent: 'shell', command: '', cwd: join(dir, 'worktree-removida'), pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } },
      { key: 'b', kind: 'terminal', floorId: null, name: 'Existe', agent: 'shell', command: '', cwd: dir, pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
    ]
  }
  const target = new WorkspaceStore(join(dir, 'target-cwd'))
  insertPartitura(target, p, null, { x: 0, y: 0 }, { commands: false })
  const byName = Object.fromEntries(Object.values(target.get().nodes).map(n => [n.name, n]))
  expect(byName.Sumiu).toMatchObject({ cwd: homedir() })
  expect(byName.Existe).toMatchObject({ cwd: dir })
  const floor = target.addFloor({ name: 'ui', repoRoot: dir, dir: join(dir, 'floor-ui'), branch: 'palco/ui', baseRef: 'main' })
  insertPartitura(target, p, floor, { x: 0, y: 0 }, { commands: false })
  const inFloor = Object.values(target.get().nodes).filter(n => n.floorId === floor && n.kind === 'terminal')
  expect(inFloor.map(n => (n as { cwd: string }).cwd)).toEqual([join(dir, 'floor-ui'), join(dir, 'floor-ui')])
})
