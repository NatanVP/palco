import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../i18n'

const COLORS = ['#D97757', '#FA114F', '#FF9F0A', '#A6FF00', '#10A37F', '#00D8FF', '#4285F4', '#BF5AF2']
const GAP = 2

/**
 * Encosta a paleta (`position: fixed`, fora do fluxo: não empurra nem vaza do cartão) abaixo da bolinha
 * ou, sem espaço, acima, dentro da parte visível do cartão. Devolve `false` se a bolinha saiu de vista.
 */
function place(button: HTMLElement, panel: HTMLElement): boolean {
  const anchor = button.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight
  const card = button.closest('.usage-providers')?.getBoundingClientRect()
  const view = button.closest('.settings-content')?.getBoundingClientRect()
  const viewTop = Math.max(0, view?.top ?? 0), viewBottom = Math.min(window.innerHeight, view?.bottom ?? window.innerHeight)
  let top = Math.max(viewTop, card?.top ?? viewTop), bottom = Math.min(viewBottom, card?.bottom ?? viewBottom)
  if (anchor.bottom <= top || anchor.top >= bottom) return false
  // Janela baixa demais para caber no cartão: vale a área visível das Configurações.
  if (bottom - top < height) { top = viewTop; bottom = viewBottom }
  const below = anchor.bottom + GAP, above = anchor.top - GAP - height
  const y = below + height <= bottom ? below : above >= top ? above : Math.max(top, Math.min(below, bottom - height))
  panel.style.top = `${y}px`
  panel.style.left = `${Math.max(card?.left ?? 0, anchor.right - width)}px`
  return true
}

export interface ColorMenuProps {
  name: string
  color: string
  /** Gravando: a bolinha segue habilitada (para não perder o foco), mas não abre. */
  busy: boolean
  disabled?: boolean
  onChange(color: string): void
  /** Presente nas contas: volta a herdar a cor do provedor. */
  onInherit?(): void
}

export function ColorMenu({ name, color, busy, disabled, onChange, onInherit }: ColorMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), picker = useRef<HTMLInputElement>(null)
  /** Cor mostrada pelo seletor do sistema e ainda não confirmada (`input` sem `change`). */
  const pending = useRef<string | null>(null)
  const latest = useRef({ onChange, onInherit })
  latest.current = { onChange, onInherit }

  /** Fecha; o que o seletor deixou escolhido vale, a não ser que se descarte (Escape). */
  const dismiss = (discard = false): void => {
    const value = pending.current
    pending.current = null
    setOpen(false)
    if (!discard && value) latest.current.onChange(value)
  }
  const choose = (value: string | null): void => {
    pending.current = null
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
    if (value === null) latest.current.onInherit?.()
    else latest.current.onChange(value)
  }

  useLayoutEffect(() => {
    const button = trigger.current, menu = panel.current
    if (!open || !button || !menu) return
    button.scrollIntoView?.({ block: 'nearest' })
    button.closest('.usage-providers')?.scrollIntoView?.({ block: 'nearest' })
    place(button, menu)
    menu.querySelector('button')?.focus({ preventScroll: true })
    const follow = (): void => { if (!place(button, menu)) dismiss() }
    // Captura: o diálogo de Configurações segura o `pointerdown` antes de ele voltar ao documento.
    const outside = (e: PointerEvent): void => { if (!root.current?.contains(e.target as Node)) dismiss() }
    // `change` nativo (o `onChange` do React é o `input`): dispara quando o seletor do sistema confirma.
    const input = picker.current
    // Voltar à cor de partida (é o que o seletor faz no Escape dele) não é escolha: nada a gravar.
    const preview = (): void => { pending.current = input!.value === input!.defaultValue ? null : input!.value }
    const commit = (): void => choose(input!.value)
    input?.addEventListener('input', preview)
    input?.addEventListener('change', commit)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      input?.removeEventListener('input', preview)
      input?.removeEventListener('change', commit)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open])
  useEffect(() => { if (disabled) { pending.current = null; setOpen(false) } }, [disabled])

  return <div className="provider-color" ref={root} data-inline-editor={open ? '' : undefined}
    onBlur={(e) => { if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) dismiss() }}
    onKeyDown={(e) => { if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(true); trigger.current?.focus({ preventScroll: true }) } }}>
    <button ref={trigger} className="provider-color-trigger" aria-label={t('settings.accounts.color', { name })} aria-expanded={open} aria-disabled={busy || undefined} disabled={disabled}
      onClick={() => { if (open) dismiss(); else if (!busy) setOpen(true) }}><span style={{ background: color }} /></button>
    {open && <div ref={panel} className="provider-palette" role="group" aria-label={t('settings.accounts.colors', { name })}>
      {COLORS.map((value) => <button key={value} aria-label={t('settings.accounts.swatch', { color: value })} aria-pressed={color.toUpperCase() === value} style={{ background: value }} onClick={() => choose(value)} />)}
      <label>{t('settings.accounts.custom')}<input ref={picker} type="color" aria-label={t('settings.accounts.customColor', { name })} defaultValue={color.toLowerCase()} /></label>
      {onInherit && <button className="account-color-inherit" onClick={() => choose(null)}>{t('settings.accounts13.inherit')}</button>}
    </div>}
  </div>
}
