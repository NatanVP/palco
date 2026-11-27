import { Plus } from 'lucide-react'
import { Toggle } from './Toggle'
import { useState } from 'react'
import { isLightTheme, resolveTerminalTheme, THEMES, type TerminalTheme } from '../../../../shared/terminal-themes'
import { updatePreferences, usePreferences } from '../preferences'
import { t, tr } from '../../i18n'

/** Miniatura do tema: as oito primeiras cores ANSI e um mini prompt com o cursor (o texto vem do CSS, para não virar rótulo do botão). */
export function ThemeSwatch({ theme }: { theme: TerminalTheme }) {
  const c = theme.colors
  return <span className="theme-swatch" style={{ background: c.background, color: c.foreground }} aria-hidden="true">
    <span className="theme-swatch-ansi">{c.ansiPalette.slice(0, 8).map((color, i) => <i key={i} style={{ background: color }} />)}</span>
    <span className="theme-swatch-dir" />
    <span className="theme-swatch-prompt" style={{ color: c.ansiPalette[2] }}><i style={{ background: c.cursor }} /></span>
  </span>
}

/** Saída de exemplo da prévia: é uma amostra de terminal (em inglês, como o git escreve), não texto da interface. */
const SAMPLE = { user: 'voce@palco', dir: '~/projetos/palco', command: '$ git status', branch: 'On branch main', modified: 'src/theme.ts', added: 'src/preview.ts' }
/** Prévia maior: uma saída de terminal de exemplo nas cores do tema. */
export function ThemePreview({ theme, label }: { theme: TerminalTheme; label: string }) {
  const c = theme.colors, [, red, green, yellow, blue, , cyan] = c.ansiPalette
  return <div className="theme-preview" role="img" aria-label={label} style={{ background: c.background, color: c.foreground }}>
    <div><span style={{ color: green }}>{SAMPLE.user}</span>:<span style={{ color: blue }}>{SAMPLE.dir}</span>{SAMPLE.command}</div>
    <div style={{ color: yellow }}>{SAMPLE.branch}</div>
    <div><span style={{ color: red }}>{'  modified:   '}</span>{SAMPLE.modified}</div>
    <div><span style={{ color: green }}>{'  added:      '}</span><span style={{ color: cyan }}>{SAMPLE.added}</span></div>
    <div>$ <i style={{ background: c.cursor }} /></div>
  </div>
}

type Side = 'light' | 'dark'
/** Os temas de um lado do par: os claros (ou escuros) e as duas bases. */
const forSide = (side: Side): TerminalTheme[] => THEMES.filter((t, i) => i < 2 || isLightTheme(t) === (side === 'light'))

function CustomThemeModal({ value, darkId, onCommit, onClose }: { value: string; darkId: string | null; onCommit(theme: string, dark: string | null): Promise<void> | void; onClose(): void }) {
  const paired = darkId !== null
  const [pair, setPair] = useState(paired), [side, setSide] = useState<Side>('light')
  const [single, setSingle] = useState<string | null>(!paired && THEMES.some(t => t.id === value) ? value : null)
  const [light, setLight] = useState<string | null>(paired ? value : null)
  const [dark, setDark] = useState<string | null>(darkId)
  const [error, setError] = useState('')
  const ready = pair ? light !== null && dark !== null : single !== null
  const list = pair ? forSide(side) : THEMES
  const chosen = pair ? (side === 'light' ? light : dark) : single
  const choose = (id: string): void => { if (!pair) setSingle(id); else if (side === 'light') setLight(id); else setDark(id) }
  const commit = (): void => {
    void Promise.resolve(onCommit(pair ? light! : single!, pair ? dark! : null)).then(onClose).catch(e => setError(e instanceof Error ? e.message : t('settings.controls.ThemePicker.nao_foi_possivel_salvar')))
  }
  return <div className="settings-confirm-back" onPointerDown={e => e.stopPropagation()}>
    <div className="settings-confirm theme-modal" role="dialog" aria-modal="true" aria-label={t('settings.controls.ThemePicker.tema_personalizado')} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <header><h3>{t('settings.controls.ThemePicker.tema_personalizado')}</h3><button type="button" aria-label={t('settings.controls.ThemePicker.fechar')} onClick={onClose}>{t('settings.controls.ThemePicker.fechar')}</button></header>
      <label className="settings-inline"><Toggle label={t('settings.controls.ThemePicker.seguir_aparencia_do_sistema')} checked={pair} onChange={setPair} /> {t('settings.controls.ThemePicker.seguir_aparencia_do_sistema')}</label>
      {pair && <nav className="settings-faces" aria-label={t('settings.controls.ThemePicker.lado_do_par')}><div className="settings-segmented">{(['light', 'dark'] as const).map(s => <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}>{s === 'light' ? t('settings.controls.ThemePicker.claro') : t('settings.controls.ThemePicker.escuro')}</button>)}</div></nav>}
      <div className="theme-grid">{list.map(t => <button key={t.id} type="button" className="theme-card" data-theme-id={t.id} aria-pressed={chosen === t.id} onClick={() => choose(t.id)}><ThemeSwatch theme={t} /><span>{tr(t.name)}</span></button>)}</div>
      {error && <p role="alert">{error}</p>}
      <div className="settings-confirm-actions"><button type="button" onClick={onClose}>{t('settings.controls.ThemePicker.cancelar')}</button><button type="button" disabled={!ready} onClick={commit}>{t('settings.controls.ThemePicker.concluido')}</button></div>
    </div>
  </div>
}

