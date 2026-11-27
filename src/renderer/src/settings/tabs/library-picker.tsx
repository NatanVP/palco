import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Check, ChevronRight, Plus, SquarePen, Trash2 } from 'lucide-react'
import { t } from '../../i18n'

/** O seletor de bibliotecas (Responsabilidades e Prompts): busca, pílulas de espaço de trabalho, linha de criar e a lista em grupos. */

export interface Workspace { id: string; name: string }
/** `'all'`, `''` (global) ou o id de um espaço de trabalho. */
export type ScopeFilter = string
export const ALL: ScopeFilter = 'all'
export const GLOBAL: ScopeFilter = ''

export function ScopePills({ workspaces, value, label, onChange }: { workspaces: Workspace[]; value: ScopeFilter; label: string; onChange(value: ScopeFilter): void }) {
  const refs = useRef(new Map<ScopeFilter, HTMLButtonElement>())
  const pills = [{ id: ALL, name: t('settings.tabs.agent-libraries.todos') }, { id: GLOBAL, name: t('settings.tabs.agent-libraries.global') }, ...workspaces]
  const arrows = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = pills[(pills.findIndex(p => p.id === value) + (e.key === 'ArrowRight' ? 1 : -1) + pills.length) % pills.length]!
    onChange(next.id); refs.current.get(next.id)?.focus()
  }
  return <div role="radiogroup" aria-label={label} className="library-pills" onKeyDown={arrows}>
    {pills.map(p => <button key={p.id} ref={el => { if (el) refs.current.set(p.id, el); else refs.current.delete(p.id) }} type="button" role="radio" aria-checked={p.id === value} tabIndex={p.id === value ? 0 : -1} onClick={() => onChange(p.id)}>{p.name}</button>)}
  </div>
}

export interface PickerItem { id: string; name: string; workspaceId: string | null; description: string; icon: ReactNode; usage?: number; haystack: string }
export interface PickerSection { id: string; title: string; items: PickerItem[] }

/**
 * Itens visíveis, em grupos: Global e depois cada espaço, na ordem deles. Item de um espaço que sumiu entra no Global
 * ou, com `orphanTitle`, num grupo próprio no fim.
 */
export function pickerView(items: PickerItem[], workspaces: Workspace[], scope: ScopeFilter, search: string, orphanTitle?: string): { sections: PickerSection[]; pills: Workspace[] } {
  const query = search.trim().toLocaleLowerCase()
  const known = new Set(workspaces.map(w => w.id))
  const nameOf = (id: string | null): string => workspaces.find(w => w.id === id)?.name ?? ''
  const hit = (i: PickerItem): boolean => !query || `${i.haystack} ${nameOf(i.workspaceId)}`.toLocaleLowerCase().includes(query)
  const shown = items.filter(hit)
  const orphan = (i: PickerItem): boolean => i.workspaceId !== null && !known.has(i.workspaceId)
  const global = { id: 'global', title: t('settings.tabs.agent-libraries.global'), items: shown.filter(i => i.workspaceId === null || (orphanTitle === undefined && orphan(i))) }
  const lost: PickerSection[] = orphanTitle === undefined ? [] : [{ id: 'unavailable', title: orphanTitle, items: shown.filter(orphan) }]
  const of = (w: Workspace): PickerSection => ({ id: w.id, title: w.name, items: shown.filter(i => i.workspaceId === w.id) })
  const sections = scope === ALL ? [global, ...workspaces.map(of), ...lost] : scope === GLOBAL ? [global] : [of(workspaces.find(w => w.id === scope) ?? { id: scope, name: scope })]
  const pills = workspaces.filter(w => !query || w.id === scope || w.name.toLocaleLowerCase().includes(query) || shown.some(i => i.workspaceId === w.id))
  return { sections: sections.filter(s => s.items.length > 0), pills }
}

interface ListProps {
  sections: PickerSection[]
  selected: readonly string[]
  /** Aceita várias linhas selecionadas (Ctrl, Shift, Espaço). */
  multi?: boolean
  labels: { list: string; newItem: string; editItem: string }
  disabled?: boolean
  onSelect(ids: string[]): void
  onCreate(): void
  onEdit(id: string): void
  onDelete(ids: string[]): void
}

