import { randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { validWorkspaceId } from './domain/workspace-id'

/** Teto do icon.png (o renderer já manda 128×128, bem menor). */
export const MAX_ICON_BYTES = 4 * 1024 * 1024
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const FILE = 'icon.png'
const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_DIRECTORY, O_NONBLOCK } = constants

/**
 * Pontos de injeção para os testes de troca concorrente (substituir a pasta ou o arquivo por um link
 * entre a abertura e o uso). Fora dos testes ficam vazios.
 */
export const iconTestHooks: { afterAnchor?: () => void; afterOpen?: () => void } = {}

/**
 * No Linux, `/proc/self/fd/<fd>/<nome>` resolve `<nome>` dentro do diretório que o descritor já tem aberto:
 * renomear a pasta ou pôr um link no lugar dela depois da abertura não muda o alvo. Sem `/proc`
 * (outros sistemas), cai no caminho por nome e confere o inode do descritor antes de cada operação.
 */
const PROC_FD = '/proc/self/fd'
const anchored = existsSync(PROC_FD)

const isPng = (bytes: Uint8Array): boolean => bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)
const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code

function assertId(id: string): void {
  if (!validWorkspaceId(id)) throw new Error('id de workspace inválido')
}

/** Pasta do workspace aberta por descritor, com o caminho que resolve DENTRO dela. */
interface Anchor { fd: number; path(name: string): string }

/**
 * Abre `<dir>/<id>` sem seguir link (O_NOFOLLOW | O_DIRECTORY); cria antes, se pedido.
 * `undefined` quando a pasta não existe e não é para criar. Link ou não-pasta: erro.
 */
function anchor(dir: string, id: string, create: boolean): Anchor | undefined {
  const root = openSync(dir, O_RDONLY | O_DIRECTORY)
  let fd: number
  try {
    const name = anchored ? `${PROC_FD}/${root}/${id}` : join(dir, id)
    if (create) {
      try { mkdirSync(name, { mode: 0o700 }) } catch (error) { if (code(error) !== 'EEXIST') throw error }
    }
    try {
      fd = openSync(name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    } catch (error) {
      if (code(error) === 'ENOENT' && !create) return undefined
      if (code(error) === 'ELOOP' || code(error) === 'ENOTDIR') throw new Error('a pasta do workspace é um link simbólico ou não é pasta: recusado')
      throw error
    }
  } finally {
    closeSync(root)
  }
  iconTestHooks.afterAnchor?.()
  if (anchored) return { fd, path: (name) => `${PROC_FD}/${fd}/${name}` }
  // Sem /proc: o nome precisa continuar apontando para a mesma pasta aberta.
  const base = join(dir, id)
  return {
    fd,
    path: (name) => {
      const now = lstatSync(base), held = fstatSync(fd)
      if (now.isSymbolicLink() || now.ino !== held.ino || now.dev !== held.dev) throw new Error('a pasta do workspace mudou durante a operação: recusado')
      return join(base, name)
    }
  }
}

function lstatOrNone(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path) } catch (error) {
    if (code(error) === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Grava `<dir>/<id>/icon.png`: temporário criado com O_EXCL | O_NOFOLLOW (0600) dentro da pasta aberta,
 * fsync, rename no lugar e fsync da pasta pelo descritor. Até 4 MiB, só PNG (assinatura), nunca por link.
 */
export function saveWorkspaceIcon(dir: string, id: string, bytes: Uint8Array): void {
  assertId(id)
  if (!(bytes instanceof Uint8Array)) throw new Error('imagem inválida')
  if (bytes.length > MAX_ICON_BYTES) throw new Error('imagem maior que 4 MiB')
  if (!isPng(bytes)) throw new Error('a imagem precisa ser PNG')
  const folder = anchor(dir, id, true)!
  let temporary: string | undefined
  try {
    const target = folder.path(FILE)
    if (lstatOrNone(target)?.isSymbolicLink()) throw new Error('icon.png é um link simbólico: recusado')
    temporary = folder.path(`.${FILE}.${randomUUID()}.tmp`)
    const fd = openSync(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    try {
      for (let at = 0; at < bytes.length;) at += writeSync(fd, bytes, at, bytes.length - at)
      fsyncSync(fd)
    } finally { closeSync(fd) }
    // rename troca a entrada: se um link aparecer no lugar de icon.png, é o link que some (o alvo fica intacto).
    renameSync(temporary, folder.path(FILE))
    temporary = undefined
    fsyncSync(folder.fd)
  } finally {
    if (temporary) rmSync(temporary, { force: true })
    closeSync(folder.fd)
  }
}

/**
 * `data:image/png;base64,…` do ícone, ou `null` (sem ícone, link, não-arquivo, mais de 4 MiB ou não PNG).
 * Abre com O_NOFOLLOW, confere tipo e tamanho por fstat do MESMO descritor e lê no máximo 4 MiB + 1 por ele.
 */
export function loadWorkspaceIcon(dir: string, id: string): string | null {
  if (!validWorkspaceId(id)) return null
  let folder: Anchor | undefined
  let fd: number | undefined
  try {
    folder = anchor(dir, id, false)
    if (!folder) return null
    fd = openSync(folder.path(FILE), O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    const st = fstatSync(fd)
    if (!st.isFile() || st.size > MAX_ICON_BYTES) return null
    iconTestHooks.afterOpen?.()
    const buffer = Buffer.alloc(MAX_ICON_BYTES + 1)
    let total = 0
    for (;;) {
      const n = readSync(fd, buffer, total, buffer.length - total, null)
      if (n === 0) break
      total += n
      if (total > MAX_ICON_BYTES) return null
    }
    const bytes = buffer.subarray(0, total)
    return isPng(bytes) ? `data:image/png;base64,${bytes.toString('base64')}` : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (folder) closeSync(folder.fd)
  }
}

/** Tira o icon.png (se houver) da pasta aberta; unlink não segue link (se houver um, só ele some). A pasta fica. */
export function deleteWorkspaceIcon(dir: string, id: string): void {
  assertId(id)
  const folder = anchor(dir, id, false)
  if (!folder) return
  try {
    try { unlinkSync(folder.path(FILE)) } catch (error) { if (code(error) !== 'ENOENT') throw error }
    fsyncSync(folder.fd)
  } finally {
    closeSync(folder.fd)
  }
}
