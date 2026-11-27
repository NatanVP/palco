import { AgentOptions } from '../../dialogs/AgentOptions'
import { useState } from 'react'
import { WandSparkles } from 'lucide-react'
import type { Preset } from '../../../../shared/model'
import type { Appearance } from '../../../../shared/appearance'
import { presetIcon } from '../../../../shared/presets'
import { agentForCommand } from '../../../../shared/agent-command'
import { COLORS, DEFAULT_COLOR } from '../../dialogs/new-terminal'
import { lucideIcon, TerminalIcon } from '../../nodes/terminal-icons'
import { ThemeCards } from '../controls/ThemePicker'
import { InfoButton } from '../controls/InfoButton'
import { Toggle } from '../controls/Toggle'
import { usePreferences } from '../preferences'
import { t, tr } from '../../i18n'

/** Os 40 desenhos da grade, na ordem do palco (nomes do lucide). O primeiro item da grade é o seletor de emoji. */
export const PICKER_ICONS = [
  'terminal', 'sparkle', 'brain', 'badge-check', 'messages-square', 'settings', 'rectangle-vertical', 'server', 'globe', 'hammer', 'wrench', 'zap', 'cpu', 'memory-stick', 'laptop', 'monitor',
  'paintbrush', 'folder', 'file-text', 'box', 'shield-check', 'eye', 'wand-sparkles', 'drama', 'contact', 'lightbulb', 'leaf', 'flask-conical', 'graduation-cap', 'library', 'chart-column',
  'radio-tower', 'pencil-ruler', 'test-tube', 'stethoscope', 'eighth-notes', 'eighth-note', 'camera', 'gamepad-2', 'flag'
] as const
const isEmoji = (icon: string): boolean => !/^[a-z0-9-]+$/.test(icon) && !lucideIcon(icon)

export function IconPicker({ value, onPick }: { value: string; onPick(icon: string): void }) {
  const [open, setOpen] = useState(false), [text, setText] = useState('')
  const use = (): void => { const v = [...text.trim()].slice(0, 8).join(''); if (v) onPick(v); setOpen(false); setText('') }
  return <fieldset className="preset-field">
    <legend>{t('settings.tabs.presets-panel.icone')}</legend>
    <div className="preset-icon-grid" role="group" aria-label={t('settings.tabs.presets-panel.icone')}>
      <button type="button" className="preset-emoji" aria-label={t('settings.preset.escolher_emoji')} aria-pressed={isEmoji(value)} aria-expanded={open} onClick={() => setOpen(o => !o)}>{isEmoji(value) ? value : '😀'}</button>
      {PICKER_ICONS.map(name => <button key={name} type="button" aria-label={name} aria-pressed={value === name} onClick={() => onPick(name)}><TerminalIcon icon={name} size={16} /></button>)}
    </div>
    {open && <div className="preset-emoji-entry">
      <input autoFocus aria-label={t('settings.preset.emoji')} placeholder="😀" maxLength={16} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); use() } }} />
      <button type="button" disabled={!text.trim()} onClick={use}>{t('settings.preset.usar')}</button>
    </div>}
  </fieldset>
}

export function ColorRow({ value, onPick }: { value: string; onPick(color: string): void }) {
  const custom = !COLORS.some(c => c.hex.toLowerCase() === value.toLowerCase())
  return <fieldset className="preset-field">
    <legend>{t('settings.tabs.presets-panel.cor')}</legend>
    <div className="preset-colors">
      {COLORS.map(c => <button key={c.hex} type="button" aria-label={tr(c.name)} title={tr(c.name)} aria-pressed={!custom && c.hex.toLowerCase() === value.toLowerCase()} style={{ background: c.hex }} onClick={() => onPick(c.hex)} />)}
      <label className={`preset-rainbow${custom ? ' active' : ''}`} title={t('settings.preset.cor_personalizada')}><input type="color" aria-label={t('settings.preset.cor_personalizada')} value={value} onChange={e => onPick(e.target.value.toUpperCase())} /></label>
    </div>
  </fieldset>
}

