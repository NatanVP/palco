import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { writeEnvelopeAtomic } from '../../src/main/domain/envelope'
import type { NewNode } from '../../src/shared/model'

let dir: string
let file: string
let store: WorkspaceStore
const note = (name: string): NewNode => ({ kind: 'note', floorId: null, name, content: '', pos: { x: 0, y: 0 }, size: { w: 240, h: 160 } })
const terminal = (): NewNode => ({ kind: 'terminal', floorId: null, name: 'Shell', agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 600, h: 400 } })
beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(process.cwd(), 'tests/domain/.store-'))
  file = join(dir, 'workspace.json')
  store = new WorkspaceStore(file)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

it('assigns UUIDs and reloads a workspace, nodes and camera after flush', () => {
  const id = store.addNode(terminal())
  store.setCamera({ offset: { x: 42, y: -7 }, zoom: 1.5 })
  expect(id).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i)
  store.flush()
  expect(new WorkspaceStore(file).get()).toEqual(store.get())
})

it('persists only 300 ms after the last change and flush cancels the scheduled write', () => {
  const id = store.addNode(note('before'))
  vi.advanceTimersByTime(299)
  expect(existsSync(file)).toBe(false)
  store.patchNode(id, { name: 'after' })
  vi.advanceTimersByTime(299)
  expect(existsSync(file)).toBe(false)
  vi.advanceTimersByTime(1)
  expect(new WorkspaceStore(file).get().nodes[id]?.name).toBe('after')
  store.patchNode(id, { content: 'flush now' })
  store.flush()
  expect(vi.getTimerCount()).toBe(0)
  expect(new WorkspaceStore(file).get()).toEqual(store.get())
})

it('removes incident connections but leaves unrelated nodes and edges', () => {
  const a = store.addNode(note('a')), b = store.addNode(note('b')), c = store.addNode(note('c'))
  store.connect(a, b)
  const keep = store.connect(b, c)
  store.removeNode(a)
  expect(store.get().nodes[a]).toBeUndefined()
  expect(store.get().connections).toEqual([keep])
})

it('rejects self and missing endpoints, deduplicates reverse edges and disconnects by id', () => {
  const a = store.addNode(note('a')), b = store.addNode(note('b'))
  expect(() => store.connect(a, a)).toThrow()
  expect(() => store.connect(a, 'missing')).toThrow()
  const edge = store.connect(a, b)
  expect(store.connect(b, a)).toEqual(edge)
  expect(store.get().connections).toHaveLength(1)
  store.disconnect(edge.id)
  expect(store.get().connections).toEqual([])
})

it('rejects an undirected note cycle but permits a path through a terminal', () => {
  const a = store.addNode(note('a')), b = store.addNode(note('b')), c = store.addNode(note('c'))
  store.connect(a, b)
  store.connect(b, c)
  expect(() => store.connect(c, a)).toThrow(/ciclo/i)
  const t = store.addNode(terminal())
  store.connect(c, t)
  expect(() => store.connect(t, a)).not.toThrow()
})

it('publishes snapshots, unsubscribes, and prevents consumers from mutating internal state', () => {
  const changes: string[] = []
  const off = store.onChange(ws => {
    changes.push(Object.values(ws.nodes).map(n => n.name).join(','))
    ws.name = 'consumer mutation'
  })
  const input = note('first')
  const id = store.addNode(input)
  input.pos.x = 1234
  const patch = { pos: { x: 10, y: 20 }, content: 'new' }
  store.patchNode(id, patch)
  patch.pos.x = 999
  const copy = store.get()
  copy.nodes[id]!.name = 'changed externally'
  expect(store.get().name).not.toBe('consumer mutation')
  expect(store.get().nodes[id]).toMatchObject({ name: 'first', content: 'new', pos: { x: 10, y: 20 } })
  off()
  store.patchNode(id, { name: 'second' })
  expect(changes).toEqual(['first', 'first'])
})

it('never overwrites a future schema even when flush or mutations are requested', () => {
  writeEnvelopeAtomic(file, 'workspace', 3, store.get())
  const before = readFileSync(file, 'utf8')
  const future = new WorkspaceStore(file)
  expect(() => future.addNode(note('no'))).toThrow(/leitura/i)
  expect(() => future.setCamera({ offset: { x: 1, y: 2 }, zoom: 1 })).toThrow(/leitura/i)
  future.flush()
  vi.advanceTimersByTime(1000)
  expect(readFileSync(file, 'utf8')).toBe(before)
})
