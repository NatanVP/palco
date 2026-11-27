import { useEffect, useState } from 'react'
import { bindingFromEvent, formatBinding, SHORTCUTS, type KeyBinding, type ShortcutId } from '../../../shared/shortcuts'
import { adoptPreferences, suspendShortcuts, usePreferences } from './preferences'
import { t, tr } from '../i18n'

export function ShortcutSettings() {
  const p = usePreferences(), [query, setQuery] = useState(''), [recording, setRecording] = useState<ShortcutId | null>(null)
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const bind = async (id: ShortcutId, binding: KeyBinding | null): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.palco.preferences.bind(id, binding)
      adoptPreferences(result.preferences)
      setMessage(result.conflicts.length ? t('settings.ShortcutSettings.conflito_o_novo_atalho_substit', { v1: result.conflicts.map(id => tr(SHORTCUTS.find(d => d.id === id)!.label)).join(', ') }) : t('settings.ShortcutSettings.atalho_salvo'))
    } catch (error) { setMessage(error instanceof Error ? error.message : t('settings.ShortcutSettings.nao_foi_possivel_salvar_o_atal')) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!recording) return
    suspendShortcuts(true)
    const def = SHORTCUTS.find(d => d.id === recording)!
    let modifiers: KeyBinding | null = null
    const capture = (e: KeyboardEvent): void => {
      e.preventDefault(); e.stopImmediatePropagation()
      if (e.key === 'Escape') { setRecording(null); setMessage(t('settings.ShortcutSettings.gravacao_cancelada')); return }
      if (e.isComposing || e.repeat || e.key === 'AltGraph' || (e.ctrlKey && e.altKey && e.getModifierState('AltGraph'))) return
      if (def.kind === 'modifier' || def.kind === 'hold') {
        if (e.type === 'keydown' && ['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) modifiers = { key: '', ...(e.ctrlKey ? { ctrl: true } : {}), ...(e.metaKey ? { meta: true } : {}), ...(e.altKey ? { alt: true } : {}), ...(e.shiftKey ? { shift: true } : {}) }
        if (e.type === 'keyup' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && modifiers) { setRecording(null); void bind(recording, modifiers) }
        if (def.kind === 'modifier' || ['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return
        modifiers = null
      }
      if (e.type !== 'keydown') return
      const binding = bindingFromEvent(e)
      if (binding) { setRecording(null); void bind(recording, binding) }
    }
    const blur = (): void => { setRecording(null); setMessage(t('settings.ShortcutSettings.gravacao_cancelada_ao_perder_f')) }
    window.addEventListener('keydown', capture, true); window.addEventListener('keyup', capture, true); window.addEventListener('blur', blur)
    return () => { suspendShortcuts(false); window.removeEventListener('keydown', capture, true); window.removeEventListener('keyup', capture, true); window.removeEventListener('blur', blur) }
  }, [recording])
  return <section aria-label={t('settings.ShortcutSettings.atalhos_personalizaveis')}>
    <h3 className="settings-section-title">{t('settings.ShortcutSettings.atalhos_personalizaveis')}</h3>
    <p>{t('settings.ShortcutSettings.os_atalhos_respeitam_o_foco_te')}</p>
    <label>{t('settings.ShortcutSettings.buscar_atalho')}<input value={query} onChange={e => setQuery(e.target.value)} /></label>
    <button disabled={busy || !!recording} onClick={() => {
      setBusy(true)
      void window.palco.preferences.resetShortcuts().then(value => { adoptPreferences(value); setMessage(t('settings.ShortcutSettings.padroes_restaurados')) }).catch(error => setMessage(String(error))).finally(() => setBusy(false))
    }}>{t('settings.ShortcutSettings.restaurar_padrao')}</button>
    <p role="status" aria-live="polite">{recording ? t('settings.ShortcutSettings.pressione_uma_tecla_ou_combina') : message}</p>
    <table className="shortcut-table"><thead><tr><th>{t('settings.ShortcutSettings.acao_escopo')}</th><th>{t('settings.ShortcutSettings.teclas')}</th><th>{t('settings.ShortcutSettings.gravar')}</th></tr></thead><tbody>
      {SHORTCUTS.filter(d => `${tr(d.label)} ${d.scope}`.toLowerCase().includes(query.toLowerCase())).map(d => <tr key={d.id}>
        <td>{tr(d.label)}<small>{d.scope}{d.reason ? ` · ${d.reason}` : ''}</small></td>
        <td>{p.shortcuts[d.id].map(b => formatBinding(b, tr('Espaço'))).join(' / ') || t('settings.ShortcutSettings.sem_atalho')}</td>
        <td><button disabled={busy || (!!recording && recording !== d.id) || !!d.reason} aria-label={t('settings.ShortcutSettings.gravar_label', { label: tr(d.label) })} onClick={() => { setMessage(''); setRecording(d.id) }}>{recording === d.id ? t('settings.ShortcutSettings.gravando') : t('settings.ShortcutSettings.gravar')}</button> <button disabled={busy || !!recording || !!d.reason || !p.shortcuts[d.id].length} aria-label={t('settings.ShortcutSettings.limpar_label', { label: tr(d.label) })} onClick={() => void bind(d.id, null)}>{t('settings.ShortcutSettings.limpar')}</button></td>
      </tr>)}
    </tbody></table>
  </section>
}
