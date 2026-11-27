import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ModelId, VoiceProgress, VoiceStatus } from '../../shared/voice'
import { RUNTIME_TAG, type RuntimeBuild, type VoiceModel } from './catalog'
import { downloadVerified } from './download'
import { checkWav, cleanTranscript, runWhisper, type Run } from './transcribe'

const TIMEOUT_MS = 5 * 60_000
const UNSUPPORTED = 'o ditado não está disponível nesta plataforma'
const BROKEN = 'o programa ou o modelo de ditado não confere; instale de novo nas Configurações'

/** SHA-256 de um arquivo, em fluxo: o modelo tem centenas de MB e o processo principal não pode parar por isso. */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path, { highWaterMark: 1024 * 1024 }), hash)
  return hash.digest('hex')
}

export interface VoiceOptions {
  /** `<dados>/voice`: programa, modelos e o áudio temporário. */
  root: string
  runtime: RuntimeBuild | undefined
  models: readonly VoiceModel[]
  fetch?: typeof fetch
  run?: Run
}

/**
 * O ditado local: instala o whisper.cpp e os modelos conferindo o hash de tudo, confere de novo antes de executar e
 * transcreve um áudio que só existe num arquivo temporário (apagado em seguida). O áudio nunca sai do computador.
 */
export class VoiceService {
  private readonly runtimeDir: string
  private readonly tmp: string
  private installing: AbortController | null = null
  private readonly running = new Set<AbortController>()
  /** Modelos já conferidos nesta sessão, pela assinatura do arquivo (muda se alguém escrever nele). */
  private readonly checked = new Map<string, string>()

  constructor(private readonly options: VoiceOptions) {
    this.runtimeDir = join(options.root, 'runtime', RUNTIME_TAG)
    this.tmp = join(options.root, 'tmp')
    // Áudio que sobrou de uma queda do app.
    if (existsSync(this.tmp)) for (const name of readdirSync(this.tmp)) rmSync(join(this.tmp, name), { recursive: true, force: true })
  }

  private model(id: ModelId): VoiceModel {
    const model = this.options.models.find((m) => m.id === id)
    if (!model) throw new Error('modelo de ditado desconhecido')
    return model
  }
  private modelPath(model: VoiceModel): string { return join(this.options.root, 'models', model.file) }
  private present(model: VoiceModel): boolean { try { return statSync(this.modelPath(model)).size === model.size } catch { return false } }

  status(selected: ModelId): VoiceStatus {
    const { runtime } = this.options
    const installed = runtime !== undefined && existsSync(join(this.runtimeDir, 'whisper-cli'))
    const models = this.options.models.map((m) => ({ id: m.id, size: m.size, installed: this.present(m) }))
    return { supported: runtime !== undefined, runtime: installed, ready: installed && models.some((m) => m.id === selected && m.installed), runtimeSize: runtime?.size ?? 0, selected, models }
  }

  /** A pasta tem exatamente os arquivos fixados (nada a mais que o whisper pudesse carregar), com os hashes e atalhos certos. */
  private async verifyRuntime(): Promise<boolean> {
    const runtime = this.options.runtime
    if (!runtime) return false
    try {
      const expected = [...Object.keys(runtime.files), ...Object.keys(runtime.links)].sort()
      if (readdirSync(this.runtimeDir).sort().join('\n') !== expected.join('\n')) return false
      for (const [name, sha256] of Object.entries(runtime.files)) {
        const path = join(this.runtimeDir, name)
        if (!lstatSync(path).isFile() || (await hashFile(path)) !== sha256) return false
      }
      return Object.entries(runtime.links).every(([name, target]) => readlinkSync(join(this.runtimeDir, name)) === target)
    } catch { return false }
  }

  private async verifyModel(model: VoiceModel): Promise<boolean> {
    try {
      const path = this.modelPath(model), info = lstatSync(path)
      if (!info.isFile() || info.size !== model.size) return false
      const stamp = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
      if (this.checked.get(path) === stamp) return true
      if ((await hashFile(path)) !== model.sha256) return false
      this.checked.set(path, stamp)
      return true
    } catch { return false }
  }

