import { appendFile, open } from 'node:fs/promises'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileForNode } from '../../src/main/files'
vi.mock('node:fs/promises', async original => { const real = await original<typeof import('node:fs/promises')>(); return { ...real, open: vi.fn(real.open) } })
it('reads growth after stat through EOF and handles short reads rather than claiming a prefix is complete', async () => {
  const dir = mkdtempSync(join(process.cwd(), 'tests/main/.file-race-')), file = join(dir, 'growing.txt')
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  try {
    writeFileSync(file, '0123456789')
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await real.open(...args), read = handle.read.bind(handle)
      await appendFile(file, 'x'.repeat(1000))
      handle.read = ((buffer: Buffer, offset: number, length: number, position: number) => read(buffer, offset, Math.min(3, length), position)) as typeof handle.read
      return handle
    })
    expect(await readFileForNode(file)).toEqual({ kind: 'text', data: '0123456789' + 'x'.repeat(1000), truncated: false })
  } finally { vi.mocked(open).mockImplementation(real.open); rmSync(dir, { recursive: true, force: true }) }
})
