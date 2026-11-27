import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Lock, Plus } from 'lucide-react'
import type { AgentKind, Sidebar } from '../../../shared/model'
import { railHint, railItems, railMove, type RailItem } from './sidebar-layout'
import { Glyph, useWorkspaceImage } from './workspace-icons'
import { t } from '../i18n'

/** Passar o mouse (ou segurar) por 350 ms: a dica à direita; segurar abre a lista de terminais para navegar sem expandir a barra lateral. */
const HINT_DELAY_MS = 350
export interface RailTerminal { id: string; name: string; agent: AgentKind }
type Hint = { text: string; detail: string | null; midY: number }
interface Actions {
  onSwitch(id: string): void
  onMove(id: string, to: { spaceId: string | null; index: number }): void
  onMenu(item: RailItem, at: { x: number; y: number }): void
  terminalsOf(workspaceId: string): Promise<RailTerminal[]>
  onGoTo(workspaceId: string, terminalId: string): void
}

function RailButton({ item, sidebar, a, onHint }: { item: RailItem; sidebar: Sidebar; a: Actions; onHint(h: Hint | null): void }) {
  const image = useWorkspaceImage(item.id)
  const hover = useRef<number | null>(null), hold = useRef<number | null>(null), held = useRef(false)
  const [pop, setPop] = useState<{ list: RailTerminal[]; x: number; y: number } | null>(null)
  const clearTimers = (): void => { if (hover.current !== null) window.clearTimeout(hover.current); if (hold.current !== null) window.clearTimeout(hold.current); hover.current = null; hold.current = null }
  useEffect(() => clearTimers, [])
  const tint = item.color ?? 'var(--primary)'
  return (
    <li className="rail-li">
      <button
        type="button" className={`rail-item${item.active ? ' active' : ''}`} aria-label={`${item.name || t('sidebar.WorkspaceRail.sem_titulo')}${item.attention ? `, ${t('sidebar.WorkspaceRail.n_avisos', { count: item.attention })}` : ''}${item.locked ? t('sidebar.WorkspaceRail.somente_leitura') : ''}`} aria-current={item.active ? 'true' : undefined}
        style={{ ['--rail-tint' as string]: tint, color: tint }}
        onClick={() => { if (held.current) { held.current = false; return } a.onSwitch(item.id) }}
        onContextMenu={(e) => { e.preventDefault(); clearTimers(); onHint(null); a.onMenu(item, { x: e.clientX, y: e.clientY }) }}
        onKeyDown={(e) => {
          // Alt+↑/↓ reordenam o item dentro do grupo (o ← → e as setas sem Alt ficam com o foco do navegador).
          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
          e.preventDefault()
          const to = railMove(sidebar, item.id, e.key === 'ArrowDown' ? 1 : -1)
          if (to) a.onMove(item.id, to)
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || item.terminals === 0) return
          const box = e.currentTarget.getBoundingClientRect()
          hold.current = window.setTimeout(() => { held.current = true; onHint(null); void a.terminalsOf(item.id).then((list) => { if (list.length) setPop({ list, x: box.right + 8, y: box.top }) }).catch(() => {}) }, HINT_DELAY_MS)
        }}
        onPointerUp={() => { if (hold.current !== null) window.clearTimeout(hold.current); hold.current = null }} onPointerCancel={clearTimers}
        onPointerEnter={(e) => {
          const nav = e.currentTarget.closest('nav'); if (!nav) return
          const midY = e.currentTarget.getBoundingClientRect().top + 16 - nav.getBoundingClientRect().top
          hover.current = window.setTimeout(() => onHint({ ...railHint(item.name, item.terminals), midY }), HINT_DELAY_MS)
        }}
        onPointerLeave={() => { held.current = false; clearTimers(); onHint(null) }} onBlur={() => onHint(null)}
      >
        <Glyph icon={item.icon} color={item.color} image={image} size={16} />
        {item.terminals > 0 && <span className="rail-dot" aria-hidden="true" />}
        {item.locked && <Lock className="rail-lock" size={7} aria-hidden="true" />}
      </button>
      {item.attention > 0 && <span className="rail-attn" aria-hidden="true">{item.attention > 9 ? '9+' : item.attention}</span>}
      {pop && createPortal(<>
        <div className="rail-pop-back" onPointerDown={() => setPop(null)} />
        <div className="rail-pop" role="menu" aria-label={t('sidebar.WorkspaceRail.terminais_de_name', { name: item.name })} style={{ left: pop.x, top: pop.y }}>{pop.list.map((t) => <button key={t.id} type="button" role="menuitem" onClick={() => { setPop(null); a.onGoTo(item.id, t.id) }}>{t.name}</button>)}</div>
      </>, document.body)}
    </li>
  )
}

