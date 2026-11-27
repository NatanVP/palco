import { useEffect, useRef, useState } from 'react'
import { BookOpen, MoreHorizontal, RefreshCw, X } from 'lucide-react'
import type { Partitura } from '../../../shared/model'
import type { PartituraReview, PartituraUpdatePreview } from '../../../shared/partitura-review'
import { matchesShortcut } from '../settings/preferences'
import { t } from '../i18n'
import './partituras.css'
import { PartituraPreview } from './PartituraPreview'
import { PartituraReviewList } from './PartituraReviewList'

type Selection = { mode: 'create' | 'update'; nodeIds: string[] }
type Editor = { kind: 'save'; nodeIds?: string[] } | { kind: 'rename'; target: string }
type Review = { kind: 'import'; document: string; items: PartituraReview[] } | { kind: 'run'; item: PartituraReview }
const editorFor = (selection?: Selection): Editor | null => (selection?.mode === 'create' ? { kind: 'save', nodeIds: selection.nodeIds } : null)
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^(Error: )?Error invoking remote method '[^']*': /, '').replace(/^(\w*Error: )+/, '')
/** Com um modal na frente o Escape é dele, onde quer que o foco esteja. */
const MODAL_OPEN = '[aria-modal="true"], .modal-back'
/** Onde o Escape é de outro: terminal, campo, diálogo ou menu fora do painel. */
const OWNS_ESCAPE = '.xterm, input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], .composer'

interface Props {
  onClose(): void
  selection?: Selection
  /** Sobe a cada pedido do menu do botão direito: o painel já aberto troca de tela. */
  request?: number
  /** A pessoa desistiu de salvar ou atualizar com a seleção. */
  onSelectionDone?(): void
}