export function PickerList({ sections, selected, multi = false, labels, disabled = false, onSelect, onCreate, onEdit, onDelete }: ListProps) {
  const [expanded, setExpanded] = useState<string | null>(null), [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>()), anchor = useRef<string | null>(null)
  const flat = sections.flatMap(s => s.items), ids = flat.map(i => i.id)
  const chosen = ids.filter(id => selected.includes(id))
  const toggle = (id: string): void => { anchor.current = id; onSelect(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]) }
  const pick = (id: string, mods: { toggle: boolean; range: boolean }): void => {
    if (multi && mods.toggle) return toggle(id)
    const from = ids.indexOf(anchor.current ?? ''), to = ids.indexOf(id)
    if (multi && mods.range && from >= 0) return onSelect(ids.slice(Math.min(from, to), Math.max(from, to) + 1))
    anchor.current = id; onSelect([id])
  }
  /** Excluir a partir de uma linha leva a seleção inteira quando ela faz parte de uma seleção múltipla. */
  const removeFrom = (id: string): void => onDelete(chosen.length > 1 && chosen.includes(id) ? chosen : [id])
  const keys = (e: KeyboardEvent, id: string): void => {
    const i = ids.indexOf(id)
    if (multi && e.key === ' ') { e.preventDefault(); return toggle(id) }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (!disabled) removeFrom(id); return }
    const to = e.key === 'ArrowDown' ? (i + 1) % ids.length : e.key === 'ArrowUp' ? (i - 1 + ids.length) % ids.length : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = ids[to]!
    pick(next, { toggle: false, range: e.shiftKey }); buttons.current.get(next)?.focus()
  }
  const focusable = chosen[0] ?? ids[0]
  const row = (item: PickerItem) => {
    const on = selected.includes(item.id), open = expanded === item.id
    // Ocupada, a lista só deixa selecionar e abrir descrições: nada que chame o main.
    const context = (e: MouseEvent): void => { e.preventDefault(); if (!disabled) setMenu({ id: item.id, x: e.clientX, y: e.clientY }) }
    const edit = (): void => { if (!disabled) onEdit(item.id) }
    return <div key={item.id} data-item={item.id} className={`library-row${on ? ' selected' : ''}${open ? ' open' : ''}`} onContextMenu={context}>
      <div className="library-line">
        <button type="button" className="library-expand" aria-expanded={open} aria-label={open ? t('settings.agentes.ocultar_descricao') : t('settings.agentes.mostrar_descricao')} onClick={() => setExpanded(open ? null : item.id)}><ChevronRight size={10} strokeWidth={3} aria-hidden="true" /></button>
        <button type="button" className="library-select" ref={el => { if (el) buttons.current.set(item.id, el); else buttons.current.delete(item.id) }} {...(multi ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on })} tabIndex={item.id === focusable ? 0 : -1}
          onClick={e => pick(item.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })} onDoubleClick={edit} onKeyDown={e => keys(e, item.id)}>
          <span className="library-icon">{item.icon}</span><span className="library-name">{item.name}</span>
          {!!item.usage && <span className="library-usage">{t('settings.agentes.em_uso_por', { total: item.usage })}</span>}
          <Check size={12} strokeWidth={3} className="library-check" aria-hidden="true" />
        </button>
        <button type="button" className="library-delete" disabled={disabled} aria-label={t('settings.tabs.presets-panel.excluir_name', { name: item.name })} title={t('settings.tabs.presets-panel.excluir_name', { name: item.name })} onClick={() => onDelete([item.id])}><Trash2 size={12} aria-hidden="true" /></button>
      </div>
      {open && <div className="library-description"><p onDoubleClick={edit}>{item.description}</p>
        <button type="button" disabled={disabled} aria-label={t('settings.tabs.presets-panel.editar_name', { name: item.name })} title={t('settings.tabs.presets-panel.editar_name', { name: item.name })} onClick={() => onEdit(item.id)}><SquarePen size={12} aria-hidden="true" /></button></div>}
    </div>
  }
  const role = multi ? 'group' : 'radiogroup'
  return <div className="library-list">
    <button type="button" className="library-new" disabled={disabled} onClick={onCreate}><span className="library-icon"><Plus size={12} aria-hidden="true" /></span>{labels.newItem}</button>
    {sections.length > 0 && <div role={role} aria-label={labels.list}>
      {sections.length === 1 && sections[0]!.id !== 'unavailable' ? sections[0]!.items.map(row) : sections.map(s => <div key={s.id} role="group" aria-label={s.title}><h4 className="library-group-title">{s.title}</h4>{s.items.map(row)}</div>)}
    </div>}
    {multi && chosen.length > 1 && <button type="button" className="library-delete-selection" disabled={disabled} onClick={() => onDelete(chosen)}>{t('settings.agentes.excluir_selecao', { total: chosen.length })}</button>}
    {menu && !disabled && <RowMenu at={menu} close={() => setMenu(null)} items={[
      ...(multi ? [{ id: 'select', label: selected.includes(menu.id) ? t('settings.agentes.tirar_da_selecao') : t('settings.agentes.adicionar_a_selecao'), run: () => toggle(menu.id) }] : []),
      { id: 'edit', label: labels.editItem, run: () => onEdit(menu.id) },
      { id: 'delete', label: t('settings.tabs.agent-libraries.excluir'), run: () => removeFrom(menu.id), danger: true }
    ]} />}
  </div>
}

function RowMenu({ at, items, close }: { at: { x: number; y: number }; items: Array<{ id: string; label: string; run(): void; danger?: boolean }>; close(): void }) {
  const root = useRef<HTMLDivElement>(null), latest = useRef(close)
  latest.current = close
  useEffect(() => {
    root.current?.querySelector('button')?.focus()
    const outside = (e: Event): void => { if (!root.current?.contains(e.target as Node)) latest.current() }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  }, [])
  // data-inline-editor: o Escape aqui fecha só o menu, não as Configurações.
  return <div ref={root} role="menu" className="library-menu" data-inline-editor="" style={{ left: at.x, top: at.y }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }}>
    {items.map(i => <button key={i.id} type="button" role="menuitem" className={i.danger ? 'is-danger' : ''} onClick={() => { close(); i.run() }}>{i.label}</button>)}
  </div>
}
