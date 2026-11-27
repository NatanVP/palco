// @vitest-environment happy-dom
// o microfone no compositor do chat, a primeira instalação, o atalho e as Configurações.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '../src/renderer/src/chat/ChatView'
import { useCanvasCommands } from '../src/renderer/src/canvas/commands/useCommands'
import { resolveCommand } from '../src/renderer/src/canvas/commands/keymap'
import { WorkspaceJumpArm } from '../src/renderer/src/canvas/commands/jump'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { VoiceSettings } from '../src/renderer/src/voice/VoiceSettings'
import { encodeWav } from '../src/renderer/src/voice/wav'
import { defaultPreferences } from '../src/shared/preferences'
import { defaultShortcuts } from '../src/shared/shortcuts'
import type { VoiceProgress, VoiceStatus } from '../src/shared/voice'
import type { TerminalNode, Workspace } from '../src/shared/model'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
let ready: boolean, supported: boolean, progress: (p: VoiceProgress) => void, finishInstall: () => void
const stopped: string[] = []
const status = (): VoiceStatus => ({ supported, runtime: ready, ready, runtimeSize: 10_364_195, selected: 'base', models: [{ id: 'base', size: 147_951_465, installed: ready }, { id: 'small-q5', size: 190_085_487, installed: false }, { id: 'small', size: 487_601_967, installed: false }] })
const voice = {
  status: vi.fn(async () => status()), install: vi.fn(() => new Promise<void>((resolve) => { finishInstall = () => { ready = true; resolve() } })), cancel: vi.fn(async () => {}), remove: vi.fn(async () => { ready = false }),
  arm: vi.fn(async () => {}), transcribe: vi.fn(async (_wav: ArrayBuffer) => 'texto ditado'), onProgress: vi.fn((cb: (p: VoiceProgress) => void) => { progress = cb; return () => {} })
}
const send = vi.fn(), getUserMedia = vi.fn(async (_c: unknown) => ({ getTracks: () => [{ stop: () => stopped.push('faixa') }] }))

class Recorder {
  static last: Recorder
  state = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor() { Recorder.last = this }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.() }
}
class Context {
  async decodeAudioData() { return { duration: 0.5, sampleRate: 48000, numberOfChannels: 1, length: 24000, getChannelData: () => new Float32Array(24000) } }
  async close() {}
}
class Offline {
  destination = {}
  constructor(_channels: number, private readonly length: number, _rate: number) {}
  createBufferSource() { return { buffer: null, connect() {}, start() {} } }
  async startRendering() { return { getChannelData: () => new Float32Array(this.length).fill(0.25) } }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('AudioContext', Context); vi.stubGlobal('OfflineAudioContext', Offline)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  ready = true; supported = true; stopped.length = 0
  for (const f of [...Object.values(voice), send, getUserMedia]) f.mockClear()
  voice.transcribe.mockImplementation(async () => 'texto ditado')
  adoptPreferences(defaultPreferences())
  Object.assign(window, { palco: { voice, chat: { state: async () => ({ terminalId: 't1', thread: 'blue', entries: [], hasOlder: false, status: 'idle', unreadCount: 0, workingSince: null, filledThreads: [] }), older: async () => [], onChange: () => () => {}, send }, preferences: { set: vi.fn(async (patch: object) => ({ ...defaultPreferences(), ...patch })) } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const chat = async () => { await act(async () => root.render(<div data-node-id="t1"><ChatView terminalId="t1" name="Ana" /></div>)); await flush() }
const mic = () => host.querySelector<HTMLButtonElement>('.chat-composer .chat-mic')!
const area = () => host.querySelector<HTMLTextAreaElement>('textarea')!
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }); await flush() }
const dialog = () => host.querySelector('[role=dialog][aria-label="Ditado por voz"]')
const buttonIn = (el: Element, name: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === name)!
const type = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area(), value); area().dispatchEvent(new Event('input', { bubbles: true })) })

