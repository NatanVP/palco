// @vitest-environment node
// ditado local com whisper.cpp — download conferido por hash, transcrição no próprio PC e microfone só para isso.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODELS, RUNTIMES, type RuntimeBuild, type VoiceModel } from '../src/main/voice/catalog'
import { downloadVerified } from '../src/main/voice/download'
import { installMicPolicy, MicGate } from '../src/main/voice/permission'
import { VoiceService } from '../src/main/voice/voice-service'
import { cleanTranscript, whisperLanguage } from '../src/main/voice/transcribe'

const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-voice-integrity-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('catálogo fixado', () => {
  it('só https, hashes completos, modelos multilíngues com o base por padrão', () => {
    const all = [...Object.values(RUNTIMES).map((r) => r!), ...MODELS]
    for (const item of all) { expect(item.url).toMatch(/^https:\/\//); expect(item.sha256).toMatch(/^[0-9a-f]{64}$/); expect(item.size).toBeGreaterThan(1_000_000) }
    expect(MODELS.map((m) => m.id)).toEqual(['base', 'small-q5', 'small'])
    for (const m of MODELS) expect(m.file).not.toContain('.en')
    for (const r of Object.values(RUNTIMES)) {
      expect(Object.keys(r!.files)).toContain('whisper-cli')
      for (const h of Object.values(r!.files)) expect(h).toMatch(/^[0-9a-f]{64}$/)
      // Todo atalho aponta para um arquivo conferido (direto ou por outro atalho).
      for (const target of Object.values(r!.links)) expect(target in r!.files || target in r!.links).toBe(true)
    }
  })
})

/** `fetch` de mentira: cada URL devolve os bytes dados, em pedaços. */
const server = (files: Record<string, Buffer>) => vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
  const data = files[url]
  if (!data) return new Response('nada', { status: 404 })
  let at = 0
  return new Response(new ReadableStream({
    pull(c) {
      if (init?.signal?.aborted) { c.error(new Error('abortado')); return }
      if (at >= data.length) { c.close(); return }
      c.enqueue(data.subarray(at, (at += 1024)))
    }
  }))
})

describe('download conferido', () => {
  const data = Buffer.alloc(5000, 7), pinned = { url: 'https://exemplo/a', sha256: sha(data), size: data.length }
  const leftovers = () => readdirSync(dir)

  it('grava só quando tamanho e hash batem, informando o andamento', async () => {
    const seen: number[] = []
    await downloadVerified(pinned, join(dir, 'a'), { fetch: server({ [pinned.url]: data }) as never, onProgress: (n) => seen.push(n) })
    expect(readFileSync(join(dir, 'a'))).toEqual(data)
    expect(seen.at(-1)).toBe(5000)
    expect(leftovers()).toEqual(['a'])
  })

  it.each<[string, Partial<typeof pinned>, Buffer, RegExp]>([
    ['hash diferente', { sha256: sha('outro') }, data, /hash/],
    ['maior que o esperado', { size: 3000 }, data, /tamanho/],
    ['menor que o esperado', {}, data.subarray(0, 100), /tamanho/]
  ])('recusa %s e não deixa nada', async (_name, over, served, message) => {
    await expect(downloadVerified({ ...pinned, ...over }, join(dir, 'a'), { fetch: server({ [pinned.url]: served }) as never })).rejects.toThrow(message)
    expect(leftovers()).toEqual([])
  })

  it('recusa endereço sem https, erro do servidor e cancelamento', async () => {
    await expect(downloadVerified({ ...pinned, url: 'http://exemplo/a' }, join(dir, 'a'), { fetch: server({}) as never })).rejects.toThrow(/https/)
    await expect(downloadVerified(pinned, join(dir, 'a'), { fetch: server({}) as never })).rejects.toThrow(/404/)
    const stop = new AbortController()
    await expect(downloadVerified(pinned, join(dir, 'a'), { fetch: server({ [pinned.url]: data }) as never, signal: stop.signal, onProgress: () => stop.abort() })).rejects.toThrow(/abort/i)
    expect(leftovers()).toEqual([])
  })
})

