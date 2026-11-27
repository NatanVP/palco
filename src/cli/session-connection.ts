import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs'

/** tmux processes keep this path, not a permanent bearer token. Each invocation reads the current app generation. */
export function connectionEnvironment(env: NodeJS.ProcessEnv = process.env): { socket: string | undefined; token: string | undefined } {
  if (!env.PALCO_SESSION_FILE) return { socket: env.PALCO_SOCKET, token: env.PALCO_TOKEN }
  let fd: number | undefined
  try {
    fd = openSync(env.PALCO_SESSION_FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const s = fstatSync(fd)
    if (!s.isFile() || s.size < 1 || s.size > 16384 || (s.mode & 0o077) !== 0 || (process.getuid && s.uid !== process.getuid())) throw new Error('invalid')
    const bytes = Buffer.alloc(16385), count = readSync(fd, bytes, 0, bytes.length, 0)
    if (count !== s.size) throw new Error('changed')
    const value = JSON.parse(bytes.subarray(0, count).toString()) as { socket?: unknown; token?: unknown; version?: unknown }
    if (value.version !== 1 || typeof value.socket !== 'string' || !value.socket || typeof value.token !== 'string' || !value.token || /[\r\n\0]/.test(value.token)) throw new Error('invalid')
    return { socket: value.socket, token: value.token }
  } catch {
    // Never surface JSON parser errors: they may quote bytes of the credential.
    throw new Error('Credencial da sessão tmux indisponível. Reabra ou reinicie o terminal pelo palco.')
  } finally { if (fd !== undefined) closeSync(fd) }
}
