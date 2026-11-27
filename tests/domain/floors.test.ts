import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import type { FloorId, NewNode } from '../../src/shared/model'
let dir: string, file: string, store: WorkspaceStore
const floor = (name: string) => ({ name, repoRoot: '/repo', dir: '/repo.floors/' + name, branch: 'palco/' + name, baseRef: 'main' })
const terminal = (floorId: FloorId): NewNode => ({ kind: 'terminal', floorId, name: 'T', agent: 'shell', command: '', cwd: '/repo', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
beforeEach(() => { vi.useFakeTimers(); dir = mkdtempSync(join(process.cwd(), 'tests/domain/.floors-')); file = join(dir, 'ws'); store = new WorkspaceStore(file) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) })
it('slugifies traversal, accents and whitespace, caps length, and rejects an empty slug', async () => {
  const { slugFloorName } = await import('../../src/main/domain/floor-name')
  expect(slugFloorName('Ação ../x')).toBe('acao-x')
  expect(slugFloorName(' Á '.repeat(50))).toHaveLength(39)
  expect(slugFloorName('a'.repeat(50))).toBe('a'.repeat(40))
  expect(() => slugFloorName('../ 💥')).toThrow('nome de floor inválido')
})
it('finds floors by slug, rejects collisions, and returns detached snapshots', () => {
  const id = store.addFloor(floor('Ação ui'))
  expect(store.findFloorByName('acao-ui')).toMatchObject({ id, name: 'Ação ui', camera: { offset: { x: 0, y: 0 }, zoom: 1 } })
  expect(() => store.addFloor(floor('acao-ui'))).toThrow()
  store.findFloorByName('acao-ui')!.name = 'mutated'
  expect(store.findFloorByName('acao-ui')!.name).toBe('Ação ui')
  expect(store.findFloorByName('absent')).toBeUndefined()
})
it('keeps a separate camera for Ground and each floor and validates switching', () => {
  const a = store.addFloor(floor('a')), b = store.addFloor(floor('b'))
  store.setCamera({ offset: { x: 10, y: 0 }, zoom: 1.1 })
  store.setActiveFloor(a); store.setCamera({ offset: { x: 20, y: 0 }, zoom: 1.2 })
  store.setActiveFloor(b); store.setCamera({ offset: { x: 30, y: 0 }, zoom: 1.3 })
  const ws = store.get()
  expect(ws.camera.offset.x).toBe(10)
  expect(ws.floors[a]!.camera.offset.x).toBe(20)
  expect(ws.floors[b]!.camera.offset.x).toBe(30)
  expect(() => store.setActiveFloor('missing')).toThrow()
  store.setActiveFloor(null)
  expect(store.get().activeFloor).toBeNull()
})
it('sets and clears floor status without retaining caller objects', () => {
  const id = store.addFloor(floor('a'))
  const status = { state: 'working' as const, progress: 'building' }
  store.setFloorStatus(id, status); status.progress = 'external mutation'
  expect(store.get().floors[id]!.status).toEqual({ state: 'working', progress: 'building' })
  store.setFloorStatus(id, null)
  expect(store.get().floors[id]!.status).toBeUndefined()
  expect(() => store.setFloorStatus('missing', null)).toThrow()
})
it('removes a floor with all its node kinds and edges, returns only terminal ids and resets active floor', () => {
  const id = store.addFloor(floor('a')), keep = store.addFloor(floor('b'))
  const t = store.addNode(terminal(id)), other = store.addNode(terminal(keep))
  const n = store.addNode({ kind: 'note', floorId: id, name: 'N', content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
  store.addNode({ kind: 'portal', floorId: id, name: 'Web', url: 'about:blank', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
  store.createBand('team', [t], id); store.connect(t, n); store.setActiveFloor(id)
  expect(store.removeFloor(id)).toEqual([t])
  expect(Object.keys(store.get().nodes)).toEqual([other])
  expect(store.get().connections).toEqual([])
  expect(store.get().activeFloor).toBeNull()
  expect(Object.keys(store.get().floors)).toEqual([keep])
})
it('migrates actual v1 data to Ground and writes v2 with all contents retained', () => {
  const ws = store.get()
  const { floorId: _floor, ...oldNode } = { ...terminal(null), id: 'old' }
  const { floors: _floors, activeFloor: _active, ...oldWs } = ws
  writeFileSync(file, JSON.stringify({ type: 'workspace', schemaVersion: 1, payload: { ...oldWs, nodes: { old: oldNode } } }))
  store = new WorkspaceStore(file)
  expect(store.get()).toMatchObject({ floors: {}, activeFloor: null, nodes: { old: { floorId: null } } })
  store.flush()
  expect(JSON.parse(readFileSync(file, 'utf8')).schemaVersion).toBe(2)
  expect(new WorkspaceStore(file).get()).toEqual(store.get())
})
it('round trips floors, bands and portals in v2 without opening read-only', () => {
  const id = store.addFloor(floor('ui')), t = store.addNode(terminal(id))
  store.createBand('team', [t], id)
  store.addNode({ kind: 'portal', floorId: id, name: 'Web', url: 'about:blank', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
  store.setActiveFloor(id); store.flush()
  const loaded = new WorkspaceStore(file)
  expect(loaded.get()).toEqual(store.get())
  expect(loaded.warning).toBeUndefined()
  expect(() => loaded.setActiveFloor(null)).not.toThrow()
})
it('repairs malformed v2 floors and invalid floor references', () => {
  for (const payload of [{ ...store.get(), floors: { bad: { id: 'bad' } } }, { ...store.get(), nodes: { t: { ...terminal('absent'), id: 't' } } }]) {
    writeFileSync(file, JSON.stringify({ type: 'workspace', schemaVersion: 2, payload }))
    const loaded = new WorkspaceStore(file)
    expect(loaded.warning).toBeTruthy()
    expect(loaded.warning).not.toMatch(/corrompido/)
    expect(loaded.get().floors).toEqual({})
    for (const node of Object.values(loaded.get().nodes)) expect(node.floorId).toBeNull()
  }
})

it('reabre intacto um workspace com conexão terminal↔terminal entre floors (recruit --floor)', () => {
  const id = store.addFloor({ name: 'ui', repoRoot: '/repo', dir: '/repo.floors/ui', branch: 'palco/ui', baseRef: 'main' })
  const ground = store.addNode(terminal(null)), far = store.addNode({ ...terminal(id), name: 'Rev' } as NewNode)
  store.connect(ground, far)
  store.flush()
  const again = new WorkspaceStore(file)
  expect(again.warning).toBeUndefined()
  expect(Object.keys(again.get().nodes).sort()).toEqual([ground, far].sort())
  expect(again.get().connections).toHaveLength(1)
})

it("preserva nós de texto, arquivo, árvore e desenhos ao reabrir", () => {
  store.addNode({ kind: 'text', floorId: null, name: 'T', text: 'olá', fontSize: 24, pos: { x: 0, y: 0 }, size: { w: 100, h: 40 } } as NewNode)
  store.addNode({ kind: 'file', floorId: null, name: 'F', path: '/tmp/a.png', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } } as NewNode)
  store.addNode({ kind: 'filetree', floorId: null, name: 'D', root: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } } as NewNode)
  store.flush()
  const ws = JSON.parse(readFileSync(file, 'utf8'))
  ws.payload.drawings = [{ id: 'd1', floorId: null, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#fff', width: 2 }]
  writeFileSync(file, JSON.stringify(ws))
  const again = new WorkspaceStore(file)
  expect(again.warning).toBeUndefined()
  expect(Object.values(again.get().nodes).map((n) => n.kind).sort()).toEqual(['file', 'filetree', 'text'])
  expect(again.get().drawings).toHaveLength(1)
})
