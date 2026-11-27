import { lstatSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Kill = (pid: number, signal: 0) => unknown

/** Arquivo que o próprio app grava no diretório do socket: prova de propriedade para a limpeza. */
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

/** Marca o diretório como criado por este processo (conteúdo: o pid). */
export function markOwned(dir: string, pid: number): void {
  writeFileSync(join(dir, OWNER_MARKER), `${pid}\n`, { mode: 0o600 })
}

/**
 * Remove `<dir>/palco-<pid>` de execuções que morreram sem limpar o socket, e só quando há prova de que é nosso:
 * diretório real (não link), do mesmo uid, com marcador regular contendo o pid do nome e nada além do socket e do marcador.
 * Qualquer dúvida preserva o diretório. Nunca toca no pid atual.
 */
export function cleanStaleSocketDirs(
  dir: string,
  currentPid: number,
  alive: (pid: number) => boolean = isPidAlive,
  uid: number | undefined = process.getuid?.()
): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    const match = /^palco-(\d+)$/.exec(name)
    if (!match) continue
    const pid = Number(match[1])
    if (pid === currentPid || alive(pid)) continue
    const path = join(dir, name)
    try {
      const st = lstatSync(path)
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue
      const entries = readdirSync(path)
      if (entries.some((entry) => !KNOWN.has(entry))) continue
      const marker = lstatSync(join(path, OWNER_MARKER))
      if (!marker.isFile() || (uid !== undefined && marker.uid !== uid)) continue
      if (readFileSync(join(path, OWNER_MARKER), 'utf8').trim() !== String(pid)) continue
      for (const entry of entries) unlinkSync(join(path, entry))
      rmdirSync(path)
      removed.push(path)
    } catch {
      /* sem marcador, sem permissão ou já sumiu: preserva */
    }
  }
  return removed
}
