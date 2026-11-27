import { useState } from 'react'
import { defaultPreferences, type Preferences } from '../../../../shared/preferences'
import type { OptionDef } from '../options'
import { updatePreferences, usePreferences } from '../preferences'
import { ConfirmDialog } from './ConfirmDialog'
import { ThemePicker } from './ThemePicker'
import { useLocalFontFaces, useLocalFonts } from './local-fonts'
import { facesOf, familyOf } from './font-faces'
import { t } from '../../i18n'
import { RotateCcw } from 'lucide-react'
import { Toggle } from './Toggle'
import { InfoButton } from './InfoButton'

/** Botão de reset de uma opção: só aparece quando o valor difere do padrão. */
export function ResetButton({ label, onReset, disabled, ariaLabel }: { label: string; onReset(): void; disabled?: boolean; ariaLabel?: string }) {
  const name = ariaLabel ?? t('settings.controls.OptionRow.redefinir_label_para_padrao', { label })
  return <button type="button" className="settings-reset" aria-label={name} title={name} disabled={disabled} onClick={onReset}><RotateCcw size={12} aria-hidden="true" /><span className="sr-only">{t('settings.controls.OptionRow.redefinir_para_padrao')}</span></button>
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const unitLabel = (u?: string): string => (u ? ` (${u})` : '')

/**
 * Uma linha da janela, montada a partir do `OptionDef`: rótulo, controle do tipo certo, dica, reset e, se a opção ainda
 * não tem efeito, o controle desabilitado com o motivo. Grava por `updatePreferences` (patch validado no main).
 */
export function OptionRow({ def }: { def: OptionDef }) {
  const p = usePreferences(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [lowering, setLowering] = useState<{ mb: number; count: number } | null>(null)
  const isFont = def.key === 'terminalFontFamily' || def.key === 'chatFontFamily'
  const fonts = useLocalFonts(isFont)
  const value = (p as Record<string, unknown>)[def.key], standard = (defaultPreferences() as unknown as Record<string, unknown>)[def.key]
  const allFaces = useLocalFontFaces(isFont), current = typeof value === 'string' ? value : ''
  const faces = facesOf(allFaces, current)
  const off = !def.ready || busy
  const save = (patch: Partial<Preferences>): void => {
    setBusy(true); setError('')
    void updatePreferences(patch).catch(e => setError(e instanceof Error ? e.message : t('settings.controls.OptionRow.nao_foi_possivel_salvar'))).finally(() => setBusy(false))
  }
  const set = (v: unknown): void => save({ [def.key]: v } as Partial<Preferences>)
  // Resets que mexem em mais de um campo (o horizontal devolve a herança do sistema; o tema zera o par).
  const special: { visible: boolean; patch: Partial<Preferences>; aria?: string } | undefined =
    def.key === 'terminalPaddingHorizontal' ? { visible: value !== 0 || !p.usesSystemHorizontalTerminalPadding, patch: { terminalPaddingHorizontal: 0, usesSystemHorizontalTerminalPadding: true }, aria: t('settings.controls.OptionRow.redefinir_o_espacamento_horizo') }
      : def.key === 'terminalPaddingVertical' ? { visible: value !== 0, patch: { terminalPaddingVertical: 0 }, aria: t('settings.controls.OptionRow.redefinir_o_espacamento_vertic') }
        : def.key === 'chatFontFamily' || def.key === 'chatFontSize' ? { visible: p.chatFontFamily !== '' || p.chatFontSize !== 13, patch: { chatFontFamily: '', chatFontSize: 13 } }
          : def.key === 'defaultTerminalTheme' ? { visible: value !== 'system' || p.defaultTerminalDarkThemeId !== null, patch: { defaultTerminalTheme: 'system', defaultTerminalDarkThemeId: null } }
          : undefined
  // Baixar o limite de memória com terminais já acima dele pede confirmação (eles perderiam os processos filhos).
  const commitNumber = (n: number): void => {
    if (def.key === 'memoryLimitMB' && n < Number(value)) {
      void window.palco.terminal.countAboveMemory(n).then(count => { if (count > 0) setLowering({ mb: n, count }); else set(n) }).catch(() => set(n))
      return
    }
    set(n)
  }
  const hintId = `${def.key}-note`, c = def.control
  let control: React.ReactNode
  if (c.kind === 'switch') {
    control = <Toggle label={def.label} aria-describedby={hintId} checked={Boolean(value)} disabled={off} onChange={set} />
  } else if (c.kind === 'select') {
    const current = value === null || value === undefined ? '' : String(value)
    control = <select aria-label={def.label} aria-describedby={hintId} value={current} disabled={off} onChange={e => {
      const chosen = c.options.find(o => String(o.value) === e.target.value)
      set(chosen && chosen.value !== '' ? chosen.value : null)
    }}>{c.options.map(o => <option key={String(o.value)} value={String(o.value)} disabled={!!o.pending} title={o.pending}>{o.label}{o.pending ? ` ${t('settings.controls.OptionRow.em_breve')}` : ''}</option>)}</select>
  } else if (c.kind === 'number') {
    const on = value !== null && value !== undefined
    const step = c.step ?? 1, now = on ? Number(value) : c.min, still = off || (c.nullable === true && !on)
    const nudge = (d: number): void => { const next = Math.min(c.max, Math.max(c.min, now + d)); if (next !== value) commitNumber(next) }
    control = <span className="settings-inline">
      {c.nullable && <Toggle label={t('settings.controls.OptionRow.label_usar_valor_proprio', { label: def.label })} checked={on} disabled={off} onChange={checked => set(checked ? (c.fallback ?? c.min) : null)} />}
      <span className="settings-stepper" role="group" aria-label={def.label}>
        <button type="button" aria-label={`${def.label} −`} disabled={still || now <= c.min} onClick={() => nudge(-step)}>−</button>
        <input key={String(value)} type="number" aria-label={`${def.label}${unitLabel(c.unit)}`} aria-describedby={hintId} min={c.min} max={c.max} step={step} defaultValue={on ? Number(value) : ''}
          disabled={still} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) !== value) commitNumber(Number(e.target.value)) }} />
        {c.unit && <span className="settings-unit" aria-hidden="true">{c.unit}</span>}
        <button type="button" aria-label={`${def.label} +`} disabled={still || now >= c.max} onClick={() => nudge(step)}>+</button>
      </span>
    </span>
  } else if (c.kind === 'theme') {
    control = <ThemePicker disabled={off} />
  } else if (c.kind === 'text') {
    control = <input key={String(value)} type="text" aria-label={def.label} aria-describedby={hintId} placeholder={c.placeholder} list={fonts.length ? 'local-fonts' : undefined} maxLength={1024} defaultValue={value === null ? '' : String(value)} disabled={off}
      onBlur={e => { const v = e.target.value; if (v === (value ?? '')) return; if (v === '' && c.nullable) set(null); else if (v !== '') set(v) }} />
  } else {
    const size = value as { width: number; height: number }
    control = <span className="settings-inline">
      {(['width', 'height'] as const).map(k => <input key={`${k}${size[k]}`} type="number" aria-label={t(k === 'width' ? 'settings.controls.OptionRow.rotulo_largura' : 'settings.controls.OptionRow.rotulo_altura', { label: def.label })} min={100} max={4000} defaultValue={size[k]} disabled={off}
        onBlur={e => { if (Number(e.target.value) !== size[k]) set({ ...size, [k]: Number(e.target.value) }) }} />)}
    </span>
  }
  // Na chave a descrição fica ao lado dela; nos outros controles, embaixo da linha inteira.
  const note = (def.hint || !def.ready || error) ? <small id={hintId} className="settings-hint" role={error ? 'alert' : undefined}>{error || (!def.ready ? def.pending : def.hint)}{!error && !def.ready && def.hint ? ` ${def.hint}` : ''}</small> : null
  const beside = c.kind === 'switch'
  // O reset por opção fica em Terminal › Aparência.
  const resettable = def.tab === 'terminal' && def.section === 'Aparência'
  return <div className={`settings-option${beside ? ' is-switch' : ''}${c.kind === 'theme' ? ' is-block' : ''}`} data-option={def.key}>
    <div className="settings-row"><div className="settings-text"><span className="settings-label">{def.label}{def.info && <InfoButton label={`${def.label}: (i)`} text={def.info} />}</span>{beside && note}</div>
      <span className="settings-controls">{isFont && faces.length > 0 && <select className="font-style" aria-label={t('settings.controls.OptionRow.estilo_label', { label: def.label })} value={faces.some(f => f.value === value) ? String(value) : ''} disabled={off} onChange={e => set(e.target.value === '' ? (familyOf(allFaces, current) ?? current) : e.target.value)}><option value="">{t('settings.controls.OptionRow.padrao')}</option>{faces.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>}{resettable && def.ready && (special ? special.visible : !same(value, standard)) && <ResetButton label={def.label} {...(special?.aria ? { ariaLabel: special.aria } : {})} disabled={busy} onReset={() => (special ? save(special.patch) : set(standard))} />}{control}</span></div>
    {fonts.length > 0 && <datalist id="local-fonts">{fonts.map(f => <option key={f} value={f} />)}</datalist>}
    {lowering && <ConfirmDialog title={t('settings.controls.OptionRow.reduzir_o_limite_de_memoria')} body={t('settings.controls.OptionRow.reduzir_corpo', { count: lowering.count, mb: lowering.mb })} confirmLabel={t('settings.controls.OptionRow.reduzir_limite')} danger onConfirm={() => { const mb = lowering.mb; setLowering(null); set(mb) }} onCancel={() => setLowering(null)} />}
    {!beside && note}
  </div>
}
