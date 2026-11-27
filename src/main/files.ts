import { mkdir, open, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'

/** Limites de leitura de arquivos pelo processo principal, sem escrita. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_TEXT_LINES = 400
export const MAX_DIR_ENTRIES = 500

export type FileContent = { kind: 'text' | 'image' | 'binary'; data: string; truncated: boolean }

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif', '.svg': 'image/svg+xml'
}

function absolute(path: unknown): string {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('o caminho precisa ser absoluto')
  return path
}

/**
 * Conteúdo de um arquivo para o nó "arquivo": imagem como `data:` URL, texto
 * com as primeiras 400 linhas, binário sem dados. Acima de 2 MB nada é lido.
 */
export async function readFileForNode(path: string): Promise<FileContent> {
  const file = absolute(path)
  const info = await stat(file)
  if (!info.isFile()) throw new Error('não é um arquivo')
  const mime = IMAGE_MIME[extname(file).toLowerCase()]
  const kind = mime ? 'image' : 'text'
  if (info.size > MAX_FILE_BYTES) return { kind, data: '', truncated: true }
  const handle = await open(file, 'r')
  let bytes: Buffer
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error('não é um arquivo')
    if (opened.size > MAX_FILE_BYTES) return { kind, data: '', truncated: true }
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - total))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > MAX_FILE_BYTES) return { kind, data: '', truncated: true }
      chunks.push(buffer.subarray(0, bytesRead))
    }
    bytes = Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
  if (mime) return { kind: 'image', data: `data:${mime};base64,${bytes.toString('base64')}`, truncated: false }
  if (bytes.subarray(0, 8192).includes(0)) return { kind: 'binary', data: '', truncated: false }
  const lines = bytes.toString('utf8').split('\n')
  if (lines.length <= MAX_TEXT_LINES) return { kind: 'text', data: lines.join('\n'), truncated: false }
  return { kind: 'text', data: lines.slice(0, MAX_TEXT_LINES).join('\n'), truncated: true }
}

/** Entradas de um diretório (pastas primeiro), no máximo 500. Links para pasta contam como pasta. */
export async function listDir(dir: string): Promise<Array<{ name: string; dir: boolean }>> {
  const root = absolute(dir)
  const entries = await readdir(root, { withFileTypes: true })
  const list = await Promise.all(entries.map(async (e) => {
    let isDir = e.isDirectory()
    if (e.isSymbolicLink()) {
      try { isDir = (await stat(join(root, e.name))).isDirectory() } catch { isDir = false }
    }
    return { name: e.name, dir: isDir }
  }))
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  return [...list.filter((e) => e.dir).sort(byName), ...list.filter((e) => !e.dir).sort(byName)].slice(0, MAX_DIR_ENTRIES)
}

/** `~` e `~/…` viram a pasta pessoal; o resto fica como está. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  return path.startsWith('~/') ? join(home, path.slice(2)) : path
}

/** Existe e é uma pasta? */
export async function pathExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

/** Caminho real do ancestral existente mais próximo (resolve symlinks), mais o resto que ainda não existe. */
async function realAncestor(path: string): Promise<{ real: string; rest: string[] }> {
  const rest: string[] = []
  let current = resolve(path)
  for (;;) {
    try {
      return { real: await realpath(current), rest }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // Só "não existe" sobe um nível; qualquer outro erro (permissão, laço de links) aborta.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      rest.unshift(basename(current))
      current = parent
    }
  }
}

const within = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/**
 * O caminho cai fora da pasta pessoal depois de seguir os symlinks? Compara o caminho real do
 * ancestral existente mais próximo com o caminho real da home (que também pode ser um link).
 */
export async function outsideHome(path: string, home: string): Promise<boolean> {
  const realHome = await realpath(resolve(home)).catch(() => resolve(home))
  const { real } = await realAncestor(absolute(path))
  return !within(real, realHome)
}

/**
 * Cria a pasta (com as intermediárias) para o terminal novo. Fora da pasta pessoal, seguindo os
 * symlinks, só com `outsideHome: true`, que o renderer manda depois de uma segunda confirmação.
 * Cria a partir do caminho real resolvido: um link trocado depois da conferência não redireciona a criação
 * para fora sem que a conferência a pegue de novo.
 */
export async function makeDirectory(path: string, opts: { home: string; outsideHome?: boolean }): Promise<void> {
  const target = absolute(path)
  const realHome = await realpath(resolve(opts.home)).catch(() => resolve(opts.home))
  const { real, rest } = await realAncestor(target)
  if (!within(real, realHome) && opts.outsideHome !== true) throw new Error('pasta fora da pasta pessoal: confirme para criar')
  await mkdir(join(real, ...rest), { recursive: true })
  // Conferência final: o que foi criado (ou já existia) está onde a decisão foi tomada.
  const created = await realpath(join(real, ...rest))
  if (!within(created, realHome) && opts.outsideHome !== true) throw new Error('pasta fora da pasta pessoal: confirme para criar')
}
