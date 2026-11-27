import { useEffect, useState } from 'react'
import { VOICE_MODELS, type ModelId, type VoiceProgress, type VoiceStatus } from '../../../shared/voice'
import { updatePreferences, usePreferences } from '../settings/preferences'
import { t } from '../i18n'
import { megabytes, modelName, reason, stage } from './format'

/** Primeira vez: o que será baixado, o tamanho, o andamento. Nada é baixado sem o clique em "Baixar". */
export function VoiceSetup({ onClose }: { onClose(): void }) {
  const preferences = usePreferences()
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [progress, setProgress] = useState<VoiceProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const model = preferences.voiceModel
  useEffect(() => {
    void window.palco.voice.status().then(setStatus)
    return window.palco.voice.onProgress(setProgress)
  }, [])
  const size = status?.models.find((m) => m.id === model)?.size ?? 0
  const runtime = status && !status.runtime ? status.runtimeSize : 0
  const download = (): void => {
    setBusy(true); setError(''); setProgress(null)
    window.palco.voice.install(model).then(onClose).catch((e: unknown) => { setError(reason(e)); setBusy(false) })
  }
  const cancel = (): void => { if (busy) void window.palco.voice.cancel(); onClose() }
  return <div className="chat-confirm voice-setup" role="dialog" aria-label={t('voice.title')} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancel() } }}>
    <strong>{t('voice.title')}</strong>
    <p>{runtime ? t('voice.setup.both', { runtime: megabytes(runtime), model: megabytes(size), total: megabytes(runtime + size) }) : t('voice.setup.model', { model: megabytes(size) })}</p>
    <p className="voice-note">{t('voice.setup.local')}</p>
    <select aria-label={t('voice.modelLabel')} value={model} disabled={busy} onChange={(e) => void updatePreferences({ voiceModel: e.target.value as ModelId })}>
      {VOICE_MODELS.map((id) => <option key={id} value={id}>{modelName(id)}</option>)}
    </select>
    {busy && <div className="voice-progress" role="status">
      <progress max={1} value={progress ? progress.received / progress.total : 0} />
      <span>{progress ? `${stage(progress)} ${Math.round((progress.received / progress.total) * 100)}%` : t('voice.downloading.start')}</span>
    </div>}
    {error && <p className="voice-error" role="alert">{error}</p>}
    <div><button type="button" onClick={cancel}>{t('voice.cancel')}</button>{!busy && <button type="button" className="primary" disabled={!status} onClick={download}>{t('voice.download')}</button>}</div>
  </div>
}
