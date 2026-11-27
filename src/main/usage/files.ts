import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Arquivos com a extensão dada sob `dir` (recursivo), do mais recente para o mais antigo. */
export async function recentFiles(dir: string, ext: string, limit = 50): Promise<Array<{ path: string; mtimeMs: number }>> {
  const found: Array<{ path: string; mtimeMs: number }> = []
  const walk = async (d: string, depth: number): Promise<void> => {
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory() && depth < 4) await walk(p, depth + 1)
      else if (e.isFile() && e.name.endsWith(ext)) {
        try { found.push({ path: p, mtimeMs: (await stat(p)).mtimeMs }) } catch { /* sumiu */ }
      }
    }
  }
  await walk(dir, 0)
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
}

/** Últimos `bytes` de um arquivo como texto (sem carregar o arquivo inteiro). */
export async function readTail(path: string, bytes: number): Promise<string> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    const text = buf.toString('utf8')
    // Começou no meio de uma linha: descarta o pedaço.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await fh.close()
  }
}

/** Janela cujo horário de renovação já passou: a leitura é anterior à renovação, então o uso atual é ~0. */
export function freshWindow(usedPercent: number, resetsAt: string | null, now = Date.now()): { usedPercent: number; resetsAt: string | null } {
  return resetsAt !== null && Date.parse(resetsAt) <= now ? { usedPercent: 0, resetsAt: null } : { usedPercent, resetsAt }
}

/** Epoch em segundos → ISO (ou null). */
export const epochIso = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) ? new Date(v * 1000).toISOString() : null)
