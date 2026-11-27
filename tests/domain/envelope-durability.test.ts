import * as fs from 'node:fs'
import { join } from 'node:path'
import { writeEnvelopeAtomic, readEnvelope } from '../../src/main/domain/envelope'
vi.mock('node:fs', async original => {
  const real = await original<typeof import('node:fs')>()
  return { ...real, fsyncSync: vi.fn(real.fsyncSync), renameSync: vi.fn(real.renameSync) }
})
let dir: string
beforeEach(() => { dir = fs.mkdtempSync(join(process.cwd(), 'tests/domain/.durable-')); vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }) })
it('fsyncs the file before rename and its directory after rename', () => {
  const file = join(dir, 'workspace.json')
  writeEnvelopeAtomic(file, 'workspace', 1, { good: true })
  const syncs = vi.mocked(fs.fsyncSync).mock.invocationCallOrder
  const rename = vi.mocked(fs.renameSync).mock.invocationCallOrder[0]!
  expect(syncs.some(order => order < rename)).toBe(true)
  expect(syncs.some(order => order > rename)).toBe(true)
})
it('retains the previous good envelope as backup', () => {
  const file = join(dir, 'workspace.json')
  writeEnvelopeAtomic(file, 'workspace', 1, { generation: 1 })
  writeEnvelopeAtomic(file, 'workspace', 1, { generation: 2 })
  expect(readEnvelope(file + '.bak', 'workspace', 1).payload).toEqual({ generation: 1 })
})
it('keeps the primary intact and removes its temporary file when file fsync fails', () => {
  const file = join(dir, 'workspace.json')
  writeEnvelopeAtomic(file, 'workspace', 1, { generation: 1 })
  vi.mocked(fs.fsyncSync).mockImplementationOnce(() => { throw new Error('sync failed') })
  expect(() => writeEnvelopeAtomic(file, 'workspace', 1, { generation: 2 })).toThrow('sync failed')
  expect(readEnvelope(file, 'workspace', 1).payload).toEqual({ generation: 1 })
  expect(fs.readdirSync(dir).some(name => name.endsWith('.tmp'))).toBe(false)
})
it('does not rotate the previous-good backup on a redundant flush', () => {
  const file = join(dir, 'workspace.json')
  writeEnvelopeAtomic(file, 'workspace', 1, { generation: 1 })
  writeEnvelopeAtomic(file, 'workspace', 1, { generation: 2 })
  writeEnvelopeAtomic(file, 'workspace', 1, { generation: 2 })
  expect(readEnvelope(file + '.bak', 'workspace', 1).payload).toEqual({ generation: 1 })
})
it('retries directory synchronization after primary rename without rotating the backup', async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs')
  const file = join(dir, 'workspace.json')
  writeEnvelopeAtomic(file, 'workspace', 1, { generation: 1 })
  let count = 0
  vi.mocked(fs.fsyncSync).mockImplementation(fd => {
    if (++count === 4) throw new Error('directory sync failed')
    real.fsyncSync(fd)
  })
  expect(() => writeEnvelopeAtomic(file, 'workspace', 1, { generation: 2 })).toThrow('directory sync failed')
  expect(readEnvelope(file, 'workspace', 1).payload).toEqual({ generation: 2 })
  vi.mocked(fs.fsyncSync).mockImplementation(real.fsyncSync)
  vi.mocked(fs.fsyncSync).mockClear()
  vi.mocked(fs.renameSync).mockClear()
  writeEnvelopeAtomic(file, 'workspace', 1, { generation: 2 })
  expect(readEnvelope(file + '.bak', 'workspace', 1).payload).toEqual({ generation: 1 })
  expect(fs.renameSync).not.toHaveBeenCalled()
  expect(fs.fsyncSync).toHaveBeenCalledTimes(2)
})