/** Os quatro cartões (Sistema, Escuro, Claro e Personalizado, que abre os 17 temas e o par claro/escuro) e a prévia do escolhido. */
export function ThemeCards({ value, darkId, onPick, disabled }: { value: string; darkId: string | null; onPick(theme: string, dark: string | null): Promise<void> | void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const paired = darkId !== null
  const current = paired ? 'custom' : value === 'system' || value === '' || value === 'default' ? 'system' : value === 'palco-dark' || value === 'dark' ? 'dark' : value === 'palco-light' || value === 'light' ? 'light' : 'custom'
  const isLight = document.documentElement.dataset.appearance === 'light'
  const resolve = (theme: string, dark: string | null): TerminalTheme => resolveTerminalTheme({ defaultTerminalTheme: theme, defaultTerminalDarkThemeId: dark }, isLight)
  const shown = resolve(value, darkId)
  const pick = (theme: string): void => { void Promise.resolve(onPick(theme, null)).catch(() => {}) }
  const cards: Array<[string, string, TerminalTheme | null, () => void]> = [
    ['system', t('settings.controls.ThemePicker.sistema'), resolve('system', null), () => pick('system')],
    ['dark', t('settings.controls.ThemePicker.escuro'), resolve('palco-dark', null), () => pick('palco-dark')],
    ['light', t('settings.controls.ThemePicker.claro'), resolve('palco-light', null), () => pick('palco-light')],
    ['custom', t('settings.controls.ThemePicker.personalizado'), current === 'custom' ? shown : null, () => setOpen(true)]
  ]
  return <div className="theme-picker">
    <div role="group" aria-label={t('settings.controls.ThemePicker.tema')} className="theme-cards">{cards.map(([key, label, theme, run]) => <button key={key} type="button" aria-pressed={current === key} disabled={disabled} onClick={run}>
      {theme ? <ThemeSwatch theme={theme} /> : <span className="theme-swatch is-empty" aria-hidden="true"><Plus size={16} /></span>}<span className="theme-card-name">{label}</span></button>)}</div>
    <ThemePreview theme={shown} label={tr(shown.name)} />
    {open && <CustomThemeModal value={value} darkId={darkId} onCommit={onPick} onClose={() => setOpen(false)} />}
  </div>
}

/** Terminal › Aparência › Tema: os cartões ligados à preferência global. */
export function ThemePicker({ disabled }: { disabled?: boolean }) {
  const p = usePreferences()
  return <ThemeCards value={p.defaultTerminalTheme} darkId={p.defaultTerminalDarkThemeId} disabled={disabled} onPick={(theme, dark) => updatePreferences({ defaultTerminalTheme: theme, defaultTerminalDarkThemeId: dark })} />
}
