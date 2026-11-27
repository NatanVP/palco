import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
let dir: string
beforeEach(() => { vi.useFakeTimers(); dir = mkdtempSync(join(process.cwd(), 'tests/domain/.recovery-')) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) })
it.each(['', '{', 'null', JSON.stringify({ type: 'workspace', schemaVersion: 1, payload: null }), JSON.stringify({ type: 'workspace', schemaVersion: 1, payload: { id: 'x' } })])('quarantines invalid workspace and exposes warning: %j', raw => {
  const file = join(dir, 'workspace.json')
  writeFileSync(file, raw)
  writeFileSync(file + '.bak', 'last good backup')
  const store = new WorkspaceStore(file)
  expect(store.get().nodes).toEqual({})
  expect(store.warning).toBeTruthy()
  const quarantine = readdirSync(dir).find(name => name.startsWith('workspace.json.corrompido-'))
  expect(quarantine).toBeTruthy()
  expect(readFileSync(join(dir, quarantine!), 'utf8')).toBe(raw)
  store.flush()
  expect(readFileSync(file + '.bak', 'utf8')).toBe('last good backup')
})
it('quarantines a terminal whose agent is an array rather than an enum string', () => {
  const file = join(dir, 'workspace.json')
  const workspace = new WorkspaceStore(file).get()
  const invalid = { id: 'bad', kind: 'terminal', name: 'Bad', agent: ['codex'], command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
  writeFileSync(file, JSON.stringify({ type: 'workspace', schemaVersion: 1, payload: { ...workspace, nodes: { bad: invalid } } }))
  const recovered = new WorkspaceStore(file)
  expect(recovered.get().nodes).toEqual({})
  expect(recovered.warning).toMatch(/corrompido/)
  expect(readdirSync(dir).some(name => name.startsWith('workspace.json.corrompido-'))).toBe(true)
})