/**
 * Mini barra lateral: com a barra recolhida e o modo mini ligado, uma coluna de 52 px com um botão por workspace
 * do Espaço ativo e o "+" no fim, que pede o nome. Botão direito: menu do workspace. Segurar: lista de terminais. Alt+↑/↓: reordena.
 * Selo de atenção (respostas do agente por ler) e cadeado (workspace somente leitura).
 */
export function WorkspaceRail({ sidebar, show, attention = {}, onSwitch, onCreate, onMove, onMenu, terminalsOf, onGoTo, onPage }: { sidebar: Sidebar; show: boolean; attention?: Record<string, number>; onCreate(name: string): void; onPage?(id: string): void } & Actions) {
  const reduce = useReducedMotion()
  const [hint, setHint] = useState<Hint | null>(null), [naming, setNaming] = useState(false)
  const items = railItems(sidebar, attention)
  const a: Actions = { onSwitch: (id) => { if (id !== sidebar.active) onSwitch(id) }, onMove, onMenu, terminalsOf, onGoTo }
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="rail-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
        >
          <nav className="rail" aria-label={t('sidebar.WorkspaceRail.workspaces')}>
            {items.length > 0 && (
              <>
                <ul className="rail-list">{items.map((it) => <RailButton key={it.id} item={it} sidebar={sidebar} a={a} onHint={setHint} />)}</ul>
                <div className="rail-sep" aria-hidden="true" />
              </>
            )}
            {/* Os Espaços da barra, com o atual em destaque (como o rodapé da barra aberta, em coluna). */}
            <ul className="rail-pages">
              {sidebar.pages.map((p) => {
                const current = p.id === sidebar.activePage
                return <li key={p.id} className="rail-li">
                  <button type="button" className={`rail-item rail-page${current ? ' current' : ''}`} aria-label={t('sidebar.WorkspaceRail.espaco_name', { name: p.name })} title={p.name} aria-current={current ? 'true' : undefined}
                    style={p.color ? { color: p.color } : undefined} onClick={() => { if (!current) onPage?.(p.id) }}>
                    <Glyph icon={p.icon} color={p.color} image={null} size={16} />
                  </button>
                </li>
              })}
            </ul>
            <div className="rail-add">
              <button type="button" className="rail-plus" title={t('sidebar.WorkspaceRail.novo_workspace')} aria-label={t('sidebar.WorkspaceRail.novo_workspace')} onClick={() => setNaming(true)}><Plus size={16} /></button>
            </div>
            {naming && (
              <input className="rail-name" aria-label={t('sidebar.WorkspaceRail.nome_do_workspace')} placeholder={t('sidebar.WorkspaceRail.nome_do_workspace')} autoFocus onBlur={() => setNaming(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setNaming(false) }
                  if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) { setNaming(false); onCreate(v) } }
                }} />
            )}
            {hint && (
              <div className="rail-hint" aria-hidden="true" style={{ transform: `translate(8px, ${hint.midY - 10}px)` }}>
                <span>{hint.text}</span>{hint.detail && <span className="rail-hint-detail">{hint.detail}</span>}
              </div>
            )}
          </nav>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
