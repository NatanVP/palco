import { constants } from 'node:fs'
import { lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeSync, closeSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Kill = (pid: number, signal: 0) => unknown
type SocketStat = Pick<Stats, 'uid' | 'mode' | 'isSymbolicLink' | 'isDirectory'>
type Lstat = (path: string) => SocketStat
const lstat: Lstat = path => lstatSync(path)

/** Arquivo que o próprio app grava no diretório privado do socket. */
export const OWNER_MARKER = '.palco-owner'
const SOCKET_NAME = 'palco.sock'
const KNOWN = new Set([OWNER_MARKER, SOCKET_NAME])

/** Vivo = existe (ou é de outro usuário). Só ESRCH prova que o processo acabou. */
export function isPidAlive(pid: number, kill: Kill = process.kill): boolean {
  try {
    kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** Valida o diretório sem seguir links: precisa ser privado e pertencer ao usuário atual. */
export function assertPrivateSocketDirectory(dir: string, uid = process.getuid?.(), inspect: Lstat = lstat): void {
  if (uid === undefined) throw new Error('não foi possível determinar o uid para proteger o socket Unix')
  const st = inspect(dir)
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('o diretório do socket não é um diretório real')
  if (st.uid !== uid) throw new Error('o diretório do socket pertence a outro uid')
  if ((st.mode & 0o700) !== 0o700) throw new Error('o diretório do socket não é acessível pelo usuário atual')
  if ((st.mode & 0o077) !== 0) throw new Error('o diretório do socket permite acesso a grupo ou outros')
}

function assertSafeSocketParent(dir: string, uid: number): void {
  const st = lstatSync(dir)
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('a pasta temporária do socket não é um diretório real')
  const mode = st.mode & 0o7777
  const ownedPrivate = st.uid === uid && (mode & 0o077) === 0
  const stickySharedTemp = st.uid === 0 && (mode & 0o1000) !== 0 && (mode & 0o022) === 0o022
  if (!ownedPrivate && !stickySharedTemp) throw new Error('a pasta temporária do socket não é protegida')
}

function privateTemporaryDirectory(pid: number, uid: number, tempRoot: string): string {
  assertSafeSocketParent(tempRoot, uid)
  const dir = mkdtempSync(join(tempRoot, `palco-${pid}-`))
  try {
    assertPrivateSocketDirectory(dir, uid)
    return dir
  } catch (error) {
    throw new Error(`não foi possível preparar um diretório privado para o socket: ${(error as Error).message}`)
  }
}

/** Cria o caminho estável no runtime dir confiável; em colisão/insegurança, usa um nome aleatório privado. */
export function createSocketDirectory(runtimeDir: string | undefined, pid: number, uid = process.getuid?.(), tempRoot = tmpdir()): string {
  if (uid === undefined) throw new Error('não foi possível determinar o uid para proteger o socket Unix')
  if (!runtimeDir) return privateTemporaryDirectory(pid, uid, tempRoot)

  try { assertPrivateSocketDirectory(runtimeDir, uid) } catch { return privateTemporaryDirectory(pid, uid, tempRoot) }

  const candidate = join(runtimeDir, `palco-${pid}`)
  try {
    mkdirSync(candidate, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return privateTemporaryDirectory(pid, uid, tempRoot)
    // Um caminho preexistente nunca é reutilizado, mesmo se parecer privado: pode conter marcador antigo ou sofrer corrida.
    try { assertPrivateSocketDirectory(candidate, uid) } catch { /* o fallback aleatório continua seguro */ }
    return privateTemporaryDirectory(pid, uid, tempRoot)
  }
  try {
    assertPrivateSocketDirectory(candidate, uid)
    return candidate
  } catch (error) {
    throw new Error(`não foi possível proteger o diretório do socket: ${(error as Error).message}`)
  }
}

/** Cria o marcador sem seguir links e sem truncar arquivo preexistente. */
export function markOwned(dir: string, pid: number): void {
  assertPrivateSocketDirectory(dir)
  const nofollow = constants.O_NOFOLLOW
  if (typeof nofollow !== 'number') throw new Error('O sistema não oferece O_NOFOLLOW para proteger o marcador do socket')
  const marker = join(dir, OWNER_MARKER)
  const fd = openSync(marker, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | nofollow, 0o600)
  try { writeSync(fd, `${pid}\n`) } finally { closeSync(fd) }
}

function removableOwnedDirectory(path: string, pid: number, uid: number | undefined): boolean {
  try {
    const st = lstatSync(path)
    if (!st.isDirectory() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o077) !== 0) return false
    const entries = readdirSync(path)
    if (!entries.includes(OWNER_MARKER) || entries.some(entry => !KNOWN.has(entry))) return false
    const markerPath = join(path, OWNER_MARKER), marker = lstatSync(markerPath)
    if (!marker.isFile() || (uid !== undefined && marker.uid !== uid) || (marker.mode & 0o077) !== 0) return false
    return readFileSync(markerPath, 'utf8').trim() === String(pid)
  } catch {
    return false
  }
}

/** Remove somente um diretório privado, real, do uid atual e marcado para o pid indicado. */
export function removeOwnedSocketDirectory(path: string, pid: number, uid = process.getuid?.()): boolean {
  if (uid === undefined) return false
  if (!removableOwnedDirectory(path, pid, uid)) return false
  try {
    for (const entry of readdirSync(path)) unlinkSync(join(path, entry))
    rmdirSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Remove diretórios de execuções encerradas, identificados pelo pid estável ou pelo sufixo aleatório do fallback.
 * Qualquer dúvida sobre uid, permissões, marcador ou conteúdo preserva o diretório.
 */
export function cleanStaleSocketDirs(
  dir: string,
  currentPid: number,
  alive: (pid: number) => boolean = isPidAlive,
  uid: number | undefined = process.getuid?.()
): string[] {
  if (uid === undefined) return []
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const removed: string[] = []
  for (const name of names) {
    const match = /^palco-(\d+)(?:-[A-Za-z0-9]{6})?$/.exec(name)
    if (!match) continue
    const pid = Number(match[1])
    if (pid === currentPid || alive(pid)) continue
    const path = join(dir, name)
    if (removeOwnedSocketDirectory(path, pid, uid)) removed.push(path)
  }
  return removed
}