  /** Do pacote já conferido saem só os arquivos fixados; os atalhos são recriados aqui. */
  private async extract(runtime: RuntimeBuild, archive: string): Promise<void> {
    const staging = `${this.runtimeDir}.tmp`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true, mode: 0o700 })
    try {
      await promisify(execFile)('tar', ['-xzf', archive, '-C', staging, '--strip-components=1', '--no-same-owner', ...Object.keys(runtime.files).map((f) => `${runtime.top}/${f}`)])
      for (const [name, sha256] of Object.entries(runtime.files)) {
        const path = join(staging, name)
        if (!lstatSync(path).isFile() || (await hashFile(path)) !== sha256) throw new Error('o arquivo baixado não confere com o hash esperado; nada foi instalado')
      }
      chmodSync(join(staging, 'whisper-cli'), 0o755)
      for (const [name, target] of Object.entries(runtime.links)) symlinkSync(target, join(staging, name))
      rmSync(this.runtimeDir, { recursive: true, force: true })
      renameSync(staging, this.runtimeDir)
    } finally { rmSync(staging, { recursive: true, force: true }) }
  }

  /** Baixa o que faltar (ou não conferir). Uma instalação por vez; `cancel()` interrompe. */
  async install(id: ModelId, onProgress: (progress: VoiceProgress) => void = () => {}): Promise<void> {
    const { runtime, fetch } = this.options
    if (!runtime) throw new Error(UNSUPPORTED)
    const model = this.model(id)
    if (this.installing) throw new Error('já há uma instalação do ditado em andamento')
    const controller = this.installing = new AbortController()
    const downloads = join(this.options.root, 'download')
    const get = (pinned: { url: string; sha256: string; size: number }, dest: string, what: VoiceProgress['what']) =>
      downloadVerified(pinned, dest, { signal: controller.signal, onProgress: (received) => onProgress({ what, received, total: pinned.size }), ...(fetch ? { fetch } : {}) })
    try {
      if (!(await this.verifyRuntime())) {
        const archive = join(downloads, 'whisper.tar.gz')
        await get(runtime, archive, 'runtime')
        await this.extract(runtime, archive)
      }
      if (!(await this.verifyModel(model))) {
        rmSync(this.modelPath(model), { force: true })
        await get(model, this.modelPath(model), 'model')
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error('instalação do ditado cancelada')
      throw error
    } finally {
      rmSync(downloads, { recursive: true, force: true })
      this.installing = null
    }
  }

  cancel(): void { this.installing?.abort() }

  async transcribe(audio: Uint8Array, { model: id, language }: { model: ModelId; language: string }): Promise<string> {
    const wav = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength)
    checkWav(wav)
    if (!this.options.runtime) throw new Error(UNSUPPORTED)
    const model = this.model(id)
    // Nada do que foi baixado é executado sem conferir o hash.
    if (!(await this.verifyRuntime()) || !(await this.verifyModel(model))) throw new Error(BROKEN)
    mkdirSync(this.tmp, { recursive: true, mode: 0o700 })
    chmodSync(this.tmp, 0o700)
    const file = join(this.tmp, `${randomUUID()}.wav`), controller = new AbortController()
    this.running.add(controller)
    try {
      writeFileSync(file, wav, { flag: 'wx', mode: 0o600 })
      const output = await (this.options.run ?? runWhisper)(join(this.runtimeDir, 'whisper-cli'), ['-m', this.modelPath(model), '-l', language, '-nt', '-np', '-f', file], {
        // Ambiente mínimo: nada do app (nem variáveis que fariam o ggml carregar outra biblioteca).
        cwd: this.tmp, env: { PATH: '/usr/bin:/bin', HOME: this.tmp, LANG: 'C.UTF-8' }, timeoutMs: TIMEOUT_MS, signal: controller.signal
      })
      return cleanTranscript(output)
    } finally {
      this.running.delete(controller)
      rmSync(file, { force: true })
    }
  }

  /** Tira o programa, os modelos e o que houver na pasta do ditado. */
  remove(): void {
    this.dispose()
    this.checked.clear()
    rmSync(this.options.root, { recursive: true, force: true })
  }

  dispose(): void {
    this.cancel()
    for (const c of this.running) c.abort()
  }
}
