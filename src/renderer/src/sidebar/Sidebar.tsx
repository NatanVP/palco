import { matchesShortcut } from '../settings/preferences'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRightLeft, ChevronRight, FolderPlus, Palette, Pencil, Plus, Search, SquareTerminal, Trash2 } from 'lucide-react'
import { HOME_PAGE_ID, type Sidebar as SidebarState, type Space, type WorkspaceMeta } from '../../../shared/model'
import { clampSidebarWidth, countLabel, dropIndex, filterWorkspaces, SIDEBAR_DEFAULT } from './sidebar-layout'
import { SpaceBar } from './SpaceBar'
import { Glyph, useWorkspaceImage } from './workspace-icons'
import { WorkspaceStyleSheet } from './WorkspaceStyleSheet'
import { t } from '../i18n'

interface Props {
  sidebar: SidebarState
  /** Terminais do workspace ativo, ao vivo (os outros vêm da barra do main). */
  activeTerminals: number
  /** Antes de trocar, o App grava a câmera pendente do workspace atual. */
  onSwitch(id: string): void
  onRemoveWorkspace(meta: WorkspaceMeta): void
  onRemoveSpace(space: Space): void
  onError(title: string, err: unknown): void
  /** Oculta (largura 0); quem manda é o App, porque a pílula do topo também alterna. */
  hidden: boolean
  onToggleHidden(): void
}

type Editing =
  | { kind: 'new-workspace'; spaceId: string | null }
  | { kind: 'new-space' }
  | { kind: 'rename-workspace'; id: string }
  | { kind: 'rename-space'; id: string }

type Menu = { x: number; y: number; items: Array<{ label: string; icon: ReactNode; danger?: boolean; disabled?: boolean; run(): void }> }
type Drop = { key: string; caret?: { id: string; after: boolean } }

const DRAG_TYPE = 'application/x-palco-workspace'
const WIDTH_KEY = 'palco.sidebarWidth'
const SPRING = { type: 'spring' as const, stiffness: 380, damping: 36, mass: 0.9 }

const pageOf = (x: { pageId?: string }): string => x.pageId ?? HOME_PAGE_ID

/** Glifo do workspace na linha: imagem própria, ícone e cor. */
function RowGlyph({ meta }: { meta: WorkspaceMeta }) {
  const image = useWorkspaceImage(meta.id)
  return <span className="ws-icon"><Glyph icon={meta.icon} color={meta.color} image={image} size={14} /></span>
}

function InlineInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone(value: string | null): void }) {
  return (
    <input
      className="sidebar-input"
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(e.currentTarget.value.trim() || null)
        if (matchesShortcut('cancel', e)) onDone(null)
      }}
    />
  )
}

