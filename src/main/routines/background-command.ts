import { spawn } from 'node:child_process'
import type { RoutineExecution } from '../../shared/model'

export interface BackgroundContext { cwd: string; shell: string; env: Record<string, string> }
export const BACKGROUND_TIMEOUT_MS = 10 * 60_000
export const BACKGROUND_OUTPUT_BYTES = 64 * 1024

/** Processos isolados em grupo para encerrar também os filhos quando o prazo termina. */
export class BackgroundCommands {
  private readonly kills = new Set<() => void>()
  stop(): void { for (const kill of this.kills) kill() }

  run(command: string, context: BackgroundContext, timeoutMs = BACKGROUND_TIMEOUT_MS, report?: (execution: RoutineExecution) => void): Promise<RoutineExecution> {
    const startedAt = new Date().toISOString(), start = Date.now()
    report?.({ startedAt, durationMs: 0, exitCode: null, output: '', status: 'running' })
    return new Promise(resolve => {
      const child = spawn(context.shell || '/bin/sh', ['-c', command], { cwd: context.cwd, env: context.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
      let output = Buffer.alloc(0), timedOut = false, error = '', settled = false
      const append = (chunk: Buffer): void => { output = Buffer.concat([output, chunk]).subarray(-BACKGROUND_OUTPUT_BYTES) }
      const kill = (): void => {
        if (child.pid === undefined) return
        try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL') } catch { /* o grupo já terminou */ }
      }
      this.kills.add(kill)
      const timer = setTimeout(() => { timedOut = true; kill() }, timeoutMs)
      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true; clearTimeout(timer); this.kills.delete(kill)
        if (error) append(Buffer.from(error))
        let first = 0
        while (first < output.length && (output[first]! & 0xc0) === 0x80) first++
        resolve({ startedAt, durationMs: Math.max(0, Date.now() - start), exitCode, output: output.subarray(first).toString('utf8'), status: timedOut ? 'timedOut' : error ? 'failed' : 'completed' })
      }
      child.stdout.on('data', append); child.stderr.on('data', append)
      child.on('error', err => { error = err.message; finish(null) })
      child.on('close', code => finish(code))
    })
  }
}
