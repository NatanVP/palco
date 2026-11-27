import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import type { TerminalNode, Workspace } from '../../../shared/model'
import { usePreferences } from '../settings/preferences'
import { dismissComposer, useComposerMode } from './composer-mode'
import { applyMention, expandPastes, isLargePaste, mentionAt, mentionItems, pasteLabel, promptRows, SECTION_LABEL, type MentionItem } from './mentions'
import type { SavedPromptMeta } from '../../../shared/agent-libraries'
import { editorSelection, paintEditor, readEditor, setEditorSelection, type EditorPill } from './editor'
import { useHudGeometry } from './hud-geometry'
import { clearDraft, draftEntry, updateDraft, useDraft } from './composer-drafts'
import { composerMetrics } from './metrics'
import { t } from '../i18n'
import { shQuote } from '../../../shared/agent-command'
import { ArrowUp, Paperclip, LoaderCircle } from 'lucide-react'
import './composer.css'

/**
 * Compositor de Prompts: a caixa de texto do terminal. Em agente, a mensagem segue pelo chat (mesma entrega, fica no histórico); em shell,
 * o texto é digitado no terminal. `@` menciona terminais, notas, portais, andares, espaços de trabalho e arquivos; texto grande vira pílula.
 */
/** O texto da área de transferência só nomeia os arquivos colados (nome, caminho ou file://)? */
function onlyNames(text: string, files: File[]): boolean {
  const names = new Set<string>()
  for (const file of files) { const path = window.palco.files.pathOf(file); for (const n of [file.name, path, path && `file://${path}`, path && encodeURI(`file://${path}`)]) if (n) names.add(n) }
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).every(l => names.has(l))
}

export function Composer({ node }: { node: TerminalNode }) {
  const mode = useComposerMode(node.id)
  return <ComposerBox node={node} mode={mode} />
}