describe('microfone no compositor', () => {
  it('fica entre o campo e o envio', async () => {
    await chat()
    expect([...host.querySelector('.chat-composer')!.children].map((c) => c.getAttribute('aria-label'))).toEqual(['Anexar arquivo', 'Mensagem', 'Ditar mensagem', 'Enviar'])
    expect(mic().title).toBe('Ditar mensagem (Ctrl+Shift+d)')
  })

  it('grava só áudio, transcreve e põe o texto no cursor, sem enviar', async () => {
    await chat()
    await type('antes depois'); area().setSelectionRange(5, 5)
    await click(mic())
    expect(voice.arm).toHaveBeenCalled()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false })
    expect([mic().getAttribute('aria-label'), mic().getAttribute('aria-pressed'), Recorder.last.state]).toEqual(['Parar e transcrever', 'true', 'recording'])
    await click(mic())
    expect(stopped).toEqual(['faixa'])
    const sent = voice.transcribe.mock.calls[0]![0]
    expect([new TextDecoder().decode(new Uint8Array(sent, 0, 4)), new DataView(sent).getUint32(24, true), sent.byteLength]).toEqual(['RIFF', 16000, 44 + 8000 * 2])
    expect(area().value).toBe('antes texto ditado depois')
    expect(send).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(area())
  })

  it('Esc cancela a gravação sem transcrever; sair do chat também solta o microfone', async () => {
    await chat()
    await click(mic())
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) }); await flush()
    expect([stopped, voice.transcribe.mock.calls.length, mic().getAttribute('aria-label')]).toEqual([['faixa'], 0, 'Ditar mensagem'])
    await click(mic())
    await act(async () => root.render(<div />)); await flush()
    expect([stopped.length, voice.transcribe.mock.calls.length]).toEqual([2, 0])
  })

  it('mostra o motivo quando não dá para gravar ou transcrever, sem mexer no rascunho', async () => {
    await chat(); await type('meu rascunho')
    getUserMedia.mockRejectedValueOnce(new Error('Permission denied'))
    await click(mic())
    expect(host.querySelector('[role=alert]')!.textContent).toContain('microfone')
    voice.transcribe.mockRejectedValueOnce(new Error("Error invoking remote method 'palco:voice:transcribe': Error: o programa não confere; instale de novo"))
    await click(mic()); await click(mic())
    expect([host.querySelector('[role=alert]')!.textContent, area().value]).toEqual(['o programa não confere; instale de novo', 'meu rascunho'])
    voice.transcribe.mockResolvedValueOnce('')
    await click(mic()); await click(mic())
    expect(host.querySelector('[role=alert]')!.textContent).toContain('Nenhuma fala')
  })

  it('na primeira vez avisa o tamanho, baixa com andamento e só grava depois, a pedido', async () => {
    ready = false
    await chat()
    await click(mic())
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(dialog()!.textContent).toContain('158 MB')
    expect(dialog()!.textContent).toContain('O áudio não sai deste computador')
    await click(buttonIn(dialog()!, 'Cancelar'))
    expect([dialog(), voice.install.mock.calls.length]).toEqual([null, 0])
    await click(mic())
    const model = dialog()!.querySelector('select')!
    expect([...model.options].map((o) => o.value)).toEqual(['base', 'small-q5', 'small'])
    await click(buttonIn(dialog()!, 'Baixar'))
    expect(voice.install).toHaveBeenCalledWith('base')
    await act(async () => progress({ what: 'model', received: 73_975_732, total: 147_951_465 }))
    expect(dialog()!.querySelector('progress')!.value).toBeCloseTo(0.5, 2)
    expect(dialog()!.textContent).toContain('modelo')
    await act(async () => { finishInstall() }); await flush()
    expect([dialog(), getUserMedia.mock.calls.length]).toEqual([null, 0])
    await click(mic())
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('cancelar durante o download interrompe', async () => {
    ready = false
    await chat(); await click(mic()); await click(buttonIn(dialog()!, 'Baixar'))
    await click(buttonIn(dialog()!, 'Cancelar'))
    expect([voice.cancel.mock.calls.length, dialog()]).toEqual([1, null])
  })

  it('sem suporte na plataforma o botão explica por quê', async () => {
    supported = false; ready = false
    await chat(); await click(mic())
    expect(host.querySelector('[role=alert]')!.textContent).toContain('não está disponível')
    expect(dialog()).toBeNull()
  })
})

