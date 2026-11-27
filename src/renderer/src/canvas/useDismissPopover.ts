import { useEffect, useRef } from 'react'
import { matchesShortcut } from '../settings/preferences'

/** Consome também o restante do gesto: fechar não pode clicar nem abrir o menu do canvas exposto. */
function consumeGesture(): void {
  const stop = (event: Event) => { event.preventDefault(); event.stopPropagation() }
  const finish = (event: Event) => { stop(event); cleanup() }
  const reset = () => cleanup()
  // O `contextmenu` vem antes do `pointerup` no Linux: é barrado sem encerrar a vigia.
  const held = ['pointerup', 'mousedown', 'mouseup', 'contextmenu'] as const
  const cleanup = () => {
    for (const type of held) document.removeEventListener(type, stop, true)
    document.removeEventListener('click', finish, true)
    document.removeEventListener('pointerdown', reset, true)
    clearTimeout(timer)
  }
  for (const type of held) document.addEventListener(type, stop, true)
  document.addEventListener('click', finish, true)
  // Um gesto cancelado não deve engolir o próximo clique independente.
  document.addEventListener('pointerdown', reset, true)
  const timer = setTimeout(cleanup, 1000)
}

/** A superfície onde um clique cria, seleciona ou desfaz seleção. Diálogos, menus e o minimapa dentro dela são outra interface. */
const onCanvas = (target: Element): boolean => !!target.closest('.canvas, .floor-stage') && !target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], .minimap')

export function useDismissPopover(open: boolean, close: () => void, inside: string): void {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    if (!open) return
    const pointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(inside)) return
      // Sobre outra interface o popover fecha e o clique segue; só o do canvas é consumido.
      if (target && onCanvas(target)) { event.preventDefault(); event.stopPropagation(); consumeGesture() }
      latest.current()
    }
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesShortcut('cancel', event)) return
      const target = event.target instanceof Element ? event.target : null
      // O Escape do terminal é do programa que roda nele; o de um diálogo aberto por cima é do diálogo.
      if (target && !target.closest(inside) && target.closest('.xterm, [role="dialog"], [role="alertdialog"]')) return
      if (document.querySelector('[aria-modal="true"], .modal-back')) return
      event.preventDefault(); event.stopImmediatePropagation(); latest.current()
    }
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', key, true) }
  }, [open, inside])
}