/** Um pacote de verdade (tar.gz) com um "whisper-cli" que é um script: ele ecoa os argumentos e o tamanho do áudio. */
function fakeCatalog() {
  const top = 'pacote', src = join(dir, 'src', top)
  mkdirSync(src, { recursive: true })
  const script = `#!/bin/sh
for a in "$@"; do last="$a"; done
echo " argumentos: $*"
echo " [BLANK_AUDIO]"
echo " audio de $(wc -c < "$last") bytes, GGML=\${GGML_BACKEND_PATH:-nenhum} PALCO=\${PALCO_SOCKET:-nenhum}"
[ -e "$0.falha" ] && exit 3
exit 0
`
  writeFileSync(join(src, 'whisper-cli'), script); chmodSync(join(src, 'whisper-cli'), 0o755)
  writeFileSync(join(src, 'libw.so.1.0'), 'biblioteca'); symlinkSync('libw.so.1.0', join(src, 'libw.so'))
  writeFileSync(join(src, 'sobra'), 'não vai')
  const tgz = join(dir, 'pacote.tar.gz')
  execFileSync('tar', ['-czf', tgz, '-C', join(dir, 'src'), top])
  const archive = readFileSync(tgz), model = Buffer.alloc(4000, 3)
  const runtime: RuntimeBuild = { url: 'https://exemplo/pacote.tar.gz', sha256: sha(archive), size: archive.length, top, files: { 'whisper-cli': sha(script), 'libw.so.1.0': sha('biblioteca') }, links: { 'libw.so': 'libw.so.1.0' } }
  const models: VoiceModel[] = [{ id: 'base', file: 'ggml-base.bin', url: 'https://exemplo/base', sha256: sha(model), size: model.length }]
  return { runtime, models, files: { [runtime.url]: archive, 'https://exemplo/base': model } }
}
const wav = (samples = 1600): Buffer => {
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  return b
}