function FontFields({ family, size, familyLabel, sizeLabel, min, max, fallback, onFamily, onSize }: { family: string; size: number | undefined; familyLabel: string; sizeLabel: string; min: number; max: number; fallback: number; onFamily(v: string): void; onSize(v: number | undefined): void }) {
  const now = size ?? fallback, put = (n: number): void => { const next = Math.min(max, Math.max(min, n)); onSize(next === fallback ? undefined : next) }
  return <>
    <div className="settings-option"><div className="settings-row"><span className="settings-label">{t('settings.preset.familia')}</span>
      <input aria-label={familyLabel} value={family} placeholder={t('settings.tabs.presets-panel.herdar_2')} onChange={e => onFamily(e.target.value)} /></div></div>
    <div className="settings-option"><div className="settings-row"><span className="settings-label">{t('settings.preset.tamanho')}</span>
      <span className="settings-stepper"><button type="button" aria-label={`${sizeLabel} −`} disabled={now <= min} onClick={() => put(now - 1)}>−</button>
        <input type="number" aria-label={sizeLabel} min={min} max={max} value={now} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= min && n <= max) put(n) }} /><span className="settings-unit" aria-hidden="true">pt</span>
        <button type="button" aria-label={`${sizeLabel} +`} disabled={now >= max} onClick={() => put(now + 1)}>+</button></span></div></div>
  </>
}

export interface PresetDraft { name: string; command: string; maestro: boolean; startInChat: boolean; appearance: Appearance }

