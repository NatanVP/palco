import { useEffect, useRef, type RefObject } from 'react'
import type { Camera } from './camera'

/** Deslocamento (px de tela) a partir do qual o botão direito apertado vira arrasto. */
export const RIGHT_DRAG_SLOP = 4

/** Quanto depois do soltar o `contextmenu` do próprio arrasto ainda pode chegar (Windows o manda no soltar). */
const LATE_MENU_MS = 80

/** Onde o botão direito continua sendo do próprio campo (menu nativo, seleção de texto). */
const NATIVE = '.composer, .cmenu-host, .rope-popover, [role="dialog"]'

/**
 * "Arrastar com o botão direito move a vista": o arrasto vale em qualquer ponto do canvas, inclusive sobre os elementos.
 * O Linux dispara `contextmenu` já no aperto: ele é segurado e, se o ponteiro não andou, refeito no soltar (o menu abre);
 * se andou, a vista se move e o `contextmenu` que ainda vier é descartado. Os ouvintes são nativos e na captura, para os
 * elementos não verem o botão direito (não selecionam nem começam arrasto).
 */
export function useRightDragPan(root: RefObject<HTMLElement | null>, enabled: boolean, camera: RefObject<Camera>, onCamera: (c: Camera) => void): void {
  const pan = useRef(onCamera)
  pan.current = onCamera
  useEffect(() => {
    const el = root.current
    if (!el || !enabled) return
    let press: { id: number; x: number; y: number; offset: { x: number; y: number }; target: EventTarget; dragged: boolean; held: boolean } | null = null
    /** Arrasto recém-terminado sem `contextmenu` no aperto: o que vier logo em seguida, no canvas, é dele e é descartado. */
    let swallow = false
    let forget: ReturnType<typeof setTimeout> | undefined
    let replaying = false
    const down = (e: PointerEvent): void => {
      swallow = false
      if (e.button !== 2) return
      if ((e.target as Element).closest?.(NATIVE)) return
      e.stopPropagation()
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, offset: { ...camera.current!.offset }, target: e.target!, dragged: false, held: false }
      el.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent): void => {
      if (!press || e.pointerId !== press.id) return
      e.stopPropagation()
      const dx = e.clientX - press.x, dy = e.clientY - press.y
      if (!press.dragged && dx * dx + dy * dy < RIGHT_DRAG_SLOP * RIGHT_DRAG_SLOP) return
      press.dragged = true
      pan.current({ zoom: camera.current!.zoom, offset: { x: press.offset.x + dx, y: press.offset.y + dy } })
    }
    const finish = (e: PointerEvent, cancelled: boolean): void => {
      if (!press || e.pointerId !== press.id) return
      e.stopPropagation()
      const done = press
      press = null
      if (el.hasPointerCapture?.(done.id)) el.releasePointerCapture(done.id)
      if (done.dragged) {
        // No Linux o `contextmenu` já veio no aperto (e foi segurado): não há outro a esperar.
        if (done.held) return
        swallow = true
        clearTimeout(forget)
        forget = setTimeout(() => { swallow = false }, LATE_MENU_MS)
        return
      }
      if (cancelled || !done.held) return
      const under = document.elementFromPoint?.(e.clientX, e.clientY)
      const target = under && el.contains(under) ? under : done.target
      replaying = true
      try { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: e.clientX, clientY: e.clientY })) }
      finally { replaying = false }
    }
    const up = (e: PointerEvent): void => finish(e, false)
    const cancel = (e: PointerEvent): void => finish(e, true)
    const menu = (e: Event): void => {
      if (replaying) return
      if (press) { press.held = true; e.preventDefault(); e.stopPropagation(); return }
      if (swallow && el.contains(e.target as Node)) { swallow = false; e.preventDefault(); e.stopPropagation() }
    }
    el.addEventListener('pointerdown', down, true)
    el.addEventListener('pointermove', move, true)
    el.addEventListener('pointerup', up, true)
    el.addEventListener('pointercancel', cancel, true)
    window.addEventListener('contextmenu', menu, true)
    return () => {
      clearTimeout(forget)
      el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true)
      el.removeEventListener('pointerup', up, true); el.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('contextmenu', menu, true)
    }
  }, [enabled, root, camera])
}