function ComposerBox({ node, mode }: { node: TerminalNode; mode: 'off' | 'overlay' | 'below' }) {
  const prefs = usePreferences(), m = composerMetrics(prefs.promptComposerFontSize)
  // Rascunho, cursor, anexos e o envio em andamento ficam fora do componente (um por terminal).
  const { state: saved, set: save } = useDraft(node.id)
  const draft = saved.text, caret = saved.caret, files = saved.files, busy = saved.sending
  const setDraft = (value: SetStateAction<string>): void => save('text', value), setCaret = (value: number): void => save('caret', value), setFiles = (value: SetStateAction<string[]>): void => save('files', value)
  const [error, setError] = useState('')
  const [ws, setWs] = useState<Workspace | null>(null), [pick, setPick] = useState(0), [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([])
  const pastes = { current: draftEntry(node.id).pastes }, area = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ path: string; url: string } | null>(null)
  const pills = { current: draftEntry(node.id).pills }
  // @Prompts: o submenu dos prompts salvos (do gerenciador em Configurações › Agentes › Prompts); null = o menu de menções.
  const [prompts, setPrompts] = useState<{ items: SavedPromptMeta[]; issues: number } | null>(null)
  const [browser, setBrowser] = useState<{ dir: string; rows: Array<{ name: string; dir: boolean }>; loading: boolean } | null>(null)
  const browserRevision = useRef(0)
  const hud = useRef<HTMLDivElement>(null)
  const geometry = useHudGeometry(hud, mode)
  const isSending = (): boolean => draftEntry(node.id).state.sending
  // O cursor só é reposto quando o CÓDIGO mudou o texto. Reagir ao onSelect recolheria a seleção que o usuário está fazendo.
  const pendingCaret = useRef<number | null>(null), caretNow = useRef(0)
  caretNow.current = caret
  const place = (position: number): void => { pendingCaret.current = position; setCaret(position) }
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => { if (mode !== 'off') { area.current?.focus(); setEditorSelection(area.current, caretNow.current) } }, [mode])
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const focused = document.activeElement === el, before = editorSelection(el)
    const repainted = paintEditor(el, draft, pills.current)
    const wanted = pendingCaret.current
    pendingCaret.current = null
    if (wanted !== null) setEditorSelection(el, wanted)
    else if (repainted && focused) setEditorSelection(el, before.start, before.end)
    el.style.height = 'auto'
    el.style.height = `${Math.min(m.maxHeight, Math.max(m.minHeight, el.scrollHeight))}px`
  }, [draft, caret, mode, m.minHeight, m.maxHeight])
  // Durante o envio o editor continua focado e "editável" para o teclado (senão o foco cai no BODY e Delete apaga o terminal);
  // o que muda o texto é recusado aqui.
  useEffect(() => {
    const el = area.current
    if (!el) return
    const refuse = (event: Event): void => { if (isSending()) event.preventDefault() }
    el.addEventListener('beforeinput', refuse)
    return () => el.removeEventListener('beforeinput', refuse)
  }, [mode !== 'off'])
  useEffect(() => { setDismissed(false) }, [draft, caret])
  useEffect(() => {
    if (mode === 'off') return
    let on = true
    const load = (): void => { void window.palco.workspace.get().then(w => { if (on) setWs(w) }).catch(() => {}) }
    void window.palco.workspaces.sidebar().then(s => { if (on) setSpaces(s.workspaces.map(w => ({ id: w.id, name: w.name }))) }).catch(() => {})
    load(); const off = window.palco.workspace.onChange(w => { if (on) setWs(w) })
    return () => { on = false; off() }
  }, [mode !== 'off'])
  const q = mentionAt(draft, caret)
  const items = useMemo((): MentionItem[] => browser && q ? browser.rows.filter(row => row.name.toLocaleLowerCase().includes(q.query.toLocaleLowerCase())).map(row => ({ section: 'files' as const, id: `${browser.dir.replace(/[/\\]$/, '')}/${row.name}`, label: row.name, hint: row.dir ? '›' : undefined, insert: row.dir ? undefined : shQuote(`${browser.dir.replace(/[/\\]$/, '')}/${row.name}`) })) : prompts && q ? promptRows(prompts.items, q.query, ws?.id ?? null).map(p => ({ section: 'prompts' as const, id: p.id, label: p.name, ...(p.description ? { hint: p.description } : {}) }))
    : (q && ws ? mentionItems({
    nodes: Object.values(ws.nodes).filter(n => n.floorId === node.floorId), selfId: node.id,
    floors: Object.values(ws.floors ?? {}).map(f => ({ id: f.id, name: f.name })), workspaces: spaces,
    actions: [{ id: 'newNote', label: t('composer.Composer.nova_nota') }]
  }, q.query, Boolean(window.palco.prompts)) : []), [q?.query, q?.start, ws, spaces, node.id, node.floorId, prompts, browser])
  useEffect(() => { if (q === null) { setPrompts(null); setBrowser(null); browserRevision.current++ } }, [q === null])
  const open = !dismissed && q !== null && (items.length > 0 || browser !== null)
  useEffect(() => { setPick(0) }, [q?.query, browser?.dir])
  const browse = (dir: string): void => {
    const revision = ++browserRevision.current
    setBrowser({ dir, rows: [], loading: true })
    void window.palco.files.list(dir).then(rows => { if (revision === browserRevision.current) setBrowser({ dir, rows, loading: false }) }).catch(() => {
      if (revision === browserRevision.current) { setBrowser({ dir, rows: [], loading: false }); setError(t('main.nao_foi_possivel_abrir_a_pasta')) }
    })
  }
  const parentDirectory = (dir: string): string => dir.replace(/[/\\][^/\\]+[/\\]?$/, '') || '/'
  const choose = (item: MentionItem): void => {
    if (!q || item.disabled || isSending()) return
    if (item.section === 'files') {
      if (!browser || !item.insert) {
        const dir = browser ? item.id : node.cwd
        setDraft(draft.slice(0, q.start) + '@' + draft.slice(caret)); place(q.start + 1)
        browse(dir); return
      }
      pills.current.set(item.insert, { label: item.label, expanded: item.insert })
      const r = applyMention(draft, caret, q.start, item.insert); setDraft(r.text); place(r.caret); setBrowser(null)
      return
    }
    if (item.section === 'prompts') {
      if (item.id === 'prompts') {
        // "Prompts…": abre o submenu dos prompts salvos (global + o deste espaço de trabalho) e limpa a consulta.
        setDraft(draft.slice(0, q.start) + '@' + draft.slice(caret)); place(q.start + 1)
        void window.palco.prompts.list(ws?.id).then(r => setPrompts({ items: r.items, issues: r.problems.length })).catch(() => setError(t('composer.Composer.nao_foi_possivel_ler_os_prompt')))
        return
      }
      void window.palco.prompts.read(item.id).then(p => { const r = applyMention(draft, caret, q.start, p.body); setDraft(r.text); place(r.caret); setPrompts(null); requestAnimationFrame(() => { setEditorSelection(area.current, r.caret) }) }).catch(() => setError(t('composer.Composer.nao_foi_possivel_ler_este_prom')))
      return
    }
    if (item.section === 'actions') {
      const r = applyMention(draft, caret, q.start, '').text.replace(/ {2,}/g, ' '); setDraft(r)
      if (item.id === 'newNote' && ws) void window.palco.node.add({ kind: 'note', floorId: node.floorId, name: 'Nota', content: '', pos: { x: node.pos.x + node.size.w + 40, y: node.pos.y }, size: { w: 260, h: 160 } } as never).catch(() => {})
      return
    }
    if (!item.insert) return
    pills.current.set(item.insert, { label: item.label, expanded: item.insert })
    const r = applyMention(draft, caret, q.start, item.insert); setDraft(r.text); place(r.caret)
    requestAnimationFrame(() => { setEditorSelection(area.current, r.caret) })
  }
  const fileToken = (path: string): string => `⟦file:${path}⟧`
  const send = async (): Promise<void> => {
    const text = expandPastes(draft, pastes.current).trim()
    if (isSending() || (!text && !files.length)) return
    // Foco no editor antes de desabilitar os botões: um botão focado que desabilita joga o foco no BODY.
    area.current?.focus()
    const sending = (value: boolean): void => updateDraft(node.id, () => ({ sending: value }))
    sending(true); setError('')
    try {
      if (node.agent === 'shell') {
        window.palco.terminal.write(node.id, `${[text, ...files.map(shQuote)].filter(Boolean).join(' ')}\r`)
        clearDraft(node.id); return
      }
      const r = await window.palco.chat.send(node.id, { text, attachments: files })
      if (r.accepted) clearDraft(node.id)
      else setError(r.cause === 'notRunning' ? t('composer.Composer.o_terminal_nao_esta_em_execuca') : r.cause === 'attachment' ? t('composer.Composer.anexo_recusado_v1', { v1: r.reason ?? '' }) : t('composer.Composer.nao_foi_possivel_enviar_a_mens'))
    } catch { setError(t('composer.Composer.nao_foi_possivel_enviar_a_mens')) }
    finally {
      sending(false)
      // Só retoma o teclado se ele continua aqui (ou ficou solto): quem foi para outro lugar não é puxado de volta.
      const active = document.activeElement
      if (!active || active === document.body || hud.current?.contains(active)) area.current?.focus()
    }
  }
  const close = (): void => {
    dismissComposer(node.id)
    requestAnimationFrame(() => {
      const card = document.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`)
      card?.querySelector<HTMLElement>('.xterm-helper-textarea, .node-body textarea, .node-body [tabindex]')?.focus({ preventScroll: true })
    })
  }
  /** Anexa arquivos; o que não existe em disco (imagem colada) é gravado antes numa pasta temporária do palco. */
  const attach = async (list: FileList | File[]): Promise<void> => {
    const found: string[] = []
    let failed = false
    for (const file of [...list]) {
      try {
        const path = window.palco.files.pathOf(file) || await window.palco.files.materialize(file.name, file.type, await file.arrayBuffer())
        if (path) found.push(path)
      } catch { failed = true }
    }
    if (failed) setError(t('composer.Composer.nao_foi_possivel_anexar'))
    const now = draftEntry(node.id).state
    const paths = [...new Set(found)].filter(path => !now.files.includes(path)).slice(0, 10 - now.files.length)
    if (!paths.length) return
    for (const path of paths) {
      const token = fileToken(path)
      pastes.current.set(token, '')
      pills.current.set(token, { label: path.split('/').pop() ?? path, expanded: '', path, removeLabel: t('composer.Composer.remover_f', { f: path }) })
    }
    const tokens = paths.map(fileToken).join(' ')
    // Entra no fim do que estiver escrito agora (o usuário pode ter digitado enquanto o arquivo era gravado).
    const next = `${now.text}${now.text && !/\s$/.test(now.text) ? ' ' : ''}${tokens}`
    setFiles([...now.files, ...paths]); setDraft(next); place(next.length)
  }
  /** Cola texto onde está o cursor; texto grande vira pílula. */
  const insertPasted = (el: HTMLElement, text: string): void => {
    let insert = text
    if (isLargePaste(text)) {
      insert = pasteLabel(pastes.current.size + 1, text); pastes.current.set(insert, text)
      pills.current.set(insert, { label: insert, expanded: text })
    }
    const { start, end } = editorSelection(el)
    setDraft(d => `${d.slice(0, start)}${insert}${d.slice(end)}`); place(start + insert.length)
  }
  const style = { fontSize: m.fontSize, lineHeight: `${m.lineHeight}px`, minHeight: m.minHeight, maxHeight: m.maxHeight }
  if (mode === 'off') return null
  return <div ref={hud} style={geometry} className={`composer ${mode}`} role="group" aria-label={t('composer.Composer.compositor_de_prompts')} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
    onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation() } }}
    onDrop={e => {
      e.preventDefault(); e.stopPropagation()
      if (busy) return
      if (e.dataTransfer.files.length) void attach(e.dataTransfer.files)
      else { const insert = e.dataTransfer.getData('text/plain'); const at = area.current ? editorSelection(area.current) : { start: draft.length, end: draft.length }; setDraft(d => d.slice(0, at.start) + insert + d.slice(at.end)); place(at.start + insert.length) }
    }}
    onKeyDown={e => { if (e.key === 'Escape' && e.target !== area.current) { e.preventDefault(); e.stopPropagation(); close() } }}>
    {open && <div data-composer-files-menu={browser ? true : undefined} id={`composer-menu-${node.id}`} className="composer-menu" role="listbox" aria-label={prompts ? t('composer.Composer.prompts_salvos') : t('composer.Composer.sugestoes_de_mencoes')}>
      {browser && <div className="composer-file-header"><button type="button" aria-label=".." onMouseDown={e => { e.preventDefault(); browse(parentDirectory(browser.dir)) }}>↑</button><span>{browser.dir}</span><button type="button" aria-label={t('composer.Composer.prompts_voltar_as_mencoes')} onMouseDown={e => { e.preventDefault(); browserRevision.current++; setBrowser(null) }}>←</button></div>}
      {prompts && <button type="button" className="composer-back" aria-label={t('composer.Composer.prompts_voltar_as_mencoes')} onMouseDown={e => { e.preventDefault(); setPrompts(null) }}>{t('composer.Composer.prompts')}</button>}
      {items.map((it, i) => <div key={`${it.section}:${it.id}`}>
        {!prompts && (i === 0 || items[i - 1]!.section !== it.section) && <div className="composer-section">{SECTION_LABEL[it.section]}</div>}
        <div id={`composer-option-${node.id}-${i}`} role="option" aria-selected={i === pick} aria-disabled={it.disabled ? true : undefined} title={it.disabled} className={`composer-item${i === pick ? ' active' : ''}${it.disabled ? ' disabled' : ''}`}
          onMouseDown={e => { e.preventDefault(); choose(it) }} onMouseEnter={() => setPick(i)}>{it.label}{it.hint && <small className="composer-hint">{it.hint}</small>}</div></div>)}
      {prompts && prompts.issues > 0 && <div className="composer-note">{t('composer.Composer.alguns_prompts_nao_puderam_ser')}</div>}
    </div>}
    {preview && <div className="composer-preview"><img src={preview.url} alt={preview.path} onError={() => setPreview(null)} /></div>}
    {error && <p className="chat-error" role="alert">{error}</p>}
    <div className="composer-row" style={{ '--composer-control-inset': `${(m.minHeight - 24) / 2 + 2}px` } as React.CSSProperties}>
      <button type="button" disabled={busy} aria-label={t('composer.Composer.anexar_arquivo')} title={t('composer.Composer.anexar_arquivo')} onClick={() => fileInput.current?.click()}><Paperclip size={14} strokeWidth={2.2} aria-hidden="true" /></button>
      <input ref={fileInput} type="file" multiple hidden tabIndex={-1} aria-hidden="true" onChange={e => { if (e.target.files) void attach([...e.target.files]); e.target.value = ''; area.current?.focus() }} />
      <div ref={area} contentEditable suppressContentEditableWarning aria-readonly={busy || undefined} aria-busy={busy || undefined} data-composer-editor="true" role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? `composer-menu-${node.id}` : undefined} aria-activedescendant={open ? `composer-option-${node.id}-${pick}` : undefined} aria-label={t('composer.Composer.entrada_de_prompt')} style={style}
        data-placeholder={t('composer.Composer.mensagem_para_name_para_mencio', { name: node.name })}
        onInput={e => {
          if ((e.nativeEvent as InputEvent).isComposing) return
          const text = readEditor(e.currentTarget)
          setDraft(text); setFiles(f => f.filter(path => text.includes(fileToken(path)))); setCaret(editorSelection(e.currentTarget).start)
        }}
        onCompositionEnd={e => { setDraft(readEditor(e.currentTarget)); setCaret(editorSelection(e.currentTarget).start) }}
        onSelect={e => setCaret(editorSelection(e.currentTarget).start)}
        onClick={e => {
          if (isSending()) return
          const pill = (e.target as HTMLElement).closest<HTMLElement>('[data-composer-pill]')
          if (!pill) { setCaret(editorSelection(e.currentTarget).start); return }
          const token = pill.dataset.composerValue!, data = pills.current.get(token)
          if (data?.path) {
            if ((e.target as HTMLElement).closest('[data-remove-attachment]')) { setDraft(d => d.replace(token, '')); setFiles(f => f.filter(path => path !== data.path)) }
            else void window.palco.files.read(data.path).then(r => { if (r.kind === 'image') setPreview({ path: data.path!, url: r.data }) }).catch(() => {})
            return
          }
          if (data) { pills.current.delete(token); e.currentTarget.dataset.painted = 'false'; setDraft(d => d.replace(token, data.expanded)); place(draft.indexOf(token) + data.expanded.length) }
        }}
        onPaste={e => {
          e.preventDefault()
          if (isSending()) return
          const pasted = [...(e.clipboardData.files ?? [])], text = e.clipboardData.getData('text/plain')
          // O texto nunca é descartado; só não entra o que apenas repete o nome, o caminho ou a URL de um arquivo colado.
          if (text && !(pasted.length && onlyNames(text, pasted))) insertPasted(e.currentTarget, text)
          if (pasted.length) void attach(pasted)
        }}
        onCopy={e => {
          const { start, end } = editorSelection(e.currentTarget)
          if (start === end) return // sem seleção não há o que copiar: a área de transferência fica como está
          e.preventDefault(); e.clipboardData.setData('text/plain', expandPastes(draft.slice(start, end), pastes.current))
        }}
        onCut={e => {
          const { start, end } = editorSelection(e.currentTarget)
          if (start === end) return
          if (isSending()) { e.preventDefault(); return }
          e.preventDefault(); e.clipboardData.setData('text/plain', expandPastes(draft.slice(start, end), pastes.current))
          const next = draft.slice(0, start) + draft.slice(end); setDraft(next); setFiles(f => f.filter(path => next.includes(fileToken(path)))); place(start)
        }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (open) {
            if (browser && e.key === 'ArrowLeft') { e.preventDefault(); browse(parentDirectory(browser.dir)); return }
            if (browser && e.key === 'ArrowRight') { const it = items[pick]; if (it && !it.insert) { e.preventDefault(); choose(it) }; return }
            if (e.key === 'ArrowDown') { e.preventDefault(); setPick(i => items.length ? (i + 1) % items.length : 0); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setPick(i => items.length ? (i + items.length - 1) % items.length : 0); return }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const it = items[pick]; if (it) choose(it); return }
          }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (preview) setPreview(null); else if (browser) { browserRevision.current++; setBrowser(null) } else if (open) { if (prompts) setPrompts(null); else setDismissed(true) } else close(); return }
          if (e.key === 'Enter' && (e.shiftKey || e.altKey)) {
            e.preventDefault()
            if (isSending()) return
            const { start, end } = editorSelection(e.currentTarget)
            setDraft(d => `${d.slice(0, start)}\n${d.slice(end)}`); place(start + 1); return
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
        }} />
      <button type="button" className="composer-send" aria-label={t('composer.Composer.enviar')} aria-busy={busy} disabled={busy || (!draft.trim() && !files.length)} onClick={() => void send()}>{busy ? <LoaderCircle size={14} className="composer-spinner" aria-hidden="true" /> : <ArrowUp size={14} strokeWidth={2.6} aria-hidden="true" />}</button>
    </div>
  </div>
}