export function PartituraMenu({ onClose, selection, request, onSelectionDone }: Props) {
  const [items, setItems] = useState<Array<Pick<Partitura, 'name' | 'description' | 'createdAt'>>>([])
  const [editor, setEditor] = useState<Editor | null>(() => editorFor(selection))
  const [name, setName] = useState(''), [noteText, setNoteText] = useState(true), [commands, setCommands] = useState(true)
  const [menu, setMenu] = useState<string | null>(null), [remove, setRemove] = useState<string | null>(null)
  const [review, setReview] = useState<Review | null>(null), [pending, setPending] = useState<PartituraUpdatePreview | null>(null)
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const panel = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null), file = useRef<HTMLInputElement>(null)
  const label = (key: string) => t(`partituras.panel.${key}` as Parameters<typeof t>[0])
  const updating = selection?.mode === 'update' ? selection : undefined
  /** Troca de tela sempre começa limpa: sem menu, erro ou confirmação da tela anterior. */
  const reset = (next: Editor | null = null) => { setEditor(next); setName(next?.kind === 'rename' ? next.target : ''); setReview(null); setPending(null); setRemove(null); setMenu(null); setError('') }
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError(''); setMenu(null)
    try { await fn(); setItems(await window.palco.partitura.list()) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  useEffect(() => { let live = true; window.palco.partitura.list().then(p => { if (live) setItems(p) }).catch(e => { if (live) setError(errorText(e)) }); const previous = document.activeElement as HTMLElement; if (!panel.current?.contains(document.activeElement)) close.current?.focus(); return () => { live = false; if (previous?.isConnected) previous.focus() } }, [])
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } reset(editorFor(selection)) }, [request, selection])
  // O botão ou o formulário que tinha o foco some depois da ação: o foco volta ao painel.
  useEffect(() => { if (!document.activeElement || document.activeElement === document.body) panel.current?.focus() }, [editor, review, pending, remove, menu, items, busy])

  const cancelEditor = () => { const fromSelection = editor?.kind === 'save' && editor.nodeIds !== undefined; reset(); if (fromSelection) onSelectionDone?.() }
  const back = () => {
    if (menu !== null) setMenu(null)
    else if (review !== null || pending !== null || remove !== null) { setReview(null); setPending(null); setRemove(null); setError('') }
    else if (editor !== null) cancelEditor()
    else onClose()
  }
  const latestBack = useRef(back)
  latestBack.current = back
  useEffect(() => {
    // No documento: o Escape continua valendo quando o foco cai fora do painel (clique no canvas, botão que sumiu).
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matchesShortcut('cancel', e)) return
      const target = e.target instanceof Element ? e.target : null
      if (!target || !panel.current?.contains(target)) {
        if (target?.closest(OWNS_ESCAPE) || document.querySelector(MODAL_OPEN)) return
      }
      e.preventDefault(); e.stopImmediatePropagation(); latestBack.current()
    }
    // Em captura: o clique que fecha o menu vale mesmo onde alguém interrompe a propagação.
    const outside = (e: PointerEvent) => { if (!(e.target instanceof Element) || !e.target.closest('.partitura-actions, [data-menu-toggle]')) setMenu(null) }
    const resize = () => setPosition(at => {
      const el = panel.current, parent = el?.offsetParent as HTMLElement | null
      return at && el && parent ? { left: Math.max(0, Math.min(at.left, parent.clientWidth - el.offsetWidth)), top: Math.max(0, Math.min(at.top, parent.clientHeight - el.offsetHeight)) } : at
    })
    document.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', resize) }
  }, [])

  const download = async (target?: string) => {
    const document = await window.palco.partitura.export(target)
    const url = URL.createObjectURL(new Blob([document], { type: 'application/json' }))
    const a = window.document.createElement('a'); a.href = url; a.download = 'partituras.palco.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  /** Inserir nunca grava na partitura. Uma importada que vai iniciar comandos mostra-os antes. */
  const insert = (target: string) => void act(async () => {
    if (commands) {
      const item = await window.palco.partitura.inspect(target)
      if (item.imported && item.terminals.length) { setReview({ kind: 'run', item }); return }
    }
    await window.palco.partitura.insert(target, { commands })
  })
  const runReviewed = (target: string, start: boolean) => void act(async () => { await window.palco.partitura.insert(target, start ? { commands: true, confirmed: true } : { commands: false }); setReview(null) })
  const chooseFile = (chosen: File) => void act(async () => { const document = await chosen.text(); const found = await window.palco.partitura.reviewImport(document); reset(); setReview({ kind: 'import', document, items: found }) })
  const askUpdate = (target: string) => { setMenu(null); if (updating) void act(async () => setPending(await window.palco.partitura.updatePreview(target, { noteText, nodeIds: updating.nodeIds }))) }
  const confirmUpdate = (target: string) => void act(async () => { if (!updating) return; await window.palco.partitura.update(target, { noteText, nodeIds: updating.nodeIds }); onClose() })

  const changes = (title: string, list: PartituraUpdatePreview['added']) => list.length > 0 && <><h4>{title}</h4><ul>{list.map((x, i) => <li key={i}>{x.name} <small>{x.kind}</small></li>)}</ul></>
  const body = () => {
    if (review) return <div className="partitura-review" role="alertdialog" aria-label={label(review.kind === 'import' ? 'reviewImport' : 'reviewRun')}>
      <h2>{label(review.kind === 'import' ? 'reviewImport' : 'reviewRun')}</h2>
      <p>{label(review.kind === 'import' ? 'reviewImportHint' : 'reviewRunHint')}</p>
      <PartituraReviewList items={review.kind === 'import' ? review.items : [review.item]} />
      <small>{label('reviewFolderHint')}</small>
      <div className="partitura-buttons">
        <button autoFocus onClick={() => { setReview(null); setError('') }}>{t('partituras.PartituraMenu.cancelar')}</button>
        {review.kind === 'import'
          ? <button className="primary" disabled={busy} onClick={() => void act(async () => { await window.palco.partitura.import(review.document); setReview(null) })}>{label('acceptImport')}</button>
          : <><button disabled={busy} onClick={() => runReviewed(review.item.name, false)}>{label('insertStopped')}</button><button className="primary" disabled={busy} onClick={() => runReviewed(review.item.name, true)}>{label('insertAndStart')}</button></>}
      </div>
    </div>
    if (pending) return <div className="partitura-review" role="alertdialog" aria-label={label('confirmUpdate')}>
      <h2>{label('confirmUpdate')}</h2>
      <p>{t('partituras.update.summary', { name: pending.name, before: pending.before, after: pending.after })}</p>
      <p>{t('partituras.update.connections', { before: pending.connections[0], after: pending.connections[1] })}</p>
      <div className="partitura-review-list">
        {changes(label('removed'), pending.removed)}{changes(label('added'), pending.added)}{changes(label('changed'), pending.changed)}
        {!pending.removed.length && !pending.added.length && !pending.changed.length && <p>{label('sameContent')}</p>}
      </div>
      <small>{label('updateWarning')}</small>
      <div className="partitura-buttons">
        <button autoFocus onClick={() => { setPending(null); setError('') }}>{t('partituras.PartituraMenu.cancelar')}</button>
        <button className="danger" disabled={busy} onClick={() => confirmUpdate(pending.name)}>{label('applyUpdate')}</button>
      </div>
    </div>
    if (editor) return <form className="partitura-editor" onSubmit={e => { e.preventDefault(); void act(async () => {
      if (editor.kind === 'rename') await window.palco.partitura.rename(editor.target, name)
      else await window.palco.partitura.save(name, { noteText, ...(editor.nodeIds ? { nodeIds: editor.nodeIds } : {}) })
      setEditor(null)
      if (editor.kind === 'save' && editor.nodeIds) onClose()
    }) }}>
      <h2>{editor.kind === 'rename' ? label('rename') : editor.nodeIds ? t('ctx.salvar_selecao', { count: editor.nodeIds.length }) : label('saveFloor')}</h2>
      <input autoFocus aria-label={t('partituras.PartituraMenu.nome_da_partitura')} value={name} onChange={e => setName(e.target.value)} />
      {editor.kind === 'save' && <label><input type="checkbox" checked={noteText} onChange={e => setNoteText(e.target.checked)} />{t('partituras.PartituraMenu.incluir_texto_das_notas')}</label>}
      <button disabled={busy || !name.trim()}>{t('partituras.PartituraMenu.salvar')}</button>
      <button type="button" onClick={cancelEditor}>{t('partituras.PartituraMenu.cancelar')}</button>
    </form>
    if (!items.length) return <div className="partitura-empty">
      <BookOpen size={30} aria-hidden="true" /><h2>{label('emptyTitle')}</h2>
      <p>{label('emptyDescription')}</p><p>{label('emptySharing')}</p><small>{label('emptyCreation')}</small>
    </div>
    return <>
      <input className="partitura-search" type="search" aria-label={label('search')} placeholder={label('search')} value={search} onChange={e => setSearch(e.target.value)} />
      {updating && <div className="partitura-mode">
        <p>{t('ctx.atualizar_com_selecao', { count: updating.nodeIds.length })}</p>
        <label className="partitura-insert-option"><input type="checkbox" checked={noteText} onChange={e => setNoteText(e.target.checked)} />{t('partituras.PartituraMenu.incluir_texto_das_notas')}</label>
        <button onClick={() => onSelectionDone?.()}>{label('leaveUpdate')}</button>
      </div>}
      <div className="partitura-cards">{items.filter(p => `${p.name} ${p.description ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(p => <article key={p.name} className="partitura-card">
        <button data-partitura-card title={p.description} disabled={busy} onDoubleClick={() => insert(p.name)} onClick={e => { if (e.detail === 0) insert(p.name) }} onContextMenu={e => { e.preventDefault(); setMenu(p.name) }}><PartituraPreview name={p.name} /><strong>{p.name}</strong>{p.description && <small>{p.description}</small>}</button>
        <button data-menu-toggle aria-label={`${label('itemActions')} ${p.name}`} onClick={() => setMenu(menu === p.name ? null : p.name)}><MoreHorizontal size={16} /></button>
        {updating && <button className="partitura-update" disabled={busy} aria-label={t('ctx.atualizar_name', { name: p.name })} onClick={() => askUpdate(p.name)}><RefreshCw size={12} aria-hidden="true" />{label('update')}</button>}
        {menu === p.name && <div role="menu" className="partitura-actions">
          <button role="menuitem" disabled={busy} onClick={() => insert(p.name)}>{label('insert')}</button>
          <button role="menuitem" disabled={busy} onClick={() => reset({ kind: 'rename', target: p.name })}>{label('rename')}</button>
          {updating && <button role="menuitem" disabled={busy} onClick={() => askUpdate(p.name)}>{label('update')}</button>}
          <button role="menuitem" disabled={busy} onClick={() => void act(() => download(p.name))}>{label('export')}</button>
          <button role="menuitem" disabled={busy} onClick={() => { setMenu(null); setError(''); setRemove(p.name) }}>{t('partituras.PartituraMenu.excluir_2')}</button>
        </div>}
      </article>)}</div>
      <label className="partitura-insert-option"><input type="checkbox" checked={commands} onChange={e => setCommands(e.target.checked)} />{t('partituras.PartituraMenu.iniciar_agentes_ao_inserir')}</label>
      <small className="partitura-hint">{label('hint')}</small>
    </>
  }

  return <section ref={panel} tabIndex={-1} className="partitura-panel" style={position ? { left: position.left, top: position.top, right: 'auto', maxHeight: `calc(100% - ${position.top}px)`, maxWidth: `min(460px, calc(100% - ${position.left}px))` } : undefined} role="dialog" aria-modal="false" aria-label={t('partituras.PartituraMenu.partituras')} onPointerDown={e => e.stopPropagation()}>
    <header className="partitura-panel-head" onPointerDown={e => {
      if (e.button !== 0 || (e.target as Element).closest('button,[role=menu]')) return
      const rect = panel.current!.getBoundingClientRect(), parent = panel.current!.offsetParent?.getBoundingClientRect()
      drag.current = { x: e.clientX, y: e.clientY, left: rect.left - (parent?.left ?? 0), top: rect.top - (parent?.top ?? 0) }; e.currentTarget.setPointerCapture(e.pointerId)
    }} onPointerMove={e => {
      const d = drag.current, el = panel.current, parent = el?.offsetParent as HTMLElement | null
      if (d && el && parent) setPosition({ left: Math.max(0, Math.min(parent.clientWidth - el.offsetWidth, d.left + e.clientX - d.x)), top: Math.max(0, Math.min(parent.clientHeight - el.offsetHeight, d.top + e.clientY - d.y)) })
    }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <button ref={close} aria-label={t('partituras.PartituraMenu.fechar')} onClick={onClose}><X size={12} /></button>
      <button data-menu-toggle aria-label={label('actions')} aria-expanded={menu === '*'} onClick={() => setMenu(menu === '*' ? null : '*')}><MoreHorizontal size={16} /></button>
      {menu === '*' && <div className="partitura-actions" role="menu">
        <button role="menuitem" disabled={busy} onClick={() => { setMenu(null); file.current?.click() }}>{label('import')}</button>
        <button role="menuitem" disabled={busy || !items.length} onClick={() => void act(() => download())}>{label('exportAll')}</button>
        <button role="menuitem" disabled={busy} onClick={() => reset({ kind: 'save' })}>{label('saveFloor')}</button>
      </div>}
    </header>
    <input ref={file} hidden type="file" accept=".json,.palco" onChange={e => { const chosen = e.target.files?.[0]; if (chosen) chooseFile(chosen); e.target.value = '' }} />
    {body()}
    {remove !== null && <div className="partitura-confirm" role="alertdialog" aria-label={t('partituras.PartituraMenu.excluir_name_pergunta', { name: remove })}>
      <p>{t('partituras.PartituraMenu.excluir_name_pergunta', { name: remove })}</p>
      <button disabled={busy} onClick={() => void act(async () => { await window.palco.partitura.remove(remove); setRemove(null) })}>{t('partituras.PartituraMenu.excluir_2')}</button>
      <button autoFocus onClick={() => { setRemove(null); setError('') }}>{t('partituras.PartituraMenu.cancelar')}</button>
    </div>}
    {error && <p role="alert" className="palette-error">{error}</p>}
  </section>
}
