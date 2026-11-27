import { matchesShortcut } from '../settings/preferences'
import type { HistoryApi } from '../../../shared/api'

const EDITING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm, webview, iframe, [role="dialog"], [inert]'
export function ownsHistoryFocus(root: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof HTMLElement && root.contains(target) && !target.closest(EDITING)
}

/** Canvas only: native editors, PTYs and browser guests own their undo stack. */
export function installHistoryKeys(
  root: HTMLElement, workspaceId: string, api: Pick<HistoryApi, 'undo' | 'redo'>,
  onApplied: () => void, onError: (error: unknown) => void
): () => void {
  let pending = false
  let active = true
  const key = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat || event.isComposing || (!matchesShortcut('undo', event) && !matchesShortcut('redo', event))) return
    if (!ownsHistoryFocus(root, event.target) || !ownsHistoryFocus(root, document.activeElement)) return
    event.preventDefault(); event.stopPropagation()
    if (pending) return
    pending = true
    void (matchesShortcut('redo', event) ? api.redo(workspaceId) : api.undo(workspaceId))
      .then(applied => { if (active && applied) onApplied() }).catch(error => { if (active) onError(error) }).finally(() => { pending = false })
  }
  root.addEventListener('keydown', key)
  return () => { active = false; root.removeEventListener('keydown', key) }
}
