import type { KeyBinding } from '../../../shared/shortcuts'
import { t } from '../i18n'

/** O menu "…" da pílula do topo: só estes três itens, nesta ordem. */
export const TOP_MENU_ITEMS = [
  { id: 'settings', get label() { return t('canvas.top-menu.configuracoes') } },
  { id: 'routines', get label() { return t('canvas.top-menu.rotinas') } },
  { id: 'rail', get label() { return t('canvas.top-menu.alternar_mini_barra_lateral') } }
] as const

/** Atalho como o menu do palco mostra: "Ctrl + ," (Linux/Windows) ou "⌘ ," (macOS). */
export function menuShortcut(b: KeyBinding | undefined, mac: boolean): string {
  if (!b) return ''
  const key = b.key === ' ' ? t('canvas.top-menu.espaco') : b.key.length === 1 ? b.key.toUpperCase() : b.key
  const parts: string[] = []
  if (b.mod) parts.push(mac ? '⌘' : 'Ctrl')
  if (b.ctrl) parts.push(mac ? '⌃' : 'Ctrl')
  if (b.meta) parts.push(mac ? '⌘' : 'Meta')
  if (b.alt) parts.push(mac ? '⌥' : 'Alt')
  if (b.shift) parts.push(mac ? '⇧' : 'Shift')
  parts.push(key)
  return parts.join(mac ? ' ' : ' + ')
}
