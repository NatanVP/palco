import { constants, openSync, closeSync, fstatSync, readSync, writeSync, realpathSync, unlinkSync } from 'node:fs'

/** Keep the file open from identity/type checks through the last read. No path-based second open. */
export function openVerifiedFile(path: string, maxBytes: number): { fd: number; path: string; size: number; close(): void } {
  const real = realpathSync(path)
  const fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const actual = realpathSync(`/proc/self/fd/${fd}`), st = fstatSync(fd)
    if (actual !== real || !st.isFile()) throw new Error('O arquivo mudou ou não é um arquivo comum.')
    if (st.size < 1 || st.size > maxBytes) throw new Error(`Arquivo vazio ou acima do limite de ${maxBytes} bytes.`)
    let closed = false
    return { fd, path: actual, size: st.size, close: () => { if (!closed) { closed = true; closeSync(fd) } } }
  } catch (error) { closeSync(fd); throw error }
}

export function readFdBounded(fd: number, maxBytes: number): Buffer {
  const chunks: Buffer[] = [], buffer = Buffer.alloc(65536)
  let offset = 0
  for (;;) {
    const n = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes - offset + 1), offset)
    if (!n) break
    offset += n
    if (offset > maxBytes) throw new Error('O arquivo cresceu além do limite.')
    chunks.push(Buffer.from(buffer.subarray(0, n)))
  }
  return Buffer.concat(chunks)
}

/** Exclusive destination; source inode stays pinned even if its original name/parents are replaced. */
export function copyFdExclusive(fd: number, target: string, maxBytes: number): number {
  const before = fstatSync(fd)
  if (!before.isFile() || before.size < 1 || before.size > maxBytes) throw new Error('Arquivo inválido ou acima do limite.')
  const out = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  let good = false, offset = 0
  try {
    const buffer = Buffer.alloc(65536)
    for (;;) {
      const n = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes - offset + 1), offset)
      if (!n) break
      if (offset + n > maxBytes) throw new Error('O arquivo cresceu além do limite.')
      let sent = 0
      while (sent < n) sent += writeSync(out, buffer, sent, n - sent)
      offset += n
    }
    const after = fstatSync(fd)
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error('O arquivo foi alterado durante a cópia.')
    }
    good = true
    return offset
  } finally {
    closeSync(out)
    if (!good) {
      try { unlinkSync(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
}
