import { MAX_DICTATION_SECONDS, VOICE_MODELS, type ModelId } from '../../shared/voice'
import { whisperLanguage } from '../voice/transcribe'
import type { IpcArea } from './area'

export const VOICE_CH = { status: 'palco:voice:status', install: 'palco:voice:install', cancel: 'palco:voice:cancel', remove: 'palco:voice:remove', arm: 'palco:voice:arm', transcribe: 'palco:voice:transcribe', progress: 'palco:voice:progress' } as const

/** O ditado local. Só o download toca a rede (endereços fixados); o áudio fica neste computador. */
export const voiceArea: IpcArea = ({ handle, send, deps }) => {
  const voice = () => { if (!deps.voice) throw new Error('o ditado não está disponível nesta plataforma'); return deps.voice }
  const model = (): ModelId => deps.preferences!.get().voiceModel
  handle(VOICE_CH.status, () => voice().service.status(model()))
  handle(VOICE_CH.install, (id) => {
    if (!(VOICE_MODELS as readonly unknown[]).includes(id)) throw new Error('modelo de ditado desconhecido')
    let last = 0
    return voice().service.install(id as ModelId, (p) => {
      // Um aviso por ponto percentual basta para a barra.
      const step = Math.floor((p.received / p.total) * 100)
      if (step !== last || p.received === p.total) { last = step; send(VOICE_CH.progress, p) }
    })
  })
  handle(VOICE_CH.cancel, () => voice().service.cancel())
  handle(VOICE_CH.remove, () => voice().service.remove())
  handle(VOICE_CH.arm, () => voice().gate.arm())
  handle(VOICE_CH.transcribe, (audio) => {
    if (!(audio instanceof ArrayBuffer || ArrayBuffer.isView(audio)) || audio.byteLength > 44 + MAX_DICTATION_SECONDS * 32_000) throw new Error('áudio inválido: esperado WAV mono de 16 kHz e até dez minutos')
    const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)
    return voice().service.transcribe(bytes, { model: model(), language: whisperLanguage(deps.preferences!.get().voiceLanguage, voice().locale()) })
  })
}