/** Barra lateral para organizar workspaces e espaços, com largura ajustável. */
export function Sidebar({ sidebar, activeTerminals, onSwitch, onRemoveWorkspace, onRemoveSpace, onError, hidden, onToggleHidden }: Props) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [dropAt, setDropAt] = useState<Drop | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  /** Workspace aberto na folha "Editar workspace". */
  const [styling, setStyling] = useState<string | null>(null)
  const [width, setWidth] = useState(() => clampSidebarWidth(Number(localStorage.getItem(WIDTH_KEY) ?? SIDEBAR_DEFAULT)))
  const reduce = useReducedMotion()
  const resizing = useRef<{ x: number; w: number } | null>(null)
  const api = window.palco

  const run = (title: string, p: Promise<unknown>): void => void p.catch((err: unknown) => onError(title, err))

  // Ctrl/Cmd+B mostra e esconde a barra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (!typing && matchesShortcut('toggleSidebar', e)) { e.preventDefault(); onToggleHidden() }
      if (matchesShortcut('cancel', e)) setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggleHidden])
  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)) }, [width])

  const finish = (value: string | null): void => {
    const e = editing
    setEditing(null)
    if (!e || value === null) return
    if (e.kind === 'new-workspace') run(t('sidebar.Sidebar.nao_foi_possivel_criar_o_works'), api.workspaces.create(value, e.spaceId).then((id) => onSwitch(id)))
    else if (e.kind === 'new-space') run(t('sidebar.Sidebar.nao_foi_possivel_criar_o_grupo'), api.spaces.create(value))
    else if (e.kind === 'rename-workspace') run(t('sidebar.Sidebar.nao_foi_possivel_renomear'), api.workspaces.rename(e.id, value))
    else run(t('sidebar.Sidebar.nao_foi_possivel_renomear'), api.spaces.rename(e.id, value))
  }

  // Só o Espaço (página) ativo aparece: os grupos e os workspaces dele.
  const page = sidebar.activePage
  const visible = filterWorkspaces(sidebar.workspaces.filter((w) => pageOf(w) === page), filter)
  const groups = sidebar.spaces.filter((g) => pageOf(g) === page)
  const filtering = filter.trim() !== ''
  const groupOf = (spaceId: string | null): WorkspaceMeta[] => {
    const byId = new Map(visible.map((w) => [w.id, w]))
    return sidebar.order.map((id) => byId.get(id)).filter((w): w is WorkspaceMeta => !!w && w.spaceId === spaceId)
  }

  /** Solta o workspace arrastado no grupo `spaceId`, antes ou depois de `anchor` (fim do grupo sem âncora). */
  const drop = (e: DragEvent, spaceId: string | null, anchor?: { id: string; after: boolean }): void => {
    e.preventDefault()
    e.stopPropagation()
    setDropAt(null)
    const id = e.dataTransfer.getData(DRAG_TYPE)
    if (!id || anchor?.id === id) return
    // O índice vale na lista completa do grupo: o filtro só esconde itens.
    const full = sidebar.order.filter((wid) => {
      const w = sidebar.workspaces.find((x) => x.id === wid)
      return !!w && w.spaceId === spaceId && (spaceId !== null || pageOf(w) === page)
    })
    run(t('sidebar.Sidebar.nao_foi_possivel_mover_o_works'), api.workspaces.move(id, spaceId, dropIndex(full, id, anchor)))
  }
  const overTarget = (key: string) => (e: DragEvent): void => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropAt?.key !== key || dropAt.caret) setDropAt({ key })
  }

  const openMenu = (e: React.MouseEvent, items: Menu['items']): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const row = (w: WorkspaceMeta): ReactNode => {
    if (editing?.kind === 'rename-workspace' && editing.id === w.id) {
      return <InlineInput key={w.id} initial={w.name} placeholder={t('sidebar.Sidebar.nome_do_workspace')} onDone={finish} />
    }
    const active = w.id === sidebar.active
    const count = active ? activeTerminals : (w.terminals ?? 0)
    const caret = dropAt?.caret?.id === w.id ? dropAt.caret : undefined
    return (
      <motion.div layout={reduce ? false : 'position'} transition={{ duration: 0.2, ease: 'easeOut' }} key={w.id} className="ws-slot">
        {caret && !caret.after && <span className="insert-caret top" />}
        <button
          className={`ws-row${active ? ' active' : ''}${dragging === w.id ? ' dragging' : ''}`}
          draggable
          title={w.name}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, w.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragging(w.id)
          }}
          onDragEnd={() => { setDropAt(null); setDragging(null) }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            const box = e.currentTarget.getBoundingClientRect()
            const after = e.clientY >= box.top + box.height / 2
            if (dropAt?.caret?.id !== w.id || dropAt.caret.after !== after) setDropAt({ key: `w:${w.id}`, caret: { id: w.id, after } })
          }}
          onDrop={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            drop(e, w.spaceId, { id: w.id, after: e.clientY >= box.top + box.height / 2 })
          }}
          onClick={() => !active && onSwitch(w.id)}
          onDoubleClick={() => setEditing({ kind: 'rename-workspace', id: w.id })}
          onContextMenu={(e) => openMenu(e, [
            { label: t('sidebar.Sidebar.editar_workspace'), icon: <Palette size={14} />, run: () => setStyling(w.id) },
            { label: t('sidebar.Sidebar.renomear'), icon: <Pencil size={14} />, run: () => setEditing({ kind: 'rename-workspace', id: w.id }) },
            ...sidebar.pages.filter((p) => p.id !== page).map((p) => ({
              label: t('sidebar.Sidebar.mover_para_name', { name: p.name }), icon: <ArrowRightLeft size={14} />,
              run: () => run(t('sidebar.Sidebar.nao_foi_possivel_mover_o_works'), api.workspaces.move(w.id, null, sidebar.workspaces.filter((x) => pageOf(x) === p.id && x.spaceId === null).length, p.id))
            })),
            { label: t('sidebar.Sidebar.excluir_workspace'), icon: <Trash2 size={14} />, danger: true, disabled: sidebar.workspaces.length <= 1, run: () => onRemoveWorkspace(w) }
          ])}
          style={{ paddingRight: 8 + (count > 0 ? 40 : 0) }}
        >
          <RowGlyph meta={w} />
          <span className="ws-name">{w.name}</span>
          {count > 0 && (
            <span className={`term-pill${active ? ' live' : ''}`} title={t('sidebar.Sidebar.count_terminal', { count })}>
              <SquareTerminal size={14} />
              <span>{countLabel(count)}</span>
            </span>
          )}
        </button>
        {caret && caret.after && <span className="insert-caret bottom" />}
      </motion.div>
    )
  }

  const newWorkspaceInput = (spaceId: string | null): ReactNode =>
    editing?.kind === 'new-workspace' && editing.spaceId === spaceId ? <InlineInput initial="" placeholder={t('sidebar.Sidebar.nome_do_workspace')} onDone={finish} /> : null

  const loose = groupOf(null)

  return (
    <>
      <motion.aside
        className="sidebar"
        aria-label={t('sidebar.Sidebar.workspaces')}
        aria-hidden={hidden}
        inert={hidden}
        initial={false}
        animate={{ width: hidden ? 0 : width }}
        transition={reduce || resizing.current ? { duration: 0 } : SPRING}
        onClick={() => setMenu(null)}
      >
        <div className="sidebar-inner" style={{ width }}>
          <header className="sidebar-head">
            <label className="sidebar-filter">
              <Search size={16} />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('sidebar.Sidebar.filtrar')} aria-label={t('sidebar.Sidebar.filtrar_workspaces')} />
            </label>
            <button className="sidebar-new" title={t('sidebar.Sidebar.novo_workspace')} aria-label={t('sidebar.Sidebar.novo_workspace')} onClick={() => setEditing({ kind: 'new-workspace', spaceId: null })}>
              <Plus size={20} />
            </button>
          </header>

          <div
            className={`section-title${dropAt?.key === 'loose' ? ' drop' : ''}`}
            onDragOver={overTarget('loose')}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => drop(e, null)}
            onContextMenu={(e) => openMenu(e, [
              { label: t('sidebar.Sidebar.novo_workspace'), icon: <Plus size={14} />, run: () => setEditing({ kind: 'new-workspace', spaceId: null }) },
              { label: t('sidebar.Sidebar.novo_grupo'), icon: <FolderPlus size={14} />, run: () => setEditing({ kind: 'new-space' }) }
            ])}
          >
            <span>{sidebar.pages.find((p) => p.id === page)?.name ?? t('sidebar.Sidebar.workspaces')}</span>
            <button className="title-btn" title={t('sidebar.Sidebar.novo_grupo')} aria-label={t('sidebar.Sidebar.novo_grupo')} onClick={() => setEditing({ kind: 'new-space' })}>
              <FolderPlus size={13} />
            </button>
          </div>

          <div className="sidebar-list">
            <div className="ws-group" onDragOver={overTarget('loose')} onDrop={(e) => drop(e, null)}>
              {loose.map(row)}
              {newWorkspaceInput(null)}
              {loose.length === 0 && groups.length === 0 && !filtering && !editing && (
                <p className="ws-empty">{t('sidebar.Sidebar.nenhum_workspace_neste_espaco_')}</p>
              )}
            </div>

            {groups.map((space) => {
              const members = groupOf(space.id)
              if (filtering && members.length === 0) return null
              const open = filtering || !space.collapsed
              const key = `s:${space.id}`
              return (
                <section key={space.id} className="space">
                  {editing?.kind === 'rename-space' && editing.id === space.id ? (
                    <InlineInput initial={space.name} placeholder={t('sidebar.Sidebar.nome_do_grupo')} onDone={finish} />
                  ) : (
                    <button
                      className={`space-head${dropAt?.key === key ? ' drop' : ''}`}
                      aria-expanded={open}
                      onClick={() => run(t('sidebar.Sidebar.nao_foi_possivel_recolher'), api.spaces.toggle(space.id))}
                      onDoubleClick={() => setEditing({ kind: 'rename-space', id: space.id })}
                      onDragOver={overTarget(key)}
                      onDragLeave={() => setDropAt(null)}
                      onDrop={(e) => drop(e, space.id)}
                      onContextMenu={(e) => openMenu(e, [
                        { label: t('sidebar.Sidebar.novo_workspace'), icon: <Plus size={14} />, run: () => { if (space.collapsed) run(t('sidebar.Sidebar.nao_foi_possivel_expandir'), api.spaces.toggle(space.id)); setEditing({ kind: 'new-workspace', spaceId: space.id }) } },
                        { label: t('sidebar.Sidebar.renomear'), icon: <Pencil size={14} />, run: () => setEditing({ kind: 'rename-space', id: space.id }) },
                        { label: t('sidebar.Sidebar.excluir_grupo'), icon: <Trash2 size={14} />, danger: true, run: () => onRemoveSpace(space) }
                      ])}
                    >
                      <span className={`chevron${open ? ' open' : ''}`}><ChevronRight size={12} /></span>
                      <span className="space-name">{space.name}</span>
                    </button>
                  )}
                  {open && (
                    <div className="ws-group nested" onDragOver={overTarget(key)} onDrop={(e) => drop(e, space.id)}>
                      {members.map(row)}
                      {newWorkspaceInput(space.id)}
                    </div>
                  )}
                </section>
              )
            })}

            {editing?.kind === 'new-space' && <InlineInput initial="" placeholder={t('sidebar.Sidebar.nome_do_grupo')} onDone={finish} />}
          </div>
          <SpaceBar sidebar={sidebar} onError={onError} onMenu={openMenu} />
        </div>
        {!hidden && (
          <div
            className="sidebar-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('sidebar.Sidebar.redimensionar_barra_lateral')}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              resizing.current = { x: e.clientX, w: width }
            }}
            onPointerMove={(e) => { if (resizing.current) setWidth(clampSidebarWidth(resizing.current.w + e.clientX - resizing.current.x)) }}
            onPointerUp={() => { resizing.current = null }}
            onPointerCancel={() => { resizing.current = null }}
            onLostPointerCapture={() => { resizing.current = null }}
            onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
          />
        )}
      </motion.aside>

      {styling && sidebar.workspaces.some((w) => w.id === styling) && (
        <WorkspaceStyleSheet key={styling} meta={sidebar.workspaces.find((w) => w.id === styling)!} onClose={() => setStyling(null)} onError={onError} />
      )}

      {menu && (
        <div className="ctx-back" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}>
          <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            {menu.items.map((it) => (
              <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { setMenu(null); it.run() }}>
                {it.icon}<span>{it.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
