import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { matchesShortcut } from '../settings/preferences'

/** Um item do menu do botão direito. `items` faz dele um submenu; `checked` (definido) faz dele caixa de marcação ou opção de rádio. */
export interface MenuItem {
  id: string
  label: string
  icon?: LucideIcon
  disabled?: boolean
  checked?: boolean
  radio?: boolean
  danger?: boolean
  items?: MenuEntry[]
  run?(): void
}
export type MenuEntry = MenuItem | 'separator'

/** Separadores nunca ficam nas pontas nem em dobro: quem monta o menu não precisa saber o que ficou de fora. */
export function tidyEntries(entries: ReadonlyArray<MenuEntry | null | undefined | false>): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const e of entries) {
    if (!e) continue
    if (e === 'separator' && (out.length === 0 || out[out.length - 1] === 'separator')) continue
    out.push(e)
  }
  if (out[out.length - 1] === 'separator') out.pop()
  return out
}

const MARGIN = 8
interface Anchor { x: number; y: number; /** Borda esquerda do item pai: sem espaço à direita, o submenu abre para a esquerda dele. */ flipAt?: number }

function List({ entries, anchor, path, open, onOpen, onRun, label, focusLater }: {
  entries: MenuEntry[]; anchor: Anchor; path: string[]; open: string[]; label: string
  /** Submenu aberto pelo teclado: o foco entra no primeiro item assim que ele monta. */
  focusLater: MutableRefObject<string | null>
  onOpen(path: string[]): void; onRun(item: MenuItem): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number }>({ left: anchor.x, top: anchor.y, maxHeight: window.innerHeight - 2 * MARGIN })
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const fitsRight = anchor.x + box.width <= window.innerWidth - MARGIN
    const left = fitsRight ? anchor.x : Math.max(MARGIN, (anchor.flipAt ?? anchor.x) - box.width)
    const top = Math.max(MARGIN, Math.min(anchor.y, window.innerHeight - MARGIN - box.height))
    setPos({ left, top, maxHeight: window.innerHeight - 2 * MARGIN })
  }, [anchor.x, anchor.y, anchor.flipAt, entries.length])
  useLayoutEffect(() => {
    if (focusLater.current !== path.join('/')) return
    focusLater.current = null
    ref.current?.querySelector<HTMLButtonElement>(':scope > button:not(:disabled)')?.focus({ preventScroll: true })
  }, [])
  // A coluna de ícones só existe onde algum item tem ícone ou marca (a lista de presets fica rente).
  const gutter = entries.some((e) => e !== 'separator' && (!!e.icon || e.checked !== undefined))
  const sub = entries.find((e): e is MenuItem => e !== 'separator' && !!e.items && !e.disabled && open[path.length] === e.id)
  const subRow = (): DOMRect | undefined => ref.current?.querySelector(`[data-menu-id="${CSS.escape(sub!.id)}"]`)?.getBoundingClientRect()
  const [subAnchor, setSubAnchor] = useState<Anchor | null>(null)
  useLayoutEffect(() => {
    const row = sub ? subRow() : undefined
    setSubAnchor(row ? { x: row.right + 2, y: row.top - 5, flipAt: row.left - 2 } : null)
  }, [sub?.id, pos.left, pos.top])
  return (
    <>
      <div ref={ref} className="cmenu-menu" role="menu" aria-label={label} tabIndex={-1} data-menu-path={path.join('/')} style={pos}>
        {entries.map((e, i) => e === 'separator' ? <div key={`s${i}`} role="separator" className="cmenu-sep" /> : (
          <button
            key={e.id} type="button" data-menu-id={e.id} className={`cmenu-item${e.danger ? ' danger' : ''}${open[path.length] === e.id ? ' open' : ''}`}
            role={e.checked === undefined ? 'menuitem' : e.radio ? 'menuitemradio' : 'menuitemcheckbox'}
            aria-checked={e.checked} aria-haspopup={e.items ? 'menu' : undefined} aria-expanded={e.items ? open[path.length] === e.id : undefined}
            disabled={e.disabled}
            onPointerEnter={() => onOpen(e.items && !e.disabled ? [...path, e.id] : path)}
            onClick={() => { if (e.items) onOpen([...path, e.id]); else onRun(e) }}
          >
            {gutter && <span className="cmenu-icon" aria-hidden="true">{e.checked !== undefined ? (e.checked ? <Check size={14} /> : null) : e.icon ? <e.icon size={14} /> : null}</span>}
            <span className="cmenu-label">{e.label}</span>
            {e.items && <ChevronRight size={14} className="cmenu-chevron" aria-hidden="true" />}
          </button>
        ))}
      </div>
      {sub && subAnchor && <List entries={sub.items!} anchor={subAnchor} path={[...path, sub.id]} open={open} onOpen={onOpen} onRun={onRun} label={sub.label} focusLater={focusLater} />}
    </>
  )
}

