import { LoaderCircle, Mic, Square } from 'lucide-react'
import { formatBinding } from '../../../shared/shortcuts'
import { usePreferences } from '../settings/preferences'
import { t, tr } from '../i18n'
import type { DictationState } from './useDictation'

/** O microfone do compositor: grava, para, ou mostra que está transcrevendo. */
export function MicButton({ state, onClick }: { state: DictationState; onClick(): void }) {
  const bindings = usePreferences().shortcuts.dictate.map((b) => formatBinding(b, tr('Espaço')))
  const label = state === 'recording' ? t('voice.stop') : state === 'transcribing' ? t('voice.transcribing') : t('voice.dictate')
  return (
    <button type="button" className={`chat-mic${state === 'recording' ? ' recording' : ''}`} aria-label={label} title={bindings.length ? `${label} (${bindings.join(' / ')})` : label}
      aria-pressed={state === 'recording'} disabled={state === 'transcribing'} onClick={onClick}>
      {state === 'recording' ? <Square size={13} aria-hidden="true" fill="currentColor" /> : state === 'transcribing' ? <LoaderCircle size={16} className="voice-spin" aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
    </button>
  )
}
