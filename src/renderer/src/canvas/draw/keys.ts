import { matchesShortcut } from '../../settings/preferences'
/** O que uma tecla faz no desenho. */
export type DrawKeyAction = { kind: 'arm-rect' } | { kind: 'width'; delta: number } | { kind: 'cancel-gesture' } | { kind: 'exit' }

export interface DrawKeyState {
  /** Modo desenho ligado. */
  drawing: boolean
  /** Gesto em andamento (prévia na tela). */
  gesture: boolean
  /** Há nós ou desenhos selecionados (o `b` não arma por cima de uma seleção). */
  hasSelection: boolean
}

/** Campo de texto, editor, terminal e portal ficam com as teclas deles. */
function ownsKeys(target: EventTarget | null): boolean {
  const t = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null
  if (!t) return false
  const tag = (t.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'WEBVIEW' || t.isContentEditable) return true
  return !!t.closest?.('.xterm, .portalbox, [contenteditable="true"], [role="dialog"]')
}

/**
 * Teclas do desenho: `b` arma o retângulo, `[` e `]` mudam a espessura em 1,
 * Escape cancela o gesto ou, sem gesto, sai do desenho. Só sem Ctrl/Alt/Meta e fora de campos.
 */
export function drawKeyAction(e: KeyboardEvent, s: DrawKeyState): DrawKeyAction | null {
  if (e.defaultPrevented || ownsKeys(e.target)) return null
  if (matchesShortcut('cancel', e, { exact: true, ignoreShift: true })) return s.gesture ? { kind: 'cancel-gesture' } : s.drawing ? { kind: 'exit' } : null
  if (matchesShortcut('drawRectangle', e)) return s.hasSelection || s.gesture ? null : { kind: 'arm-rect' }
  if (s.drawing && matchesShortcut('drawThinner', e)) return { kind: 'width', delta: -1 }
  if (s.drawing && matchesShortcut('drawThicker', e)) return { kind: 'width', delta: 1 }
  return null
}
