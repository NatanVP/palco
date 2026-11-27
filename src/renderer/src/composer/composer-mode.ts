import { useSyncExternalStore } from 'react'

export type ComposerMode = 'off' | 'overlay' | 'below'
export const nextMode = (m: ComposerMode): ComposerMode => (m === 'off' ? 'overlay' : m === 'overlay' ? 'below' : 'off')
const KEY = 'palco.composer.placement', LEGACY = 'palco.composer.modes'
const listeners = new Set<() => void>()
let placement: ComposerMode = (() => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (value === 'off' || value === 'overlay' || value === 'below') return value
    const old: unknown = JSON.parse(localStorage.getItem(LEGACY) ?? '{}')
    if (old && typeof old === 'object') return Object.values(old).find(v => v === 'below' || v === 'overlay') ?? 'off'
  } catch { /* no storage */ }
  return 'off'
})()
let active: string | null = null, dismissed: string | null = null
const emit = (): void => { for (const listener of listeners) listener() }
const persist = (): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(placement))
    // Migration compatibility with older Palco builds.
    localStorage.setItem(LEGACY, JSON.stringify(active && placement !== 'off' ? { [active]: placement } : {}))
  } catch { /* private storage */ }
  emit()
}
export const composerMode = (id: string): ComposerMode => active === id ? placement : 'off'
export function setComposerMode(id: string, mode: ComposerMode): void {
  placement = mode; active = mode === 'off' ? null : id; dismissed = null; persist()
}
/** Escape dismisses this editor while retaining the global placement choice. */
export function dismissComposer(id: string): void {
  if (active !== id) return
  active = null; dismissed = id; emit()
}
export function focusComposer(id: string | null): void {
  // O foco que volta ao terminal logo depois do Esc não reabre; sair dele (outro terminal ou o fundo, `null`) libera.
  if (id !== null && id === dismissed) return
  const next = placement === 'off' ? null : id
  if (next === active && dismissed === null) return
  dismissed = null; active = next; emit()
}
export function cycleComposer(id: string, claimKeyboard = false): ComposerMode {
  if (placement !== 'off' && active !== id) { active = id; dismissed = null; persist(); return placement }
  if (claimKeyboard && placement !== 'off') {
    const editor = document.querySelector<HTMLElement>('[data-composer-editor]')
    if (editor && editor !== document.activeElement) { editor.focus({ preventScroll: true }); return placement }
  }
  const next = nextMode(placement); setComposerMode(id, next); return next
}
export function useComposerMode(id: string): ComposerMode {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => composerMode(id))
}
