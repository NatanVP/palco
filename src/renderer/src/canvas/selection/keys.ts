/** Teclas da seleção por laço e das ações em grupo, resolvidas pelo registro único de atalhos. */
import { matchesShortcut } from '../../settings/preferences'
export type SelectionKeyAction =
  | { kind: 'delete' } | { kind: 'copy' } | { kind: 'paste' } | { kind: 'duplicate' }
  | { kind: 'toggle-pan' } | { kind: 'hold-pan' }
  /** Setas: move a seleção 1 unidade (Shift: 10). */
  | { kind: 'nudge'; by: { x: number; y: number } }
  | { kind: 'select-all' }

const ARROW: Record<string, { x: number; y: number }> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }

/** Elementos que se ativam com Espaço (botão, link, item de menu): o Espaço é deles, não do pan. */
function isActivatable(target: EventTarget | null): boolean {
  const t = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null
  if (!t) return false
  const tag = (t.tagName ?? '').toUpperCase()
  return tag === 'BUTTON' || tag === 'A' || !!t.closest?.('[role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="tab"], [role="switch"], [role="checkbox"]')
}

/** Campo, nota em edição, terminal, portal e diálogo ficam com as teclas deles. */
function ownsKeys(target: EventTarget | null): boolean {
  const t = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null
  if (!t) return false
  const tag = (t.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'WEBVIEW' || tag === 'IFRAME' || t.isContentEditable) return true
  return !!t.closest?.('.xterm, .portalbox, [contenteditable="true"], [role="dialog"], [role="tree"], [role="listbox"], [role="menu"], [role="slider"], [inert]')
}

/**
 * Delete/Backspace apagam a seleção inteira (decisão do palco); Ctrl/Cmd+C, V e D copiam, colam e duplicam;
 * H alterna o pan; a tecla configurada segura o pan enquanto estiver apertada. As teclas vêm do registro único (`shared/shortcuts.ts`).
 */
export function selectionKeyAction(e: KeyboardEvent, s: { hasSelection: boolean }): SelectionKeyAction | null {
  if (e.defaultPrevented || ownsKeys(e.target)) return null
  if (matchesShortcut('copy', e)) return s.hasSelection ? { kind: 'copy' } : null
  if (matchesShortcut('paste', e)) return { kind: 'paste' }
  if (matchesShortcut('duplicate', e)) return s.hasSelection ? { kind: 'duplicate' } : null
  if (matchesShortcut('selectAll', e)) return { kind: 'select-all' }
  const arrow = ARROW[e.key]
  if (arrow && s.hasSelection && !e.ctrlKey && !e.metaKey && !e.altKey) { const k = e.shiftKey ? 10 : 1; return { kind: 'nudge', by: { x: arrow.x * k, y: arrow.y * k } } }
  if (matchesShortcut('deleteSelection', e, { exact: true })) return s.hasSelection ? { kind: 'delete' } : null
  if (matchesShortcut('panToggle', e)) return { kind: 'toggle-pan' }
  if (matchesShortcut('panHold', e)) return isActivatable(e.target) ? null : { kind: 'hold-pan' }
  return null
}