/** Novo/Editar Preset: abre dentro da aba com Detalhes e Aparência. O que não for mudado continua herdando das Configurações. */
export function PresetEditor({ initial, onSave, onCancel }: { initial?: Preset; onSave(draft: PresetDraft): Promise<void>; onCancel(): void }) {
  const p = usePreferences()
  const [tab, setTab] = useState<'details' | 'appearance'>('details'), [face, setFace] = useState<'terminal' | 'chat'>('terminal')
  const [name, setName] = useState(initial?.name ?? ''), [command, setCommand] = useState(initial?.command ?? ''), [maestro, setMaestro] = useState(initial?.maestro === true), [startInChat, setStartInChat] = useState(initial?.startInChat === true)
  const [look, setLook] = useState<Appearance>(initial?.appearance ?? {}), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const title = initial ? t('settings.preset.editar_preset') : t('settings.tabs.presets-panel.novo_preset')
  /** `undefined` ou vazio tira o campo (volta a herdar). */
  const put = (patch: { [K in keyof Appearance]?: Appearance[K] | undefined }): void => setLook(l => {
    const next: Record<string, unknown> = { ...l, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k]
    return next as Appearance
  })
  const icon = look.icon ?? presetIcon({ name: initial?.name ?? name, agent: agentForCommand(command) })
  const themeId = look.themeId ?? p.defaultTerminalTheme, darkId = look.themeId !== undefined ? (look.darkThemeId ?? null) : p.defaultTerminalDarkThemeId
  const pickTheme = (theme: string, dark: string | null): void => {
    const inherits = theme === p.defaultTerminalTheme && dark === p.defaultTerminalDarkThemeId
    put(inherits ? { themeId: undefined, darkThemeId: undefined } : { themeId: theme, darkThemeId: dark ?? undefined })
  }
  const save = (): void => {
    setBusy(true); setError('')
    void onSave({ name: name.trim(), command: command.trim(), maestro, startInChat, appearance: look }).catch(e => { setBusy(false); setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : t('settings.tabs.presets-panel.nao_foi_possivel_salvar')) })
  }
  const tabs = <div className="settings-segmented is-full preset-editor-tabs">{(['details', 'appearance'] as const).map(id => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{id === 'details' ? t('settings.tabs.presets-panel.detalhes') : t('settings.tabs.presets-panel.aparencia')}</button>)}</div>
  return <div className="preset-editor" role="group" aria-label={title} data-inline-editor="" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } }}>
    <h3>{title}</h3>
    {tabs}
    {tab === 'details' ? <>
      <label className="preset-field"><span>{t('settings.preset.nome')}</span><input autoFocus aria-label={t('settings.tabs.presets-panel.nome_do_preset')} maxLength={120} value={name} placeholder={t('settings.tabs.presets-panel.nome_do_preset')} onChange={e => setName(e.target.value)} /></label>
      <label className="preset-field"><span>{t('settings.tabs.presets-panel.comando')}</span><input className="is-mono" aria-label={t('settings.tabs.presets-panel.comando')} value={command} spellCheck={false} placeholder={t('settings.tabs.presets-panel.claude_aider')} onChange={e => setCommand(e.target.value)} /></label>
      <AgentOptions agent={agentForCommand(command)} command={command} onChange={setCommand} />
      <div className="settings-option is-switch preset-maestro"><div className="settings-row"><div className="settings-text">
        <span className="settings-label">{t('settings.preset.maestro')} <WandSparkles size={14} className="preset-wand" aria-hidden="true" /><InfoButton label={t('settings.preset.sobre_maestro')} text={t('settings.preset.maestro_info')} /></span>
        <small className="settings-hint">{t('settings.preset.maestro_dica')}</small></div>
        <Toggle label={t('settings.tabs.presets-panel.modo_maestro')} checked={maestro} onChange={setMaestro} /></div></div>
    </> : <>
      <IconPicker value={icon} onPick={v => put({ icon: v })} />
      <ColorRow value={look.color ?? DEFAULT_COLOR} onPick={v => put({ color: v })} />
      <div className="preset-faces"><div className="settings-segmented">{(['terminal', 'chat'] as const).map(id => <button key={id} type="button" aria-pressed={face === id} onClick={() => setFace(id)}>{id === 'terminal' ? 'Terminal' : 'Chat'}</button>)}</div></div>
      {face === 'terminal' ? <>
        <fieldset className="preset-field"><legend>{t('settings.controls.ThemePicker.tema')}</legend><ThemeCards value={themeId} darkId={darkId} onPick={pickTheme} /></fieldset>
        <FontFields family={look.fontFamily ?? ''} size={look.fontSize} familyLabel={t('settings.tabs.presets-panel.fonte_do_terminal')} sizeLabel={t('settings.tabs.presets-panel.tamanho_do_terminal')} min={8} max={32} fallback={p.terminalFontSize} onFamily={v => put({ fontFamily: v })} onSize={v => put({ fontSize: v })} />
      </> : <>
        <div className="settings-option is-switch"><div className="settings-row"><div className="settings-text"><span className="settings-label">{t('settings.tabs.presets-panel.iniciar_no_modo_de_chat')}</span></div>
          <Toggle label={t('settings.tabs.presets-panel.iniciar_no_modo_de_chat')} checked={startInChat} onChange={setStartInChat} /></div></div>
        <FontFields family={look.chatFontFamily ?? ''} size={look.chatFontSize} familyLabel={t('settings.tabs.presets-panel.fonte_do_chat')} sizeLabel={t('settings.tabs.presets-panel.tamanho_do_chat')} min={8} max={32} fallback={p.chatFontSize} onFamily={v => put({ chatFontFamily: v })} onSize={v => put({ chatFontSize: v })} />
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
    <div className="preset-editor-footer"><button type="button" className="is-ghost" disabled={busy} onClick={onCancel}>{t('settings.tabs.presets-panel.cancelar')}</button>
      <button type="button" className="is-primary" disabled={!name.trim() || busy} onClick={save}>{t('settings.tabs.presets-panel.salvar')}</button></div>
  </div>
}
