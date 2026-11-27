import { pinEntry, operatePinned } from './pinned-file-ops'
import { openVerifiedFile, copyFdExclusive, readFdBounded } from './secure-files'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'

export const MAX_ATTACHMENT_BYTES = 500 * 1024 * 1024
const NAME_MAX = 255
/** The injected callback is for tests/adapters; it receives the pinned leaf, not a re-resolved user path. */
export async function trashEntry(path: string, home: string, trash?: (path: string) => Promise<void>): Promise<void> {
  const entry = pinEntry(path, home)
  try {
    if (trash) await trash(entry.pinned)
    else await operatePinned(entry, 'trash', entry.original)
  } finally { entry.close() }
}

export async function renameEntry(path: string, newName: string, home: string, commit: typeof operatePinned = operatePinned): Promise<string> {
  const name = typeof newName === 'string' ? newName.trim() : ''
  if (!name || name === '.' || name === '..' || /[\\/\0-\x1f\x7f]/.test(name) || Buffer.byteLength(name) > NAME_MAX) throw new Error('nome inválido')
  const entry = pinEntry(path, home)
  try {
    // Friendly early error only: RENAME_NOREPLACE at commit is the atomic security boundary.
    try {
      await lstat(`/proc/self/fd/${entry.parentFd}/${name}`)
      throw new Error('já existe um arquivo com esse nome')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await commit(entry, 'rename', name)
    return join(dirname(entry.original), name)
  } finally { entry.close() }
}

const safeName = (name: string): string => basename(name).replace(/[\\/:*?"<>|\0-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'arquivo'

/** "Sempre copiar arquivos para o espaço de trabalho": copia para a pasta de anexos do palco e devolve o caminho da cópia. */
export async function storeAttachment(source: string, storeDir: string, newId: () => string = randomUUID): Promise<string> {
  if (typeof source !== 'string' || !isAbsolute(source) || source.includes('\0')) throw new Error('o caminho precisa ser absoluto')
  const opened = openVerifiedFile(source, MAX_ATTACHMENT_BYTES)
  try {
    await mkdir(storeDir, { recursive: true, mode: 0o700 })
    const id = newId()
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Identificador inválido.')
    const target = join(storeDir, `${id}-${safeName(source)}`)
    copyFdExclusive(opened.fd, target, MAX_ATTACHMENT_BYTES)
    return target
  } finally { opened.close() }
}

const TEXT_NOTE_EXT = /\.(md|markdown|txt)$/i
export const MAX_NOTE_FILE_BYTES = 256 * 1024
/** O que um caminho solto na tela é: pasta, arquivo (com `note: true` se é um texto que vira nota) ou nada. */
export async function pathKind(path: string): Promise<{ kind: 'dir' | 'file'; note: boolean } | null> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) return null
  try {
    const info = await stat(path)
    if (info.isDirectory()) return { kind: 'dir', note: false }
    return info.isFile() ? { kind: 'file', note: TEXT_NOTE_EXT.test(path) && info.size > 0 && info.size <= MAX_NOTE_FILE_BYTES } : null
  } catch { return null }
}
/** Texto de um .md/.txt pequeno para virar o conteúdo de uma nota; null se não der (grande, binário). */
export async function readNoteText(path: string): Promise<string | null> {
  if (typeof path !== 'string' || !TEXT_NOTE_EXT.test(path) || !isAbsolute(path) || path.includes('\0')) return null
  let opened: ReturnType<typeof openVerifiedFile> | undefined
  try {
    opened = openVerifiedFile(path, MAX_NOTE_FILE_BYTES)
    const buf = readFdBounded(opened.fd, MAX_NOTE_FILE_BYTES)
    // Como a nota ligada regrava o arquivo, só entra texto que sobrevive à volta: UTF-8 válido.
    return buf.subarray(0, 8192).includes(0) ? null : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf)
  } catch { return null } finally { opened?.close() }
}
