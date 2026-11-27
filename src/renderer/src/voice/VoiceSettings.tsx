import { useEffect, useState } from 'react'
import { VOICE_LANGUAGES, VOICE_MODELS, type ModelId, type VoiceLanguage, type VoiceProgress, type VoiceStatus } from '../../../shared/voice'
import { updatePreferences, usePreferences } from '../settings/preferences'
import { t } from '../i18n'
import { megabytes, modelName, reason, stage } from './format'

const language = (id: VoiceLanguage): string => ({ app: t('voice.language.app'), auto: t('voice.language.auto'), pt: 'Português', en: 'English', es: 'Español' })[id]

/** Geral › Sistema: o ditado local — modelo, idioma, o que está instalado, baixar e remover. */
export function VoiceSettings() {
  const preferences = usePreferences()
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [progress, setProgress] = useState<VoiceProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = (): Promise<void> => Promise.resolve(window.palco.voice?.status()).then((s) => { if (s) setStatus(s) }).catch((e: unknown) => setError(reason(e)))
  useEffect(() => {
    void refresh()
    return window.palco.voice?.onProgress(setProgress)
  }, [preferences.voiceModel])
  if (!status) return null
  const chosen = status.models.find((m) => m.id === preferences.voiceModel)
  const needed = !status.runtime || !chosen?.installed
  const anything = status.runtime || status.models.some((m) => m.installed)
  const run = (action: () => Promise<void>): void => {
    setBusy(true); setError(''); setProgress(null)
    action().catch((e: unknown) => setError(reason(e))).finally(() => { setBusy(false); void refresh() })
  }
  return <section className="voice-settings" aria-label={t('voice.title')}>
    <h3 className="settings-section-title">{t('voice.title')}</h3>
    <p className="voice-note">{t('voice.setup.local')}</p>
    {!status.supported ? <p>{t('voice.unsupported')}</p> : <>
      <label><span>{t('voice.modelLabel')}</span><select value={preferences.voiceModel} disabled={busy} onChange={(e) => void updatePreferences({ voiceModel: e.target.value as ModelId })}>
        {VOICE_MODELS.map((id) => <option key={id} value={id}>{`${modelName(id)} (${megabytes(status.models.find((m) => m.id === id)?.size ?? 0)})`}</option>)}
      </select></label>
      <label><span>{t('voice.languageLabel')}</span><select value={preferences.voiceLanguage} onChange={(e) => void updatePreferences({ voiceLanguage: e.target.value as VoiceLanguage })}>
        {VOICE_LANGUAGES.map((id) => <option key={id} value={id}>{language(id)}</option>)}
      </select></label>
      <ul className="voice-models">{status.models.map((m) => <li key={m.id}><span>{modelName(m.id)}</span><span>{m.installed ? t('voice.installed') : t('voice.notInstalled')}</span></li>)}</ul>
      {busy && <div className="voice-progress" role="status"><progress max={1} value={progress ? progress.received / progress.total : 0} /><span>{progress ? `${stage(progress)} ${Math.round((progress.received / progress.total) * 100)}%` : t('voice.downloading.start')}</span></div>}
      {error && <p className="voice-error" role="alert">{error}</p>}
      <div className="voice-actions">
        {needed && !busy && <button type="button" onClick={() => run(() => window.palco.voice.install(preferences.voiceModel))}>{t('voice.download')}</button>}
        {busy && <button type="button" onClick={() => void window.palco.voice.cancel()}>{t('voice.cancel')}</button>}
        {anything && !busy && <button type="button" onClick={() => run(() => window.palco.voice.remove())}>{t('voice.remove')}</button>}
      </div>
    </>}
  </section>
}
