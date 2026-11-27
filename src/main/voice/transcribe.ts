import { spawn } from 'node:child_process'
import { MAX_DICTATION_SECONDS, type VoiceLanguage } from '../../shared/voice'

const RATE = 16_000
const MAX_OUTPUT = 1024 * 1024

/** Só o WAV que a interface gera: PCM de 16 bits, mono, 16 kHz, de até dez minutos. */
export function checkWav(data: Buffer): void {
  const fail = (): never => { throw new Error('áudio inválido: esperado WAV mono de 16 kHz e até dez minutos') }
  if (data.length < 44 || data.length > 44 + MAX_DICTATION_SECONDS * RATE * 2) fail()
  if (data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 16) !== 'WAVEfmt ' || data.toString('latin1', 36, 40) !== 'data') fail()
  if (data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== 1 || data.readUInt32LE(24) !== RATE || data.readUInt16LE(34) !== 16 || data.readUInt32LE(40) !== data.length - 44) fail()
}

/** Marcas que o modelo escreve para o que não é fala. */
const NOISE = /\[(?:BLANK_AUDIO|SOUND|MUSIC|NOISE|SILENCE)\]/gi
/** A saída em uma linha, sem as marcas de silêncio e sem as linhas que são só uma anotação entre colchetes ou parênteses. */
export function cleanTranscript(output: string): string {
  return output.split('\n').map((line) => line.replace(NOISE, '').trim()).filter((line) => line && !/^(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*)$/.test(line)).join(' ').replace(/\s+/g, ' ').trim()
}

/** O idioma que vai para o whisper: o do app (só o prefixo), detecção automática ou o escolhido. */
export const whisperLanguage = (preference: VoiceLanguage, appLocale: string): string => (preference === 'app' ? appLocale.split('-')[0]! : preference)

export interface RunOptions { cwd: string; env: Record<string, string>; timeoutMs: number; signal?: AbortSignal }
export type Run = (binary: string, args: string[], options: RunOptions) => Promise<string>

/** Executa o whisper (sem shell) e devolve a saída. */
export const runWhisper: Run = (binary, args, { cwd, env, timeoutMs, signal }) => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'ignore'], ...(signal ? { signal } : {}) })
  let out = ''
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { if (out.length < MAX_OUTPUT) out += chunk })
  child.on('error', (error) => { clearTimeout(timer); reject(error) })
  child.on('close', (code, killed) => {
    clearTimeout(timer)
    if (code === 0) resolve(out)
    else reject(new Error(`a transcrição falhou: o whisper saiu com ${code ?? killed}`))
  })
})
