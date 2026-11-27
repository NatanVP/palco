import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'
import type { ComposerMode } from './composer-mode'

/** Keep HUD controls at screen size while the terminal lives in the zoomed world. */
export function hudGeometry(rect: { width: number }, localWidth: number, mode: ComposerMode): CSSProperties {
  const scale = rect.width / localWidth
  if (!Number.isFinite(scale) || scale <= 0) return {}
  const width = mode === 'below' ? 560 : Math.max(0, Math.min(560, rect.width - 24))
  return {
    width, transform: `translateX(-50%) scale(${1 / scale})`,
    transformOrigin: mode === 'below' ? 'center top' : 'center bottom',
    ...(mode === 'below' ? { top: `calc(100% + ${12 / scale}px)` } : { bottom: 30 / scale })
  }
}
/**
 * Mede quando algo muda (zoom no `.world`, tamanho ou escala do card, janela), em vez de ler o layout a cada quadro.
 * A posição não importa: a HUD é relativa ao card; só a escala e a largura dele entram na conta.
 */
export function useHudGeometry(ref: RefObject<HTMLDivElement | null>, mode: ComposerMode): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    if (mode === 'off') return
    const card = ref.current?.closest<HTMLElement>('[data-node-id]')
    if (!card) return
    let frame = 0, previous = ''
    const measure = (): void => {
      frame = 0
      const next = hudGeometry(card.getBoundingClientRect(), card.offsetWidth, mode)
      const signature = JSON.stringify(next)
      if (signature !== previous) { previous = signature; setStyle(next) }
    }
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(measure) }
    const world = card.closest<HTMLElement>('.world')
    const mutations = new MutationObserver(schedule)
    for (const el of [card, world]) if (el) mutations.observe(el, { attributes: true, attributeFilter: ['style', 'class'] })
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resize?.observe(card)
    // O zoom animado muda a escala sem mudar o atributo: mede de novo no fim da transição.
    world?.addEventListener('transitionend', schedule)
    window.addEventListener('resize', schedule)
    measure()
    return () => { cancelAnimationFrame(frame); mutations.disconnect(); resize?.disconnect(); world?.removeEventListener('transitionend', schedule); window.removeEventListener('resize', schedule) }
  }, [mode, ref])
  return style
}
