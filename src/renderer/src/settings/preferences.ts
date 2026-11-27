import { applyLanguage } from '../../../shared/i18n/runtime'
import { connectOnboarding } from './onboarding'
import { connectSystemNotifications } from './system-notifications'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { defaultPreferences, type Preferences } from '../../../shared/preferences'
import { formatBinding, matchShortcut, type KeyInput, type ShortcutId } from '../../../shared/shortcuts'
import { t, tr } from '../i18n'
let current = defaultPreferences()
let recording = false
const listeners = new Set<() => void>()
export function getPreferences(): Preferences { return current }
export function adoptPreferences(value: Preferences): void {
  current = value
  // O idioma da interface segue a preferência (null = o do sistema) e troca na hora.
  const lang = applyLanguage(value.appLanguage, typeof navigator === 'undefined' ? null : navigator.language)
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  for (const listener of listeners) listener()
}
const subscribe = (cb: () => void): (() => void) => { listeners.add(cb); return () => { listeners.delete(cb) } }
export function usePreferences(): Preferences { return useSyncExternalStore(subscribe, getPreferences, getPreferences) }
export function suspendShortcuts(value: boolean): void { recording = value }
export function shortcutsSuspended(): boolean { return recording }
export function matchesShortcut(id: ShortcutId, event: KeyInput, policy?: { exact?: boolean; ignoreShift?: boolean }): boolean {
  if (typeof document !== 'undefined' && document.querySelector('.settings-dialog') && id !== 'cancel') return false
  return !recording && matchShortcut(id, event, current.shortcuts, policy)
}
export function shortcutLabel(id: ShortcutId): string { return current.shortcuts[id].map(b => formatBinding(b, tr('Espaço'))).join(' / ') || t('settings.preferences.sem_atalho') }
export function matchesZoomWheel(e: WheelEvent): boolean { return matchesShortcut('zoomWheel', { key: '', ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey }) }
export async function updatePreferences(patch: Partial<Preferences>): Promise<void> {
  if (!window.palco.preferences) throw new Error(t('settings.preferences.preferencias_indisponiveis'))
  adoptPreferences(await window.palco.preferences.set(patch))
}
/** Subscribe before reading; a delayed initial reply must not overwrite a change event. */
export function connectPreferences(): () => void {
  const api = window.palco?.preferences
  if (!api) return () => {}
  let alive = true, revision = 0
  const off = api.onChange(value => { revision++; if (alive) adoptPreferences(value) })
  const initial = revision
  void api.get().then(value => { if (alive && initial === revision) adoptPreferences(value) }).catch(error => console.warn(t('settings.preferences.preferencias'), error instanceof Error ? error.message : t('settings.preferences.nao_foi_possivel_carregar')))
  return () => { alive = false; off() }
}
/** A aparência efetiva é clara? ("Sistema" acompanha o `prefers-color-scheme` e reage a mudanças dele.) */
export function useAppearanceIsLight(): boolean {
  const { appearance } = usePreferences()
  const query = (): boolean => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) || false
  const [system, setSystem] = useState(query)
  useEffect(() => {
    if (appearance !== 'system' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: light)'), on = (): void => setSystem(media.matches)
    on(); media.addEventListener('change', on)
    return () => media.removeEventListener('change', on)
  }, [appearance])
  return appearance === 'system' ? system : appearance === 'light'
}
export function usePreferenceEffects(): void {
  const p = usePreferences()
  useEffect(() => connectPreferences(), [])
  useEffect(() => connectSystemNotifications(), [])
  useEffect(() => connectOnboarding(), [])
  useEffect(() => {
    const root = document.documentElement, media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = (): void => { root.dataset.appearance = p.appearance === 'system' ? media.matches ? 'light' : 'dark' : p.appearance }
    apply(); media.addEventListener('change', apply)
    root.dataset.pointerCursors = String(p.pointerCursors); root.dataset.canvasBackground = p.canvasBackground
    root.dataset.selectionStyle = p.selectionIndicatorStyle
    return () => media.removeEventListener('change', apply)
  }, [p.appearance, p.pointerCursors, p.canvasBackground, p.selectionIndicatorStyle])
}
