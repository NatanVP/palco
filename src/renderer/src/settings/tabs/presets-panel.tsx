import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Circle, CircleCheck, Plus, RotateCcw, SquarePen, Trash2 } from 'lucide-react'
import type { Preset } from '../../../../shared/model'
import { BUILTIN_PRESETS, MAX_ACTIVE_PRESETS, presetIcon } from '../../../../shared/presets'
import { TerminalIcon } from '../../nodes/terminal-icons'
import { SettingsConfirm } from '../controls/SettingsModal'
import { SettingsSection } from '../controls/Section'
import { PresetEditor } from './preset-editor'
import { t } from '../../i18n'

/** Os embutidos que ainda não foram gravados aparecem na frente (como o Novo Terminal já os mostra); mexer neles os grava. */
export function presetRows(stored: readonly Preset[]): Array<Preset & { builtin: boolean }> {
  const has = new Set(stored.map(p => p.name.toLowerCase()))
  return [...BUILTIN_PRESETS.filter(b => !has.has(b.name.toLowerCase())).map(b => ({ ...b, builtin: true })), ...stored.map(p => ({ ...p, builtin: false }))]
}

/** Terminal › Início Rápido: os presets do Novo Terminal. Liga/desliga (máx. 10 ativos), reordena, edita, exclui e restaura os embutidos. */
export function PresetsPanel() {
  const [stored, setStored] = useState<Preset[]>([]), [error, setError] = useState(''), [form, setForm] = useState<{ initial?: Preset } | null>(null), [removing, setRemoving] = useState<string | null>(null), [resetting, setResetting] = useState(false)
  const api = window.palco.presets
  const reload = useCallback(async () => { try { setStored(await api.list()); setError('') } catch { setError(t('settings.tabs.presets-panel.nao_foi_possivel_carregar_a_li')) } }, [api])
  useEffect(() => { void reload() }, [reload])
  const rows = presetRows(stored), missing = rows.filter(r => r.builtin).length > 0
  const active = rows.filter(r => r.quickStart !== false).length
  const run = async (job: () => Promise<unknown>): Promise<void> => { try { await job(); setError('') } catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : t('settings.tabs.presets-panel.falhou')) } await reload() }
  /** Mexer na ordem (ou num embutido) grava os embutidos que faltam antes. */
  const ensure = async (): Promise<void> => { if (missing) await api.restoreDefaults() }
  const move = (name: string, dir: -1 | 1): Promise<void> => run(async () => {
    await ensure()
    const names = (await api.list()).map(p => p.name), i = names.indexOf(name), j = i + dir
    if (i < 0 || j < 0 || j >= names.length) return
    ;[names[i], names[j]] = [names[j]!, names[i]!]
    await api.reorder(names)
  })
  const close = (): void => { setForm(null) }
  if (form) return <PresetEditor {...(form.initial ? { initial: form.initial } : {})} onCancel={close} onSave={async v => {
    if (form.initial) await api.set(form.initial.name, { newName: v.name, command: v.command, maestro: v.maestro, startInChat: v.startInChat, appearance: v.appearance })
    else await api.create({ name: v.name, command: v.command, ...(v.maestro ? { maestro: true } : {}), ...(v.startInChat ? { startInChat: true } : {}), ...(Object.keys(v.appearance).length ? { appearance: v.appearance } : {}) })
    await reload(); close()
  }} />
  return <SettingsSection title={t('settings.preset.titulo_da_lista')}>
    <p className="settings-hint">{t('settings.tabs.presets-panel.ate_n_presets', { max: MAX_ACTIVE_PRESETS })}</p>
    {error && <p role="alert">{error}</p>}
    <ul className="preset-card" aria-label={t('settings.tabs.presets-panel.presets')}>{rows.map((r, i) => {
      const on = r.quickStart !== false, full = !on && active >= MAX_ACTIVE_PRESETS
      return <li key={r.name} data-preset={r.name} className={on ? '' : 'inactive'}>
        <button type="button" role="checkbox" className="preset-active" aria-checked={on} aria-label={t('settings.tabs.presets-panel.alternar_name_como_preset_ativ', { name: r.name })} disabled={full} title={full ? t('settings.tabs.presets-panel.maximo_de_max_active_presets_p', { MAX_ACTIVE_PRESETS }) : undefined}
          onClick={() => { void run(async () => { await ensure(); await api.set(r.name, { quickStart: !on }) }) }}>{on ? <CircleCheck size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}</button>
        <span className="preset-icon"><TerminalIcon icon={presetIcon(r)} size={16} /></span>
        <span className="preset-text"><span className="preset-name">{r.name}</span>{r.command && <span className="preset-command">{r.command}</span>}</span>
        <span className="preset-actions">
          <button type="button" aria-label={t('settings.tabs.presets-panel.mover_name_para_cima', { name: r.name })} disabled={i === 0} onClick={() => void move(r.name, -1)}><ChevronUp size={16} aria-hidden="true" /></button>
          <button type="button" aria-label={t('settings.tabs.presets-panel.mover_name_para_baixo', { name: r.name })} disabled={i === rows.length - 1} onClick={() => void move(r.name, 1)}><ChevronDown size={16} aria-hidden="true" /></button>
          <button type="button" aria-label={t('settings.tabs.presets-panel.editar_name', { name: r.name })} onClick={() => void run(async () => { await ensure(); const p = (await api.list()).find(x => x.name === r.name); if (p) setForm({ initial: p }) })}><SquarePen size={14} aria-hidden="true" /></button>
          <button type="button" aria-label={t('settings.tabs.presets-panel.excluir_name', { name: r.name })} onClick={() => setRemoving(r.name)}><Trash2 size={14} aria-hidden="true" /></button>
        </span>
      </li>
    })}</ul>
    <div className="preset-footer"><button type="button" onClick={() => setForm({})}><Plus size={14} aria-hidden="true" />{t('settings.tabs.presets-panel.adicionar_preset')}</button>
      <button type="button" className="is-ghost" onClick={() => setResetting(true)}><RotateCcw size={14} aria-hidden="true" />{t('settings.controls.OptionRow.redefinir_para_padrao')}</button></div>
    {removing && <SettingsConfirm title={t('settings.tabs.presets-panel.excluir_preset')} body={t('settings.tabs.presets-panel.removing_deixa_de_aparecer_ao_', { removing })} confirmLabel={t('settings.tabs.presets-panel.excluir')} danger
      onCancel={() => setRemoving(null)} onConfirm={() => { const name = removing; setRemoving(null); void run(async () => { await ensure(); await api.remove(name) }) }} />}
    {resetting && <SettingsConfirm title={t('settings.preset.redefinir_titulo')} body={t('settings.preset.redefinir_corpo')} confirmLabel={t('settings.preset.redefinir')} danger
      onCancel={() => setResetting(false)} onConfirm={() => { setResetting(false); void run(() => api.resetDefaults()) }} />}
  </SettingsSection>
}