describe('atalho', () => {
  const agent = (id: string): TerminalNode => ({ id, kind: 'terminal', name: id, agent: 'claude', command: 'claude', cwd: '/tmp', floorId: null, chatMode: true, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })

  it('Ctrl+Shift+D por padrão, e vira o comando de ditar', () => {
    expect(defaultShortcuts().dictate).toEqual([{ key: 'd', ctrl: true, shift: true }])
    expect(resolveCommand({ key: 'D', code: 'KeyD', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, { shortcuts: defaultShortcuts(), jump: new WorkspaceJumpArm(), now: 0 })).toEqual({ kind: 'dictate' })
  })

  it('liga e desliga a gravação no chat focado', async () => {
    await chat()
    const notify = vi.fn(), ws = { id: 'w', name: 'W', nodes: { t1: agent('t1') }, connections: [], floors: {}, activeFloor: null, camera: { zoom: 1, offset: { x: 0, y: 0 } } } as Workspace
    let run!: ReturnType<typeof useCanvasCommands>
    const extra = document.createElement('div'); host.append(extra)
    const probe = createRoot(extra)
    function Probe() { run = useCanvasCommands({ ws: { current: ws }, selection: new Set(), notify } as never); return null }
    await act(async () => probe.render(<Probe />))
    area().focus()
    await act(async () => run({ kind: 'dictate' })); await flush()
    expect(mic().getAttribute('aria-pressed')).toBe('true')
    await act(async () => run({ kind: 'dictate' })); await flush()
    expect(area().value).toBe('texto ditado')
    area().blur()
    await act(async () => run({ kind: 'dictate' }))
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('chat'))
    await act(async () => probe.unmount())
  })
})

describe('Configurações', () => {
  it('escolhe modelo e idioma, mostra o que está instalado, baixa e remove', async () => {
    ready = false
    await act(async () => root.render(<VoiceSettings />)); await flush()
    const [model, language] = [...host.querySelectorAll('select')]
    expect([...model!.options].map((o) => o.textContent)).toEqual(['Base (148 MB)', 'Small comprimido (190 MB)', 'Small (488 MB)'])
    expect([...language!.options].map((o) => o.value)).toEqual(['app', 'auto', 'pt', 'en', 'es'])
    expect(host.textContent).toContain('Não instalado')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(model, 'small'); model!.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
    expect((window as never as { palco: { preferences: { set: ReturnType<typeof vi.fn> } } }).palco.preferences.set).toHaveBeenCalledWith({ voiceModel: 'small' })
    await click(buttonIn(host, 'Baixar'))
    expect(voice.install).toHaveBeenCalledWith('small')
    await act(async () => { finishInstall() }); await flush()
    expect(host.textContent).toContain('Instalado')
    await click(buttonIn(host, 'Remover do computador'))
    expect(voice.remove).toHaveBeenCalled()
  })
})

describe('WAV', () => {
  it('16 kHz, mono, 16 bits, com os picos cortados no limite', () => {
    const out = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2]), 16000))
    expect([out.getUint16(20, true), out.getUint16(22, true), out.getUint32(24, true), out.getUint16(34, true), out.getUint32(40, true)]).toEqual([1, 1, 16000, 16, 10])
    expect([0, 1, 2, 3, 4].map((i) => out.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768])
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
it('o aviso da primeira vez cobre o chat por inteiro (nada transparece atrás do texto)', () => {
  const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
  expect(css).toMatch(/:root \.chat-confirm\.voice-setup \{[^}]*background: var\(--bg\)/)
})
