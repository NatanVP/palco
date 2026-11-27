import { matchesShortcut } from './preferences'
import type { SystemSnapshot } from '../../../shared/system'
import { subscribeLocale, t } from '../i18n'
/** Independent application surface: subscriptions are mounted with preference effects, not in the canvas. */
export function connectSystemNotifications(): () => void {
 const api = window.palco?.system
 if (!api) return () => {}
 let alive = true, revision = 0, open = false, state: SystemSnapshot = { notices: [], badgeTerminalIds: [], workingTerminalIds: [] }
 const host = document.createElement('div')
 document.body.append(host)
 const render = (): void => {
  host.replaceChildren()
  if (!open) return
  const panel = document.createElement('section'); panel.setAttribute('aria-label', t('settings.system-notifications.notificacoes')); panel.setAttribute('role', 'dialog')
  Object.assign(panel.style, { position: 'fixed', right: '20px', top: '50px', zIndex: '10000', maxHeight: '70vh', overflow: 'auto', width: '360px', padding: '16px', background: 'var(--panel, #222)', color: 'var(--text, #eee)', border: '1px solid #888', borderRadius: '10px' })
  const button = (text: string, run: () => void): HTMLButtonElement => { const b = document.createElement('button'); b.textContent = text; b.onclick = run; return b }
  panel.append(button(t('settings.system-notifications.fechar_notificacoes'), () => { open = false; render() }))
  if (!state.notices.length) { const p = document.createElement('p'); p.textContent = t('settings.system-notifications.nenhuma_notificacao'); panel.append(p) }
  for (const notice of state.notices) {
   const row = document.createElement('article'), p = document.createElement('p'); p.textContent = notice.body
   Object.assign(row.style, { display: 'grid', gap: '6px', justifyItems: 'start', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,.1)' }); p.style.margin = '0'
   row.append(button(notice.title, () => { void api.focus(notice.id); open = false; render() }), p, button(t('settings.system-notifications.dispensar'), () => { void api.dismiss(notice.id) })); panel.append(row)
  }
  host.append(panel)
 }
 const adopt = (next: SystemSnapshot): void => { if (!alive) return; state = next; render() }
 const off = api.onChange(next => { revision++; adopt(next) }), initial = revision
 void api.snapshot().then(next => { if (initial === revision) adopt(next) }).catch(() => {})
 const offLocale = subscribeLocale(render)
 const key = (e: KeyboardEvent): void => {
  if (matchesShortcut('attention', e)) { e.preventDefault(); e.stopImmediatePropagation(); void api.nextAttention() }
  else if (matchesShortcut('notifications', e)) { e.preventDefault(); e.stopImmediatePropagation(); open = !open; render() }
  else if (open && e.key === 'Escape') { open = false; render() }
 }
 window.addEventListener('keydown', key, true)
 return () => { alive = false; off(); offLocale(); window.removeEventListener('keydown', key, true); host.remove() }
}
