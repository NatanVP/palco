import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_DICTATION_SECONDS } from '../../../shared/voice'
import { t } from '../i18n'
import { DICTATE_EVENT } from './events'
import { reason } from './format'
import { recordingToWav } from './wav'

export type DictationState = 'idle' | 'setup' | 'recording' | 'transcribing'
interface Take { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; limit: number; discard: boolean }

/**
 * O ditado de um chat: um toque grava, outro para e transcreve; o texto vai para `onText` (nunca é enviado sozinho).
 * Na primeira vez abre a instalação. Esc ou sair do chat cancela e solta o microfone.
 */
export function useDictation(terminalId: string, onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<DictationState>('idle')
  const stateRef = useRef<DictationState>('idle'), take = useRef<Take | null>(null), alive = useRef(true), busy = useRef(false)
  const move = (next: DictationState): void => { stateRef.current = next; if (alive.current) setState(next) }
  const handlers = useRef({ onText, onError })
  handlers.current = { onText, onError }

  const release = (current: Take): void => { window.clearTimeout(current.limit); for (const track of current.stream.getTracks()) track.stop() }
  const stop = useCallback((discard = false) => {
    const current = take.current
    if (!current) return
    take.current = null
    current.discard = discard
    if (discard) move('idle')
    if (current.recorder.state !== 'inactive') current.recorder.stop()
    release(current)
  }, [])

  const start = useCallback(async () => {
    handlers.current.onError('')
    const status = await window.palco.voice.status()
    if (!status.supported) { handlers.current.onError(t('voice.unsupported')); return }
    if (!status.ready) { move('setup'); return }
    let stream: MediaStream
    try {
      // O main só libera o microfone logo depois deste pedido.
      await window.palco.voice.arm()
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch { handlers.current.onError(t('voice.micError')); return }
    if (!alive.current) { for (const track of stream.getTracks()) track.stop(); return }
    const recorder = new MediaRecorder(stream)
    const current: Take = { recorder, stream, chunks: [], discard: false, limit: window.setTimeout(() => stop(), MAX_DICTATION_SECONDS * 1000 - 1000) }
    recorder.ondataavailable = (e) => { if (e.data.size) current.chunks.push(e.data) }
    recorder.onstop = () => {
      if (current.discard) return
      move('transcribing')
      void recordingToWav(new Blob(current.chunks, { type: recorder.mimeType || 'audio/webm' }))
        .then((wav) => window.palco.voice.transcribe(wav))
        .then((text) => { if (!alive.current) return; if (text) handlers.current.onText(text); else handlers.current.onError(t('voice.nothing')) })
        .catch((error: unknown) => { if (alive.current) handlers.current.onError(reason(error)) })
        .finally(() => move('idle'))
    }
    take.current = current
    recorder.start()
    move('recording')
  }, [stop])

  const toggle = useCallback(() => {
    if (stateRef.current === 'recording') { stop(); return }
    if (stateRef.current !== 'idle' || busy.current) return
    busy.current = true
    void start().catch((error: unknown) => handlers.current.onError(reason(error))).finally(() => { busy.current = false })
  }, [start, stop])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; stop(true) }
  }, [stop])
  useEffect(() => {
    const asked = (e: Event): void => { if ((e as CustomEvent<{ id: string }>).detail.id === terminalId) toggle() }
    window.addEventListener(DICTATE_EVENT, asked)
    return () => window.removeEventListener(DICTATE_EVENT, asked)
  }, [terminalId, toggle])
  useEffect(() => {
    if (state !== 'recording') return
    const escape = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(true) } }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [state, stop])

  return { state, toggle, closeSetup: useCallback(() => move('idle'), []) }
}
