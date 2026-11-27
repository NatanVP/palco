import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { slugFloorName } from '../../src/main/domain/floor-name'
let dir: string, file: string, store: WorkspaceStore
const camera = { offset: { x: 0, y: 0 }, zoom: 1 }
const floor = { name: 'ui', repoRoot: '/repo', dir: '/repo.floors/ui', branch: 'palco/ui', baseRef: 'main' }
beforeEach(() => { vi.useFakeTimers(); dir = mkdtempSync(join(process.cwd(), 'tests/domain/.repair-')); file = join(dir, 'ws'); store = new WorkspaceStore(file) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) })
it('repairs activeFloor, both cameras, status and orphan nodes without losing the document', () => {
  const id = store.addFloor(floor)
  const note = store.addNode({ kind: 'note', floorId: id, name: 'Keep', content: 'keep text', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
  const ws = store.get()
  const broken = { ...ws, activeFloor: 'absent', camera: { offset: {}, zoom: 0 }, floors: { [id]: { ...ws.floors[id], camera: null, status: { state: 'done', progress: 5 } } }, nodes: { [note]: { ...ws.nodes[note], floorId: 'absent' } } }
  writeFileSync(file, JSON.stringify({ type: 'workspace', schemaVersion: 2, payload: broken }))
  const loaded = new WorkspaceStore(file)
  expect(loaded.get()).toMatchObject({ id: ws.id, activeFloor: null, camera, nodes: { [note]: { floorId: null, content: 'keep text' } }, floors: { [id]: { camera } } })
  expect(loaded.get().floors[id]!.status).toBeUndefined()
  for (const field of ['activeFloor', 'camera', 'status', 'floorId']) expect(loaded.warning).toContain(field)
  expect(loaded.warning!.split('; ')).toHaveLength(5)
  expect(readdirSync(dir).some(name => name.includes('corrompido'))).toBe(false)
  loaded.flush()
  expect(new WorkspaceStore(file).get()).toEqual(loaded.get())
})
it.each(['dir', 'branch', 'repoRoot', 'baseRef'])('discards a floor with invalid essential %s, retaining its nodes on Ground', field => {
  const id = store.addFloor(floor), ws = store.get()
  ws.nodes.n = { id: 'n', kind: 'note', floorId: id, name: 'Keep', content: 'text', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
  writeFileSync(file, JSON.stringify({ type: 'workspace', schemaVersion: 2, payload: { ...ws, activeFloor: id, floors: { [id]: { ...ws.floors[id], [field]: ' ' } } } }))
  const loaded = new WorkspaceStore(file)
  expect(loaded.get()).toMatchObject({ id: ws.id, floors: {}, activeFloor: null, nodes: { n: { floorId: null, content: 'text' } } })
  expect(loaded.warning!.split('; ')).toHaveLength(3)
  expect(readdirSync(dir).some(name => name.includes('corrompido'))).toBe(false)
})
it.each(['dir', 'branch', 'repoRoot', 'baseRef'])('rejects invalid %s in addFloor before mutation or persistence', field => {
  expect(() => store.addFloor({ ...floor, [field]: '' })).toThrow()
  expect(store.get().floors).toEqual({})
  expect(vi.getTimerCount()).toBe(0)
})
it('rejects blank band names and empty membership before mutation', () => {
  const t = store.addNode({ kind: 'terminal', floorId: null, name: 'T', agent: 'shell', command: '', cwd: '/repo', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
  expect(() => store.createBand(' ', [t], null)).toThrow()
  expect(() => store.createBand('Band', [], null)).toThrow()
  expect(Object.keys(store.get().nodes)).toEqual([t])
})
it('transliterates additional Latin letters without silently discarding unsupported letters', () => {
  expect(slugFloorName('Łódź Straße Æther Øresund')).toBe('lodz-strasse-aether-oresund')
  for (const input of ['日本語-ui', 'Привет', '💥']) expect(() => slugFloorName(input)).toThrow('use letras a-z, números e hífen')
})
