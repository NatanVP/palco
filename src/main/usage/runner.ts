import { spawn as spawnProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Readable, Writable } from 'node:stream'
import type { Runner } from './providers'

interface UsageChild extends EventEmitter { pid?: number; stdin: Writable | null; stdout: Readable | null }
interface SpawnOptions { cwd: string; env: Record<string, string>; shell: false; detached: true; stdio: ['pipe', 'pipe', 'ignore'] }
interface Dependencies { spawn?: (cmd: string, args: string[], options: SpawnOptions) => UsageChild; kill?: (pid: number, signal: NodeJS.Signals) => void }
/**
 * Ambiente do probe: só o necessário para o CLI achar o binário, a casa e a conta.
 * Nada de agente SSH, credenciais de API ou variáveis de sessão do palco.
 */
const PROBE_VARS = ['HOME', 'PATH', 'LANG', 'TERM', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME'] as const
export function probeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of PROBE_VARS) {
    const value = env[key]
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  return out
}
const failure = (code: string): Error & { code: string } => Object.assign(new Error('falha ao consultar CLI de uso'), { code })

/** Uma execução isolada; nunca lê credenciais e nunca registra a saída do CLI. */
export function createUsageRunner(deps: Dependencies = {}): Runner & { dispose(): Promise<void> } {
  const launch = deps.spawn ?? ((cmd, args, options) => spawnProcess(cmd, args, options))
  const kill = deps.kill ?? ((pid, signal) => { process.kill(pid, signal) })
  const running = new Set<() => void>()
  let disposed = false
  const pending = new Set<Promise<unknown>>()
  const run: Runner = (cmd, args, env, stdinLines, until, timeoutMs) => {
    const promise = new Promise<unknown>((resolve, reject) => {
    if (disposed) { reject(failure('ECANCELED')); return }
    const cwd = mkdtempSync(join(tmpdir(), 'palco-usage-'))
    let child: UsageChild
    try {
      child = launch(cmd, args, { cwd, env: { ...probeEnv(env), ...(args.includes('app-server') ? { CODEX_SQLITE_HOME: join(cwd, 'sqlite') } : {}) }, shell: false, detached: true, stdio: ['pipe', 'pipe', 'ignore'] })
    } catch (err) { rmSync(cwd, { recursive: true, force: true }); reject(failure((err as NodeJS.ErrnoException).code ?? 'ELAUNCH')); return }
    let settled = false, stopping = false, matched = false, result: unknown = null, error: Error | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const signal = (sig: NodeJS.Signals): void => { if (child.pid) { try { kill(-child.pid, sig) } catch { /* já encerrou */ } } }
    const cleanup = (): void => {
      clearTimeout(timeout); clearTimeout(killTimer); running.delete(cancel)
      try { rmSync(cwd, { recursive: true, force: true }) } catch { /* sem derrubar o main por limpeza de temporário */ }
    }
    const settle = (): void => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(result)
    }
    const stop = (err?: Error): void => {
      if (stopping) return
      stopping = true; error = err
      clearTimeout(timeout)
      signal('SIGTERM')
      killTimer = setTimeout(() => { signal('SIGKILL'); cleanup(); settle() }, 1000)
    }
    const cancel = (): void => stop(failure('ECANCELED'))
    running.add(cancel)
    timeout = setTimeout(() => stop(failure('ETIMEDOUT')), timeoutMs)
    child.once('error', (err: NodeJS.ErrnoException) => { error = failure(err.code ?? 'ELAUNCH'); cleanup(); settle() })
    const completeJson = args.includes('/usage') && args.includes('json')
    let completeBuffer = ''
    child.once('close', () => {
      if(completeJson&&!matched&&!error){try{const value:unknown=JSON.parse(completeBuffer);if(until(value)){matched=true;result=value}}catch{ /* erro de protocolo abaixo */ }}
      if (!matched && !error) error = failure('EPROTOCOL')
      cleanup(); settle()
    })
    child.stdin?.on('error', () => stop(failure('EPIPE')))
    const write = (lines: string[]): void => { for (const line of lines) child.stdin?.write(line + '\n') }
    // app-server requires initialize's reply before initialized/rateLimits/read.
    let awaitingInit = args.includes('app-server') && stdinLines.length > 1
    write(awaitingInit ? stdinLines.slice(0, 1) : stdinLines)
    if(completeJson)child.stdin?.end()
    let buffer = '', total = 0
    const decoder = new StringDecoder('utf8')
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stopping) return
      total += chunk.length
      if (total > 4 * 1024 * 1024) { stop(failure('EOUTPUT')); return }
      if(completeJson){completeBuffer+=decoder.write(chunk);return}
      buffer += decoder.write(chunk)
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (Buffer.byteLength(line) > 1024 * 1024) { stop(failure('EOUTPUT')); return }
        let value: unknown
        try { value = JSON.parse(line) } catch { continue }
        if (awaitingInit && value && typeof value === 'object' && (value as { id?: unknown }).id === 1) {
          if ((value as { error?: unknown }).error) { stop(failure('EPROTOCOL')); return }
          awaitingInit = false; write(stdinLines.slice(1))
        }
        if (until(value)) { matched = true; result = value; stop(); return }
      }
      if (Buffer.byteLength(buffer) > 1024 * 1024) stop(failure('EOUTPUT'))
    })
    })
    pending.add(promise)
    void promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  }
  return Object.assign(run, { dispose: async () => {
    disposed = true
    for (const cancel of running) cancel()
    await Promise.allSettled([...pending])
  } })
}
