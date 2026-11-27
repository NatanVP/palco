import { useEffect, useRef, useState } from 'react'
import { Bot, HardDrive, Info, Keyboard, SlidersHorizontal, SquareTerminal, Waypoints, X, type LucideIcon } from 'lucide-react'
import { APPEARANCE_FACES, SETTINGS_TABS } from './catalog'
import { SettingsBody } from './tabs'
import { matchesShortcut, shortcutsSuspended } from './preferences'
import { t, tr } from '../i18n'
import './settings.css'

type Tab = (typeof SETTINGS_TABS)[number]['id']
const TAB_ICONS: Record<Tab, LucideIcon> = { general: SlidersHorizontal, terminal: SquareTerminal, agents: Bot, shortcuts: Keyboard, wire: Waypoints, data: HardDrive, about: Info }
function TabIcon({ id }: { id: Tab }) { const Icon = TAB_ICONS[id]; return <Icon size={24} strokeWidth={1.6} aria-hidden="true" /> }
export function SettingsDialog({ onClose, at = null }: { onClose(): void; at?: { tab: string; section: string } | null }) {
  const start = SETTINGS_TABS.find(t => t.id === at?.tab)
  const [face, setFace] = useState<string>(APPEARANCE_FACES[0]), [tab, setTab] = useState<Tab>(start?.id ?? 'general'), [section, setSection] = useState(start ? ((start.sections as readonly string[]).includes(at!.section) ? at!.section : (start.sections[0] ?? '')) : t('settings.SettingsDialog.sistema'))
  const root = useRef<HTMLDivElement>(null), closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus()
    const key = (e: KeyboardEvent): void => {
      if (shortcutsSuspended()) return
      // Esc com uma dica (i) aberta fecha só a dica.
      if (e.key === 'Escape' && (e.target as Element | null)?.closest?.('.settings-info-button[aria-expanded=true]')) return
      // Esc dentro de um editor aberto na própria aba volta para a lista; quem trata é o editor.
      if (e.key === 'Escape' && (e.target as Element | null)?.closest?.('[data-inline-editor]')) return
      if (matchesShortcut('cancel', e)) { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); return }
      if (e.key !== 'Tab' || !root.current) return
      const all = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el => !el.hidden)
      const first = all[0], last = all.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus() }
  }, [])
  const selected = SETTINGS_TABS.find(t => t.id === tab)!
  return <div className="settings-back" onPointerDown={e => e.stopPropagation()}>
    <div ref={root} className="settings-dialog" role="dialog" aria-modal="true" aria-label={t('settings.SettingsDialog.configuracoes')} onKeyDown={e => e.stopPropagation()}>
      <header className="settings-close"><button type="button" aria-label={t('settings.controls.ThemePicker.fechar')} onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
      <nav role="tablist" aria-label={t('settings.SettingsDialog.categorias_de_configuracoes')} className="settings-tabs">{SETTINGS_TABS.map(t => <button key={t.id} role="tab" id={`settings-tab-${t.id}`} aria-controls="settings-panel" aria-selected={t.id === tab} tabIndex={t.id === tab ? 0 : -1} onClick={() => { setTab(t.id); setSection(t.sections[0] ?? '') }} onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault(); const index = SETTINGS_TABS.findIndex(x => x.id === t.id), next = SETTINGS_TABS[(index + (e.key === 'ArrowRight' ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length]!
        setTab(next.id); setSection(next.sections[0] ?? ''); document.getElementById(`settings-tab-${next.id}`)?.focus()
      }}><TabIcon id={t.id} />{t.label}</button>)}</nav>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="settings-content">
        <div className="settings-column">
          {!!selected.sections.length && <nav aria-label={t('settings.SettingsDialog.secoes')} className="settings-subtabs"><div className="settings-segmented">{selected.sections.map(s => <button key={s} type="button" aria-pressed={s === section} onClick={() => setSection(s)}>{tr(s)}</button>)}</div></nav>}
          {tab === 'terminal' && section === 'Aparência' && <nav aria-label={t('settings.SettingsDialog.aparencia')} className="settings-faces"><div className="settings-segmented">{APPEARANCE_FACES.map(f => <button key={f} type="button" aria-pressed={f === face} onClick={() => setFace(f)}>{tr(f)}</button>)}</div></nav>}
          <SettingsBody key={`${tab}-${section}`} tab={tab} section={section} face={face} />
        </div>
      </div>
    </div>
  </div>
}
