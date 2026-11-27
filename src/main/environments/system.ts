import { spawn } from 'node:child_process'
import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { delimiter, join, isAbsolute } from 'node:path'
import type { LaunchStep } from './launch'

/** Roda um programa (sem shell), com stdin opcional, juntando a saída; mata no prazo. Os argumentos nunca passam por um shell local. */
export function runStep(step: LaunchStep, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise(resolve => {
    if (step.signal?.aborted) { resolve({ code: null, out: 'cancelado' }); return }
    let out = ''
    const child = spawn(step.file, step.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const abort = () => { child.kill('SIGKILL') }
    step.signal?.addEventListener('abort', abort, { once: true })
    if (step.signal?.aborted) abort()
    const finish = () => { clearTimeout(timer); step.signal?.removeEventListener('abort', abort) }
    const timer = setTimeout(() => { out += '\n(tempo esgotado)'; child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', d => { out += String(d) }); child.stderr.on('data', d => { out += String(d) })
    child.stdin.on('error', () => {}); child.stdin.end(step.stdin ?? '')
    child.on('error', err => { finish(); resolve({ code: null, out: err.message }) })
    child.on('close', code => { finish(); resolve({ code, out }) })
  })
}
/** Caminho de um programa no PATH (executável), ou null. */
export function which(program: string, path = process.env.PATH ?? ''): string | null {
  const candidates=isAbsolute(program)?[program]:path.split(delimiter).filter(Boolean).map(dir=>join(dir,program))
  for(const candidate of candidates){try{accessSync(candidate,constants.X_OK);if(statSync(candidate).isFile())return candidate}catch{ /* próximo */ }}
  return null
}
export function readCliBundle(file: string): Buffer | null { try { return readFileSync(file) } catch { return null } }