interface Props {
  entries: MenuEntry[]
  /** Ponto do clique, em pixels da janela. */
  at: { x: number; y: number }
  label: string
  onClose(): void
}

/**
 * Menu do botão direito com submenus (canvas e elementos). Abre no ponto, não sai da janela e fecha com Esc, clique fora, roda ou
 * perda do foco da janela. Setas, Enter e Espaço navegam; ao fechar, o foco volta para onde estava (o terminal, por exemplo),
 * a menos que a ação escolhida tenha levado o foco para outro lugar.
 */
export function ContextMenu({ entries, at, label, onClose }: Props) {
  const [open, setOpen] = useState<string[]>([])
  const host = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const close = useRef(onClose)
  close.current = onClose
  const focusLater = useRef<string | null>(null)
  useEffect(() => { setOpen([]) }, [at.x, at.y])
  useEffect(() => {
    const previous = returnTo.current
    host.current?.querySelector<HTMLElement>('.cmenu-menu')?.focus({ preventScroll: true })
    return () => {
      // Só devolve o foco se ele ainda estava no menu (ou caiu no body quando o menu saiu).
      const now = document.activeElement
      if (previous?.isConnected && (!now || now === document.body || now.closest('.cmenu-host'))) previous.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const items = (path: string): HTMLButtonElement[] => [...(host.current?.querySelectorAll<HTMLButtonElement>(`[data-menu-path="${CSS.escape(path)}"] > button`) ?? [])].filter((b) => !b.disabled)
    const key = (e: KeyboardEvent): void => {
      if (matchesShortcut('cancel', e) || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close.current(); return }
      const focused = host.current?.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null
      const path = focused?.closest<HTMLElement>('[data-menu-path]')?.dataset.menuPath ?? ''
      const list = items(path), at = list.indexOf(focused as HTMLButtonElement)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1
        const next = at < 0 ? (step === 1 ? 0 : list.length - 1) : (at + step + list.length) % list.length
        list[next]?.focus({ preventScroll: true })
        setOpen(path ? path.split('/') : [])
      } else if (e.key === 'ArrowRight' && focused?.getAttribute('aria-haspopup')) {
        const child = [...(path ? path.split('/') : []), focused.dataset.menuId!]
        setOpen(child)
        // O submenu monta no próximo render: o foco entra nele assim que aparece (efeito do próprio submenu). Já aberto, entra agora.
        const mounted = items(child.join('/'))[0]
        if (mounted) mounted.focus({ preventScroll: true })
        else focusLater.current = child.join('/')
      } else if (e.key === 'ArrowLeft' && path) {
        const parts = path.split('/'), parent = parts.pop()!
        setOpen(parts)
        host.current?.querySelector<HTMLElement>(`[data-menu-id="${CSS.escape(parent)}"]`)?.focus({ preventScroll: true })
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') {
        if (e.key === 'Tab') { e.preventDefault(); close.current() }
        e.stopPropagation()
        return
      }
      e.preventDefault(); e.stopImmediatePropagation()
    }
    const outside = (e: Event): void => { if (!host.current?.contains(e.target as Node)) close.current() }
    const blur = (): void => close.current()
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('wheel', outside, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('wheel', outside, true); window.removeEventListener('blur', blur)
    }
  }, [])
  const run = (item: MenuItem): void => {
    // Primeiro a ação (ela pode levar o foco para um campo), depois o menu sai.
    item.run?.()
    close.current()
  }
  const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()
  return createPortal(
    // O portal vai para o <body>, mas os eventos do React sobem pela árvore até o Canvas: param aqui.
    <div ref={host} className="cmenu-host" onPointerDown={stop} onPointerUp={stop} onPointerOver={stop} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <List entries={entries} anchor={at} path={[]} open={open} onOpen={setOpen} onRun={run} label={label} focusLater={focusLater} />
    </div>,
    document.body
  )
}
