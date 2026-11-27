import { useEffect, useRef, type ReactNode, type ComponentProps } from 'react'
import { shortcutsSuspended, suspendShortcuts } from '../preferences'
import { ConfirmDialog } from './ConfirmDialog'
const owners: symbol[] = []
let priorSuspended = false
/** Pause the parent settings key handler while a nested editor owns Escape/Tab. */
export function useModalKeys(root: React.RefObject<HTMLDivElement | null>, close: () => void): void {
 const latest = useRef(close); latest.current = close
 useEffect(() => {
  const before = document.activeElement as HTMLElement | null, owner = Symbol('settings-modal')
  if (!owners.length) priorSuspended = shortcutsSuspended()
  owners.push(owner); suspendShortcuts(true)
  root.current?.querySelector<HTMLElement>('input:not(:disabled),textarea,button')?.focus()
  const key = (e: KeyboardEvent): void => {
   if (owners.at(-1) !== owner) return
   if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); latest.current(); return }
   if (e.key !== 'Tab') return
   const all = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])], first = all[0], last = all.at(-1)
   if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
   else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }
  window.addEventListener('keydown', key, true)
  return () => { window.removeEventListener('keydown', key, true); owners.splice(owners.indexOf(owner), 1); suspendShortcuts(owners.length > 0 || priorSuspended); if (before?.isConnected) before.focus() }
 }, [])
}
export function SettingsModal({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
 const root = useRef<HTMLDivElement>(null); useModalKeys(root, close)
 return <div className="settings-confirm-back" onPointerDown={e => e.stopPropagation()}><div ref={root} className="settings-confirm library-editor" role="dialog" aria-modal="true" aria-label={title}>{children}</div></div>
}
export function SettingsConfirm(props: ComponentProps<typeof ConfirmDialog>) {
 const root = useRef<HTMLDivElement>(null); useModalKeys(root, props.onCancel)
 return <div ref={root}><ConfirmDialog {...props} /></div>
}