describe('instalação e transcrição', () => {
  const make = () => {
    const c = fakeCatalog(), fetch = server(c.files), root = join(dir, 'voice')
    const service = new VoiceService({ root, runtime: c.runtime, models: c.models, fetch: fetch as never })
    return { ...c, fetch, root, service, bin: join(root, 'runtime', 'b5454'), model: join(root, 'models', 'ggml-base.bin') }
  }

  it('baixa o programa e o modelo, extrai só o que está fixado e recria os atalhos', async () => {
    const h = make(), progress: Array<[string, number, number]> = []
    expect(h.service.status('base')).toMatchObject({ supported: true, runtime: false, ready: false, models: [{ id: 'base', installed: false, size: 4000 }] })
    await h.service.install('base', (p) => progress.push([p.what, p.received, p.total]))
    expect(h.service.status('base')).toMatchObject({ runtime: true, ready: true, models: [{ id: 'base', installed: true }] })
    expect(readdirSync(h.bin).sort()).toEqual(['libw.so', 'libw.so.1.0', 'whisper-cli'])
    expect(readlinkSync(join(h.bin, 'libw.so'))).toBe('libw.so.1.0')
    expect(progress.at(-1)).toEqual(['model', 4000, 4000])
    expect(progress.some(([what]) => what === 'runtime')).toBe(true)
    // Nada temporário sobra, e o que já está certo não é baixado de novo.
    expect(readdirSync(h.root).sort()).toEqual(['models', 'runtime'])
    h.fetch.mockClear(); await h.service.install('base'); expect(h.fetch).not.toHaveBeenCalled()
  })

  it('pacote que não bate com o hash não é extraído', async () => {
    const c = fakeCatalog()
    const service = new VoiceService({ root: join(dir, 'voice'), runtime: { ...c.runtime, sha256: sha('x') }, models: c.models, fetch: server(c.files) as never })
    await expect(service.install('base')).rejects.toThrow(/hash/)
    expect(service.status('base')).toMatchObject({ runtime: false, ready: false })
    expect(existsSync(join(dir, 'voice', 'runtime', 'b5454'))).toBe(false)
  })

  it('transcreve com o modelo e o idioma pedidos, sem herdar variáveis do app, e apaga o áudio', async () => {
    const h = make(); await h.service.install('base')
    process.env.GGML_BACKEND_PATH = '/tmp/intruso.so'; process.env.PALCO_SOCKET = '/tmp/s'
    try {
      const text = await h.service.transcribe(wav(), { model: 'base', language: 'pt' })
      expect(text).toContain(`argumentos: -m ${h.model} -l pt -nt -np -f `)
      expect(text).toContain('audio de 3244 bytes, GGML=nenhum PALCO=nenhum')
      expect(text).not.toContain('BLANK_AUDIO')
    } finally { delete process.env.GGML_BACKEND_PATH; delete process.env.PALCO_SOCKET }
    expect(readdirSync(join(h.root, 'tmp'))).toEqual([])
    expect(statSync(join(h.root, 'tmp')).mode & 0o777).toBe(0o700)
  })

  it('o áudio é apagado também quando a transcrição falha', async () => {
    const h = make(); await h.service.install('base')
    // O script falha se existir o marcador ao lado dele; o marcador some antes da conferência seguinte.
    const script = readFileSync(join(h.bin, 'whisper-cli'))
    writeFileSync(join(dir, 'falha.sh'), '#!/bin/sh\nexit 3\n')
    const failing = new VoiceService({ root: h.root, runtime: h.runtime, models: h.models, fetch: h.fetch as never, run: async () => { expect(readdirSync(join(h.root, 'tmp'))).toHaveLength(1); throw new Error('o whisper saiu com 3') } })
    await expect(failing.transcribe(wav(), { model: 'base', language: 'pt' })).rejects.toThrow(/whisper/)
    expect([readdirSync(join(h.root, 'tmp')), readFileSync(join(h.bin, 'whisper-cli'))]).toEqual([[], script])
  })

  it.each<[string, (h: { bin: string; model: string }) => void]>([
    ['o programa mudou', (h) => writeFileSync(join(h.bin, 'whisper-cli'), '#!/bin/sh\necho mau\n')],
    ['uma biblioteca mudou', (h) => writeFileSync(join(h.bin, 'libw.so.1.0'), 'trocada')],
    ['apareceu uma biblioteca estranha', (h) => writeFileSync(join(h.bin, 'libggml-cpu-mal.so'), 'x')],
    ['um atalho foi desviado', (h) => { rmSync(join(h.bin, 'libw.so')); symlinkSync('/etc/hosts', join(h.bin, 'libw.so')) }],
    ['o modelo mudou', (h) => writeFileSync(h.model, Buffer.alloc(4000, 9))]
  ])('não executa nada se %s, e instalar de novo conserta', async (_name, tamper) => {
    const run = vi.fn(async () => 'texto'), c = fakeCatalog(), root = join(dir, 'voice')
    const service = new VoiceService({ root, runtime: c.runtime, models: c.models, fetch: server(c.files) as never, run })
    await service.install('base')
    await service.transcribe(wav(), { model: 'base', language: 'pt' })
    tamper({ bin: join(root, 'runtime', 'b5454'), model: join(root, 'models', 'ggml-base.bin') })
    run.mockClear()
    await expect(service.transcribe(wav(), { model: 'base', language: 'pt' })).rejects.toThrow(/não confere|instale/i)
    expect(run).not.toHaveBeenCalled()
    await service.install('base')
    expect(await service.transcribe(wav(), { model: 'base', language: 'pt' })).toBe('texto')
  })

  it('conferir os hashes não trava o processo principal (o resto do app segue respondendo)', async () => {
    const c = fakeCatalog(), root = join(dir, 'voice')
    let ticked = false, atRun: boolean | undefined
    const service = new VoiceService({ root, runtime: c.runtime, models: c.models, fetch: server(c.files) as never, run: async () => { atRun = ticked; return 'x' } })
    await service.install('base')
    setImmediate(() => { ticked = true })
    await service.transcribe(wav(), { model: 'base', language: 'pt' })
    expect(atRun).toBe(true)
  })

  it.each<[string, Buffer]>([['não é WAV', Buffer.from('ola')], ['outra taxa', (() => { const b = wav(); b.writeUInt32LE(44100, 24); return b })()], ['estéreo', (() => { const b = wav(); b.writeUInt16LE(2, 22); return b })()], ['longo demais', wav(16000 * 601)]])('recusa áudio que %s', async (_name, audio) => {
    const h = make(); await h.service.install('base')
    await expect(h.service.transcribe(audio, { model: 'base', language: 'pt' })).rejects.toThrow(/áudio/)
  })

  it('uma instalação por vez, que dá para cancelar; remover apaga tudo; sobras de áudio somem na abertura', async () => {
    const h = make()
    const first = h.service.install('base', () => h.service.cancel())
    await expect(h.service.install('base')).rejects.toThrow(/andamento/)
    await expect(first).rejects.toThrow(/cancel|abort/i)
    expect(h.service.status('base').ready).toBe(false)
    await h.service.install('base'); h.service.remove()
    expect([existsSync(h.root), h.service.status('base').ready]).toEqual([false, false])
    mkdirSync(join(h.root, 'tmp'), { recursive: true }); writeFileSync(join(h.root, 'tmp', 'velho.wav'), 'x')
    new VoiceService({ root: h.root, runtime: h.runtime, models: h.models })
    expect(readdirSync(join(h.root, 'tmp'))).toEqual([])
  })

  it('sem pacote para a plataforma, diz que não há suporte', async () => {
    const service = new VoiceService({ root: join(dir, 'voice'), runtime: undefined, models: MODELS })
    expect(service.status('base')).toMatchObject({ supported: false, ready: false })
    await expect(service.install('base')).rejects.toThrow(/plataforma/)
  })

  it('limpa a saída e escolhe o idioma', () => {
    expect(cleanTranscript(' Olá, tudo bem?\n [Música]\n(silêncio)\n Até mais. [BLANK_AUDIO]\n')).toBe('Olá, tudo bem? Até mais.')
    expect(cleanTranscript(' Use o item (a) e depois o [b].')).toBe('Use o item (a) e depois o [b].')
    expect([whisperLanguage('app', 'pt-BR'), whisperLanguage('app', 'zh-Hans'), whisperLanguage('auto', 'pt-BR'), whisperLanguage('es', 'pt-BR')]).toEqual(['pt', 'zh', 'auto', 'es'])
  })
})

