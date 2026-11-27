import * as fs from 'node:fs'
import { join } from 'node:path'
import * as envelopes from '../../src/main/domain/envelope'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
vi.mock('node:fs', async original => { const real = await original<typeof import('node:fs')>(); return { ...real, renameSync: vi.fn(real.renameSync) } })
vi.mock('../../src/main/domain/envelope', async original => { const real = await original<typeof import('../../src/main/domain/envelope')>(); return { ...real, writeEnvelopeAtomic: vi.fn(real.writeEnvelopeAtomic) } })
let root: string, registry: WorkspaceRegistry
beforeEach(async () => {
  vi.mocked(envelopes.writeEnvelopeAtomic).mockImplementation((await vi.importActual<typeof envelopes>('../../src/main/domain/envelope')).writeEnvelopeAtomic)
  vi.mocked(fs.renameSync).mockImplementation((await vi.importActual<typeof fs>('node:fs')).renameSync)
  vi.useFakeTimers(); root = fs.mkdtempSync(join(process.cwd(), 'tests/domain/.transactions-')); registry = new WorkspaceRegistry(join(root, 'workspaces')) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }) })
const note = { kind: 'note' as const, floorId: null, name: 'Keep', content: 'keep', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
async function failSidebarOnce() {
  const real = await vi.importActual<typeof envelopes>('../../src/main/domain/envelope')
  vi.mocked(envelopes.writeEnvelopeAtomic).mockImplementationOnce((file, ...args) => { if (file === join(root, 'sidebar.json')) throw new Error('disk failed'); real.writeEnvelopeAtomic(file, ...args) })
}
it('keeps main active state and observers unchanged when switching cannot be persisted', async () => {
  const a = registry.activeId(), b = registry.create('B'), observed = vi.fn()
  registry.onSidebar(observed); await failSidebarOnce()
  expect(() => registry.switch(b)).toThrow('disk failed')
  expect(registry.activeId()).toBe(a)
  expect(observed).not.toHaveBeenCalled()
  registry.active().addNode(note)
  expect(Object.values(registry.get(b).get().nodes)).toEqual([])
})
it('keeps the workspace registered if archival rename fails', () => {
  const a = registry.activeId(); registry.create('B'); registry.get(a).addNode(note); registry.get(a).flush()
  const file = join(root, 'workspaces', a + '.json')
  vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('rename failed') })
  expect(() => registry.remove(a)).toThrow()
  expect(registry.activeId()).toBe(a)
  expect(registry.get(a).get().nodes).not.toEqual({})
  expect(fs.existsSync(file)).toBe(true)
})
it('rolls back archive and in-memory removal when sidebar persistence fails', async () => {
  const a = registry.activeId(); registry.create('B'); const store = registry.get(a); const id = store.addNode(note); store.flush()
  const real = await vi.importActual<typeof envelopes>('../../src/main/domain/envelope')
  vi.mocked(envelopes.writeEnvelopeAtomic).mockImplementation((file, ...args) => { if (file === join(root, 'sidebar.json')) throw new Error('sidebar failed'); real.writeEnvelopeAtomic(file, ...args) })
  expect(() => registry.remove(a)).toThrow('sidebar failed')
  expect(registry.activeId()).toBe(a)
  expect(registry.get(a).hasNode(id)).toBe(true)
  expect(fs.existsSync(join(root, 'workspaces', a + '.json'))).toBe(true)
})
it('recovers a crash between archive rename and sidebar removal without creating an empty workspace', () => {
  const a = registry.activeId(); registry.create('B'); const id = registry.get(a).addNode(note); registry.get(a).flush()
  const file = join(root, 'workspaces', a + '.json')
  fs.renameSync(file, file + '.removido-2026-11-24T10-00-00-000Z')
  const reopened = new WorkspaceRegistry(join(root, 'workspaces'))
  expect(reopened.get(a).hasNode(id)).toBe(true)
  expect(fs.existsSync(file)).toBe(true)
})
it('dispose cancels deferred writes/retries and prevents subsequent writes from a retained store reference', () => {
  const file = join(root, 'disposed.json'), store = new WorkspaceStore(file)
  vi.mocked(envelopes.writeEnvelopeAtomic).mockImplementationOnce(() => { throw new Error('one failure') })
  store.addNode(note); vi.advanceTimersByTime(300)
  expect(store.warning).toBeTruthy()
  store.dispose(); store.flush(); vi.advanceTimersByTime(60000)
  expect(fs.existsSync(file)).toBe(false)
  expect(() => store.addNode(note)).toThrow()
})
it('refuses failed flush before removal, then removes without leaving a retry or resurrecting the file', () => {
  const a = registry.activeId(); registry.create('B'); registry.get(a).addNode(note)
  vi.mocked(envelopes.writeEnvelopeAtomic).mockImplementationOnce(() => { throw new Error('one failure') })
  expect(() => registry.remove(a)).toThrow()
  expect(registry.get(a)).toBeDefined()
  registry.remove(a); vi.advanceTimersByTime(60000)
  expect(fs.existsSync(join(root, 'workspaces', a + '.json'))).toBe(false)
  expect(new WorkspaceRegistry(join(root, 'workspaces')).list().some(w => w.id === a)).toBe(false)
})
it('rejects unsafe sidebar ids before opening or quarantining paths outside workspaces', () => {
  const outside = join(root, 'outside.json'); fs.writeFileSync(outside, 'unrelated fixture')
  envelopes.writeEnvelopeAtomic(join(root, 'sidebar.json'), 'sidebar', 1, { spaces: [], workspaces: [{ id: '../outside', name: 'Unsafe', spaceId: null }], order: ['../outside'], active: '../outside' })
  expect(() => new WorkspaceRegistry(join(root, 'workspaces'))).not.toThrow()
  expect(fs.readFileSync(outside, 'utf8')).toBe('unrelated fixture')
  expect(fs.readdirSync(root).some(n => n.startsWith('outside.json.corrompido'))).toBe(false)
})
it('preserves future sidebar bytes through startup and rejects mutations', () => {
  const file = join(root, 'sidebar.json')
  envelopes.writeEnvelopeAtomic(file, 'sidebar', 3, { ...registry.sidebar(), extra: { keep: true } })
  const before = fs.readFileSync(file, 'utf8'), reopened = new WorkspaceRegistry(join(root, 'workspaces'))
  expect(fs.readFileSync(file, 'utf8')).toBe(before)
  expect(reopened.warning).toMatch(/futura|leitura/)
  expect(() => reopened.createSpace('No')).toThrow(/leitura/)
  expect(() => reopened.create('No')).toThrow(/leitura/)
  expect(fs.readFileSync(file, 'utf8')).toBe(before)
})
