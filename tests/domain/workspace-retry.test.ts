import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import * as envelope from '../../src/main/domain/envelope'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
vi.mock('../../src/main/domain/envelope', async original => {
  const real = await original<typeof import('../../src/main/domain/envelope')>()
  return { ...real, writeEnvelopeAtomic: vi.fn(real.writeEnvelopeAtomic) }
})
it('captures deferred failures, backs off to 30 seconds, and clears saving warning on recovery', () => {
  vi.useFakeTimers()
  const dir = mkdtempSync(join(process.cwd(), 'tests/domain/.retry-'))
  const writer = vi.mocked(envelope.writeEnvelopeAtomic)
  try {
    writer.mockImplementation(() => { throw Object.assign(new Error('private contents'), { code: 'ENOSPC' }) })
    const store = new WorkspaceStore(join(dir, 'workspace.json'))
    store.setCamera({ offset: { x: 5, y: 0 }, zoom: 1 })
    expect(() => vi.advanceTimersByTime(300)).not.toThrow()
    expect(store.warning).toContain('ENOSPC')
    expect(store.warning).not.toContain('private contents')
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const calls = writer.mock.calls.length
      vi.advanceTimersByTime(delay - 1)
      expect(writer).toHaveBeenCalledTimes(calls)
      vi.advanceTimersByTime(1)
      expect(writer).toHaveBeenCalledTimes(calls + 1)
      expect(vi.getTimerCount()).toBe(1)
    }
    writer.mockImplementation(() => {})
    vi.advanceTimersByTime(30000)
    expect(store.warning).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})