describe('microfone só para o ditado', () => {
  type Check = (wc: unknown, permission: string, origin: string, details: Record<string, unknown>) => boolean
  type Request = (wc: unknown, permission: string, cb: (ok: boolean) => void, details: Record<string, unknown>) => void
  const session = () => { const s = { check: undefined as unknown as Check, request: undefined as unknown as Request, setPermissionCheckHandler: (f: Check) => { s.check = f }, setPermissionRequestHandler: (f: Request) => { s.request = f } }; return s }
  const app = { id: 'app' }, other = { id: 'outro' }, url = 'file:///app/index.html'
  const ask = (s: ReturnType<typeof session>, wc: unknown, permission: string, details: Record<string, unknown>) => { let out: boolean | undefined; s.request(wc, permission, (ok) => { out = ok }, details); return out }
  let now = 1000
  const gate = () => new MicGate(() => now)
  const wire = (g: MicGate) => { const main = session(), guest = session(); installMicPolicy(main as never, { gate: g, isApp: (wc: unknown) => wc === app, isTrustedUrl: (u: string) => u === url }); installMicPolicy(guest as never, null); return { main, guest } }

  it('só a janela do app, só áudio, só logo depois de o usuário pedir', () => {
    const g = gate(), { main } = wire(g)
    const audio = { mediaTypes: ['audio'], requestingUrl: url }
    expect(ask(main, app, 'media', audio)).toBe(false)
    g.arm()
    expect([ask(main, app, 'media', audio), main.check(app, 'media', url, { mediaType: 'audio', requestingUrl: url })]).toEqual([true, true])
    expect(ask(main, app, 'media', { mediaTypes: ['audio', 'video'], requestingUrl: url })).toBe(false)
    expect(ask(main, app, 'media', { mediaTypes: ['video'], requestingUrl: url })).toBe(false)
    expect(ask(main, app, 'media', { requestingUrl: url })).toBe(false)
    expect(ask(main, other, 'media', audio)).toBe(false)
    expect(ask(main, app, 'media', { mediaTypes: ['audio'], requestingUrl: 'https://site.example' })).toBe(false)
    now += 15_001
    expect(ask(main, app, 'media', audio)).toBe(false)
  })

  it('as outras permissões continuam como antes; portais nunca usam microfone nem câmera', () => {
    const g = gate(), { main, guest } = wire(g)
    g.arm()
    for (const permission of ['clipboard-sanitized-write', 'local-fonts', 'fullscreen', 'notifications']) {
      expect([ask(main, app, permission, {}), ask(guest, other, permission, {})], permission).toEqual([true, true])
    }
    for (const permission of ['media', 'display-capture']) {
      expect(ask(guest, other, permission, { mediaTypes: ['audio'], requestingUrl: url }), permission).toBe(false)
      expect(guest.check(other, permission, 'https://x', { mediaType: 'audio' }), permission).toBe(false)
    }
    expect(ask(main, app, 'display-capture', {})).toBe(false)
  })
})
