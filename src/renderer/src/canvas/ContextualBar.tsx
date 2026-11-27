import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AppWindow, Bold, Code, Copy, Ellipsis, ExternalLink, ImagePlus, Italic, List, ListTodo, Lock, LockOpen, Minus, NotebookTabs, Palette, Plus, SquareCode, Strikethrough, Type, GitBranch, MessagesSquare, PanelBottom, SquareTerminal, RotateCw, SquarePen, Trash2, UserPlus, Users, X } from 'lucide-react'
import type { FloorId, NodePatch, NoteFontFamily, NoteNode, PortalNode, TerminalNode, Workspace } from '../../../shared/model'
import { chatToggle, useChatShortcut } from '../chat/TerminalFace'
import { useChat } from '../chat/useChat'
import { fileNotes, unfileNote } from './note-stack'
import { normalizePortalUrl } from '../nodes/PortalView'
import { PortalStorageField, PortalUserAgentField } from '../dialogs/NewPortalDialog'
import type { PortalStorage } from '../../../shared/portal-settings'
import { cutConnections } from './connection-cut'
import { removableIds } from '../../../shared/lock'
import { NOTE_FORMAT_EVENT, type NoteCommand, type NoteFormatDetail, barContent, connectionRows, type BarContent, type ConnectionRow } from './contextual'
import { t, tr } from '../i18n'
import { cycleComposer, useComposerMode } from '../composer/composer-mode'
import { usePreferences } from '../settings/preferences'
import { formatBinding } from '../../../shared/shortcuts'

interface Props {
  ws: Workspace
  selection: ReadonlySet<string>
  linkFrom: string | null
  /** Mesmo início de ligação do cabeçalho antigo e do Ctrl+L (App/Canvas). */
  onLink(id: string): void
  onEdit(id: string): void
  onCreateBand(terminals: string[]): void
  /** Linha da lista "Conexões": centraliza o nó do outro lado (troca de floor se precisar). */
  onFocus(nodeId: string, floorId: FloorId): void
  /** Depois de excluir: a seleção fica vazia. */
  onCleared(): void
  onError(title: string, err: unknown): void
  /** Modo ativo (colocar, desenhar, ligar): a faixa mostra a dica no lugar da barra. */
  modeHint: string | null
}

/** Entrada com mola (0.3 s, bounce 0.4) vinda de cima; saída curta para cima. */
const ENTER = { type: 'spring' as const, visualDuration: 0.3, bounce: 0.4 }

function Btn({ label, title, onClick, disabled, active, className, keys, children }: { label: string; title?: string; onClick?(): void; disabled?: boolean; active?: boolean; className?: string; keys?: string; children: ReactNode }) {
  return (
    <button type="button" className={`glass-btn${active ? ' active' : ''}${className ? ` ${className}` : ''}`} aria-label={label} title={title ?? label} aria-pressed={active} aria-keyshortcuts={keys} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

const Sep = () => <span className="glass-sep" aria-hidden="true" />

/** Selo azul com o número de cordas; abre a lista "Conexões" (focar, remover, remover todas). */
function ConnectionsBadge({ rows, workspaceId, onFocus, onError }: { rows: ConnectionRow[]; workspaceId: string; onFocus: Props['onFocus']; onError: Props['onError'] }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (rows.length === 0) setOpen(false) }, [rows.length])
  if (rows.length === 0) return null
  const remove = (ids: string[]): void => {
    void cutConnections(window.palco.history, workspaceId, ids).catch((err: unknown) => onError(t('canvas.ContextualBar.nao_foi_possivel_remover_a_con'), err))
  }
  return (
    <span className="conn-anchor">
      <button type="button" className="conn-badge" title={t('canvas.ContextualBar.conexoes')} aria-label={t('canvas.ContextualBar.conexoes_length', { length: rows.length })} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {rows.length}
      </button>
      {open && (
        <div className="conn-pop" role="dialog" aria-label={t('canvas.ContextualBar.conexoes')}>
          <header>
            <h2>{t('canvas.ContextualBar.conexoes')}</h2>
            <button type="button" className="conn-all" onClick={() => remove(rows.map((r) => r.connectionId))}>{t('canvas.ContextualBar.remover_todas')}</button>
          </header>
          <ul>
            {rows.map((r) => (
              <li key={r.connectionId}>
                <button type="button" className="conn-go" title={t('canvas.ContextualBar.ir_ate_peername', { peerName: r.peerName })} onClick={() => { setOpen(false); onFocus(r.peerId, r.floorId) }}>
                  <span className="conn-name">{r.peerName}</span>
                  {r.floorLabel && <span className="conn-floor">{r.floorLabel}</span>}
                </button>
                <button type="button" className="conn-cut" title={t('canvas.ContextualBar.remover_conexao')} aria-label={t('canvas.ContextualBar.remover_conexao_com_peername', { peerName: r.peerName })} onClick={() => remove([r.connectionId])}>
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}

function nodeElement(id: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-node-id]')].find(el => el.dataset.nodeId === id)
}

/** Edita a fonte Markdown pelo mesmo buffer/debounce usado ao digitar na nota. */
/** Cores do cartão da nota (paleta própria do palco); "Padrão" volta à cor de nota. */
const NOTE_COLORS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#FFD60A', name: 'Amarelo' }, { hex: '#FF9F0A', name: 'Laranja' }, { hex: '#FF375F', name: 'Rosa' },
  { hex: '#BF5AF2', name: 'Roxo' }, { hex: '#0A84FF', name: 'Azul' }, { hex: '#30D158', name: 'Verde' }
]
const NOTE_FAMILIES: ReadonlyArray<{ id: NoteFontFamily; name: string }> = [
  { id: 'mono', name: 'Mono' }, { id: 'sans', name: 'Sans' }, { id: 'serif', name: 'Serif' }
]
const NOTE_FONT_DEFAULT = 13

function NoteActions({ node, ws, connect, remove, onError }: { node: NoteNode; ws: Workspace; connect: ReactNode; remove(): void; onError: Props['onError'] }) {
  const [pop, setPop] = useState<'more' | 'rename' | 'image' | 'color' | 'font' | null>(null)
  const locked = node.locked === true
  const patch = (change: NodePatch, title: string): void => { void window.palco.node.patch(node.id, change).catch((err: unknown) => onError(title, err)) }
  const fontSize = node.fontSize ?? NOTE_FONT_DEFAULT
  const stepFont = (delta: number): void => patch({ fontSize: Math.max(10, Math.min(32, fontSize + delta)) }, t('canvas.ContextualBar.nao_foi_possivel_mudar_a_fonte'))
  const unfile = (): void => {
    const out = unfileNote(ws, node.id)
    if (out) patch(out.patch, t('canvas.ContextualBar.nao_foi_possivel_tirar_do_fich'))
    setPop(null)
  }
  const editor = (): HTMLTextAreaElement | null => nodeElement(node.id)?.querySelector<HTMLTextAreaElement>('.note-text') ?? null
  const format = (command: NoteCommand): void => {
    try {
      const area = editor()
      if (!area) throw new Error(t('canvas.ContextualBar.editor_da_nota_indisponivel'))
      const detail: NoteFormatDetail = { command }
      const unhandled = area.dispatchEvent(new CustomEvent(NOTE_FORMAT_EVENT, { detail, cancelable: true }))
      if (unhandled || detail.error) throw new Error(detail.error ?? t('canvas.ContextualBar.editor_da_nota_indisponivel'))
      setPop(null)
    } catch (error) { onError(t('canvas.ContextualBar.nao_foi_possivel_formatar_a_no'), error) }
  }
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(editor()?.value ?? node.content); setPop(null) }
    catch (error) { onError(t('canvas.ContextualBar.nao_foi_possivel_copiar_a_nota'), error) }
  }
  const rename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('note-name') ?? '').trim()
    if (!name) return
    try { await window.palco.node.patch(node.id, { name }); setPop(null) }
    catch (error) { onError(t('canvas.ContextualBar.nao_foi_possivel_renomear_a_no'), error) }
  }
  const image = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    format({ kind: 'image', url: String(data.get('image-url') ?? ''), alt: String(data.get('image-alt') ?? '') })
  }
  return <>
    <span className="context-action-anchor">
      <Btn label={t('canvas.ContextualBar.cor_da_nota')} active={pop === 'color'} onClick={() => setPop(pop === 'color' ? null : 'color')}><Palette size={20} /></Btn>
      {pop === 'color' && <div className="context-action-pop note-colors" role="group" aria-label={t('canvas.ContextualBar.cor_da_nota')}>
        <button type="button" className={`note-swatch none${!node.color ? ' active' : ''}`} title={t('canvas.ContextualBar.padrao')} aria-label={t('canvas.ContextualBar.padrao')} aria-pressed={!node.color} onClick={() => { patch({ color: null }, t('canvas.ContextualBar.nao_foi_possivel_mudar_a_cor')); setPop(null) }} />
        {NOTE_COLORS.map((c) => <button key={c.hex} type="button" className={`note-swatch${node.color?.toLowerCase() === c.hex.toLowerCase() ? ' active' : ''}`} style={{ background: c.hex }} title={c.name} aria-label={c.name} aria-pressed={node.color?.toLowerCase() === c.hex.toLowerCase()} onClick={() => { patch({ color: c.hex }, t('canvas.ContextualBar.nao_foi_possivel_mudar_a_cor')); setPop(null) }} />)}
      </div>}
    </span>
    <span className="context-action-anchor">
      <Btn label={t('canvas.ContextualBar.fonte_da_nota')} active={pop === 'font'} onClick={() => setPop(pop === 'font' ? null : 'font')}><Type size={20} /></Btn>
      {pop === 'font' && <div className="context-action-pop" role="group" aria-label={t('canvas.ContextualBar.fonte_da_nota')}>
        <div className="note-font-size">
          <button type="button" aria-label={t('canvas.ContextualBar.diminuir_fonte')} disabled={fontSize <= 10} onClick={() => stepFont(-1)}><Minus size={14} /></button>
          <span aria-live="polite">{fontSize}</span>
          <button type="button" aria-label={t('canvas.ContextualBar.aumentar_fonte')} disabled={fontSize >= 32} onClick={() => stepFont(1)}><Plus size={14} /></button>
        </div>
        <div className="note-font-family" role="radiogroup" aria-label={t('canvas.ContextualBar.familia_da_fonte')}>
          {NOTE_FAMILIES.map((f) => <button key={f.id} type="button" role="radio" aria-checked={(node.fontFamily ?? 'mono') === f.id} className={(node.fontFamily ?? 'mono') === f.id ? 'active' : ''} onClick={() => patch({ fontFamily: f.id }, t('canvas.ContextualBar.nao_foi_possivel_mudar_a_fonte'))}>{f.name}</button>)}
        </div>
      </div>}
    </span>
    <Btn label={locked ? t('canvas.ContextualBar.destravar_conteudo') : t('canvas.ContextualBar.travar_conteudo')} active={locked} onClick={() => patch({ locked: !locked }, t('canvas.ContextualBar.nao_foi_possivel_travar_a_nota'))}>{locked ? <Lock size={20} /> : <LockOpen size={20} />}</Btn>
    <Sep />
    <span className="note-format-tools">
      <select className="glass-heading" aria-label={t('canvas.ContextualBar.cabecalho')} title={t('canvas.ContextualBar.cabecalho')} value="" disabled={locked} onChange={e => format({ kind: 'heading', level: Number(e.target.value) })}>
        <option value="" disabled>H</option><option value="0">{t('canvas.ContextualBar.texto_normal')}</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>H{level}</option>)}
      </select>
      <Btn label={t('canvas.ContextualBar.negrito')} disabled={locked} onClick={() => format({ kind: 'bold' })}><Bold size={20} /></Btn>
      <Btn label={t('canvas.ContextualBar.italico')} disabled={locked} onClick={() => format({ kind: 'italic' })}><Italic size={20} /></Btn>
      <Btn label={t('canvas.ContextualBar.tachado')} disabled={locked} onClick={() => format({ kind: 'strike' })}><Strikethrough size={20} /></Btn>
      <Btn label={t('canvas.ContextualBar.codigo')} disabled={locked} onClick={() => format({ kind: 'code' })}><Code size={20} /></Btn>
      <Btn label={t('canvas.ContextualBar.inserir_tarefa')} disabled={locked} onClick={() => format({ kind: 'task' })}><ListTodo size={20} /></Btn>
      <Btn label={t('canvas.ContextualBar.inserir_lista')} disabled={locked} onClick={() => format({ kind: 'list' })}><List size={20} /></Btn>
      <Btn label={t('canvas.ContextualBar.bloco_de_codigo')} disabled={locked} onClick={() => format({ kind: 'code-block' })}><SquareCode size={20} /></Btn>
    </span>
    <span className="context-action-anchor">
      <Btn label={t('canvas.ContextualBar.inserir_imagem')} disabled={locked} active={pop === 'image'} onClick={() => setPop(pop === 'image' ? null : 'image')}><ImagePlus size={20} /></Btn>
      {pop === 'image' && <form className="context-action-pop" aria-label={t('canvas.ContextualBar.inserir_imagem_markdown')} onSubmit={image}>
        <label>{t('canvas.ContextualBar.endereco_da_imagem')}<input name="image-url" type="url" required placeholder={t('canvas.ContextualBar.https')} autoFocus /></label>
        <label>{t('canvas.ContextualBar.descricao')}<input name="image-alt" placeholder={t('canvas.ContextualBar.texto_alternativo')} /></label>
        <button type="submit">{t('canvas.ContextualBar.inserir')}</button><button type="button" onClick={() => setPop(null)}>{t('canvas.ContextualBar.cancelar')}</button>
      </form>}
    </span>
    <span className="context-action-anchor">
      <Btn label={t('canvas.ContextualBar.mais_acoes_da_nota')} active={pop === 'more' || pop === 'rename'} onClick={() => setPop(pop ? null : 'more')}><Ellipsis size={20} /></Btn>
      {pop === 'more' && <div className="context-action-pop" role="menu" aria-label={t('canvas.ContextualBar.mais_acoes_da_nota')}>
        {!node.linkedFile && <button role="menuitem" aria-label={t('canvas.ContextualBar.renomear_nota')} onClick={() => setPop('rename')}><SquarePen size={14} />{t('canvas.ContextualBar.renomear')}</button>}
        <button role="menuitem" aria-label={t('canvas.ContextualBar.copiar_conteudo')} onClick={() => void copy()}><Copy size={14} />{t('canvas.ContextualBar.copiar_conteudo')}</button>
        {node.stackId && <button role="menuitem" aria-label={t('canvas.ContextualBar.tirar_do_fichario')} onClick={unfile}><NotebookTabs size={14} />{t('canvas.ContextualBar.tirar_do_fichario')}</button>}
      </div>}
      {pop === 'rename' && <form className="context-action-pop" aria-label={t('canvas.ContextualBar.renomear_nota')} onSubmit={e => void rename(e)}>
        <label>{t('canvas.ContextualBar.nome')}<input name="note-name" defaultValue={node.name} required maxLength={120} autoFocus /></label>
        <button type="submit">{t('canvas.ContextualBar.salvar')}</button><button type="button" onClick={() => setPop(null)}>{t('canvas.ContextualBar.cancelar')}</button>
      </form>}
    </span>
    <Sep />{connect}<Sep />
    <Btn label={t('canvas.ContextualBar.excluir_nota')} disabled={node.positionLocked === true} onClick={remove}><Trash2 size={20} /></Btn>
  </>
}

function PortalActions({ node, connect, remove, onError }: { node: PortalNode; connect: ReactNode; remove(): void; onError: Props['onError'] }) {
  const [editing, setEditing] = useState(false)
  const [ua, setUa] = useState(node.userAgent ?? '')
  const [storage, setStorage] = useState<PortalStorage>(node.storage ?? 'global')
  const toggleEditing = (): void => { setUa(node.userAgent ?? ''); setStorage(node.storage ?? 'global'); setEditing((v) => !v) }
  const sessionChanges = ua.trim() !== (node.userAgent ?? '') || storage !== (node.storage ?? 'global')
  const [busy, setBusy] = useState(false)
  const guest = (): Element & { reload(): void; loadURL(url: string): Promise<void> } => {
    const element = nodeElement(node.id)?.querySelector('webview')
    if (!element) throw new Error(t('canvas.ContextualBar.portal_ainda_indisponivel'))
    return element as ReturnType<typeof guest>
  }
  const reload = (): void => { try { guest().reload() } catch (error) { onError(t('canvas.ContextualBar.nao_foi_possivel_recarregar_o_'), error) } }
  const external = /^https?:\/\//i.test(node.url)
  const chromeHidden = node.chromeHidden === true
  const edit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const name = String(data.get('portal-name') ?? '').trim(), raw = String(data.get('portal-url') ?? '').trim()
    const url = raw === 'about:blank' ? raw : normalizePortalUrl(raw)
    if (!name || !url) { onError(t('canvas.ContextualBar.nao_foi_possivel_editar_o_port'), new Error(t('canvas.ContextualBar.use_nome_e_endereco_http_https'))); return }
    setBusy(true)
    try {
      await window.palco.node.patch(node.id, { name, url, ...(sessionChanges ? { userAgent: ua.trim(), storage } : {}) }); setEditing(false)
      // UA ou armazenamento novos recriam o webview, que já abre no endereço salvo.
      if (url !== node.url && !sessionChanges) {
        try { await guest().loadURL(url) }
        catch (error) { onError(t('canvas.ContextualBar.portal_salvo_nao_foi_possivel_'), error) }
      }
    } catch (error) { onError(t('canvas.ContextualBar.nao_foi_possivel_editar_o_port'), error) }
    finally { setBusy(false) }
  }
  return <>
    <Btn label={t('canvas.ContextualBar.recarregar_portal')} onClick={reload}><RotateCw size={20} /></Btn>
    {connect}<Sep />
    <span className="context-action-anchor">
      <Btn label={t('canvas.ContextualBar.editar_portal')} active={editing} onClick={toggleEditing}><SquarePen size={20} /></Btn>
      {editing && <form className="context-action-pop" aria-label={t('canvas.ContextualBar.editar_portal')} onSubmit={e => void edit(e)}>
        <label>{t('canvas.ContextualBar.nome')}<input name="portal-name" defaultValue={node.name} required maxLength={120} autoFocus /></label>
        <label>{t('canvas.ContextualBar.endereco')}<input name="portal-url" defaultValue={node.url} required /></label>
        <PortalUserAgentField value={ua} onChange={setUa} />
        <PortalStorageField value={storage} onChange={setStorage} />
        {sessionChanges && <p className="nt-hint warn">{t('canvas.ContextualBar.salvar_troca_a_identidade_ou_o')}</p>}
        <button type="submit" disabled={busy}>{t('canvas.ContextualBar.salvar')}</button><button type="button" onClick={() => setEditing(false)}>{t('canvas.ContextualBar.cancelar')}</button>
      </form>}
    </span>
    <Btn label={t('canvas.ContextualBar.abrir_no_navegador')} title={external ? t('canvas.ContextualBar.abrir_no_navegador_do_sistema') : t('canvas.ContextualBar.so_enderecos_http_e_https_abre')} disabled={!external}
      onClick={() => void window.palco.shell.openExternal(node.url).catch((err: unknown) => onError(t('canvas.ContextualBar.nao_foi_possivel_abrir_no_nave'), err))}><ExternalLink size={20} /></Btn>
    <Btn label={chromeHidden ? t('canvas.ContextualBar.mostrar_moldura') : t('canvas.ContextualBar.ocultar_moldura')} active={chromeHidden}
      onClick={() => void window.palco.node.patch(node.id, { chromeHidden: !chromeHidden }).catch((err: unknown) => onError(t('canvas.ContextualBar.nao_foi_possivel_mudar_a_moldu'), err))}><AppWindow size={20} /></Btn>
    <Sep />
    <Btn label={t('canvas.ContextualBar.fechar_portal')} disabled={node.positionLocked === true} onClick={remove}><Trash2 size={20} /></Btn>
  </>
}

function ComposerButton({ id }: { id: string }) {
  const mode = useComposerMode(id), prefs = usePreferences()
  const label = t('canvas.ContextualBar.prompter')
  const shortcut = prefs.shortcuts.prompter.map(b => formatBinding(b, tr('Espaço'))).join(' / ')
  return <Btn label={label} title={shortcut ? `${label} (${shortcut})` : label} active={mode !== 'off'} onClick={() => { cycleComposer(id) }}><PanelBottom size={20} /></Btn>
}

/** Terminal ⇄ chat. Só terminal de agente tem chat; descarregado, o botão some. */
function ChatButton({ node }: { node: TerminalNode }) {
  if (node.unloaded) return null
  if (node.agent === 'shell') return <Btn label={t('canvas.ContextualBar.mostrar_chat')} title={t('canvas.ContextualBar.chat_so_agente')} disabled><MessagesSquare size={20} /></Btn>
  return <AgentChatButton node={node} />
}

function AgentChatButton({ node }: { node: TerminalNode }) {
  const face = chatToggle(node), shortcut = useChatShortcut(face.label)
  // Respostas não lidas só aparecem com o terminal à frente: no chat elas já estão na tela.
  const answered = useChat(node.id).state?.unreadCount ?? 0, unread = face.chat ? 0 : answered
  return (
    <Btn label={unread ? t('canvas.ContextualBar.chat_nao_lidas', { label: face.label, unread }) : face.label} title={shortcut.title}
      keys={shortcut.keys} className={unread ? 'with-badge' : undefined} onClick={face.run}>
      {face.chat ? <SquareTerminal size={20} /> : <MessagesSquare size={20} />}
      {unread > 0 && <span className="chat-badge" aria-hidden="true">{unread}</span>}
    </Btn>
  )
}

function Buttons({ content, ws, linkFrom, onLink, onEdit, onCreateBand, onFocus, onCleared, onError }: Omit<Props, 'selection' | 'modeHint'> & { content: BarContent }) {
  const fail = (title: string) => (err: unknown): void => onError(title, err)
  /** O que a trava deixa apagar (`shared/lock.ts`); sem nada, a lixeira fica desabilitada. */
  const removable = (ids: string[]): string[] => removableIds(ws.nodes, ids)
  const removeAll = (wanted: string[]): void => {
    const ids = removable(wanted)
    if (!ids.length) return
    onCleared()
    // Uma transação: Ctrl+Z traz todos de volta (terminal com processo novo). Um item só: o remove avulso já é uma transação.
    const done = ids.length === 1 ? window.palco.node.remove(ids[0]!) : window.palco.history.commit(ws.id, ids.map((id) => ({ type: 'node.remove' as const, id })))
    void done.catch(fail(t('canvas.ContextualBar.nao_foi_possivel_excluir')))
  }
  const connect = (id: string): ReactNode => (
    <>
      <Btn label={t('canvas.ContextualBar.conectar')} title={t('canvas.ContextualBar.conectar_ctrl_l')} active={linkFrom === id} onClick={() => onLink(id)}><GitBranch size={20} /></Btn>
      <ConnectionsBadge rows={connectionRows(ws, id)} workspaceId={ws.id} onFocus={onFocus} onError={onError} />
    </>
  )
  switch (content.kind) {
    case 'terminal': {
      const id = content.id
      return (
        <>
          <Btn label={t('canvas.ContextualBar.editar_terminal')} onClick={() => onEdit(id)}><SquarePen size={20} /></Btn>
          <Sep />
          {ws.nodes[id]?.kind === 'terminal' && <ChatButton key={id} node={ws.nodes[id] as TerminalNode} />}
          <ComposerButton id={id} />
          <Sep />
          {connect(id)}
          <Sep />
          <Btn label={t('canvas.ContextualBar.reiniciar_terminal')} onClick={() => void window.palco.terminal.restart(id).catch(fail(t('canvas.ContextualBar.nao_foi_possivel_reiniciar')))}><RotateCw size={20} /></Btn>
          <Sep />
          <Btn label={t('canvas.ContextualBar.excluir_terminal')} disabled={!removable([id]).length} onClick={() => removeAll([id])}><Trash2 size={20} /></Btn>
        </>
      )
    }
    case 'note': {
      const node = ws.nodes[content.id]
      return node?.kind === 'note' ? <NoteActions key={node.id} node={node} ws={ws} connect={connect(node.id)} remove={() => removeAll([node.id])} onError={onError} /> : null
    }
    case 'portal': {
      const node = ws.nodes[content.id]
      return node?.kind === 'portal' ? <PortalActions key={node.id} node={node} connect={connect(node.id)} remove={() => removeAll([node.id])} onError={onError} /> : null
    }
    case 'node':
      return (
        <>
          {connect(content.id)}
          <Sep />
          <Btn label={t('canvas.ContextualBar.excluir')} disabled={!removable([content.id]).length} onClick={() => removeAll([content.id])}><Trash2 size={20} /></Btn>
        </>
      )
    case 'band-create':
      return (
        <>
          <Btn label={t('canvas.ContextualBar.criar_banda')} title={t('canvas.ContextualBar.criar_banda_com_length_termina', { length: content.terminals.length })} onClick={() => onCreateBand(content.terminals)}><Users size={20} /></Btn>
          <Sep />
          <Btn label={t('canvas.ContextualBar.excluir')} title={t('canvas.ContextualBar.excluir_length_itens', { length: content.ids.length })} disabled={!removable(content.ids).length} onClick={() => removeAll(content.ids)}><Trash2 size={20} /></Btn>
        </>
      )
    case 'band-add':
      return (
        <>
          <Btn
            label={t('canvas.ContextualBar.adicionar_a_banda')}
            onClick={() => {
              onCleared()
              void Promise.all(content.terminals.map((t) => window.palco.band.add(content.band, t))).catch(fail(t('canvas.ContextualBar.nao_foi_possivel_adicionar_a_b')))
            }}
          >
            <UserPlus size={20} />
          </Btn>
          <Sep />
          <Btn label={t('canvas.ContextualBar.excluir')} title={t('canvas.ContextualBar.excluir_length_itens', { length: content.ids.length })} disabled={!removable(content.ids).length} onClick={() => removeAll(content.ids)}><Trash2 size={20} /></Btn>
        </>
      )
    case 'notes':
      return (
        <>
          <Btn label={t('canvas.ContextualBar.colocar_no_fichario')} title={t('canvas.ContextualBar.colocar_length_notas_num_ficha', { length: content.ids.length })} onClick={() => {
            const patches = fileNotes(ws, content.ids, `f-${crypto.randomUUID()}`)
            void window.palco.history.commit(ws.id, patches.map(p => ({ type: 'node.patch', id: p.id, patch: p.patch }))).catch(fail(t('canvas.ContextualBar.nao_foi_possivel_criar_o_ficha')))
          }}><NotebookTabs size={20} /></Btn>
          <Sep />
          <Btn label={t('canvas.ContextualBar.excluir')} title={t('canvas.ContextualBar.excluir_length_notas', { length: content.ids.length })} disabled={!removable(content.ids).length} onClick={() => removeAll(content.ids)}><Trash2 size={20} /></Btn>
        </>
      )
    case 'multi':
      return <Btn label={t('canvas.ContextualBar.excluir')} title={t('canvas.ContextualBar.excluir_length_itens', { length: content.ids.length })} disabled={!removable(content.ids).length} onClick={() => removeAll(content.ids)}><Trash2 size={20} /></Btn>
  }
}

/**
 * Faixa fixa logo abaixo do dock (top 56 px), centralizada no canvas: a barra de vidro
 * troca de conteúdo pela seleção. Não segue o card.
 */
export function ContextualBar(props: Props) {
  const reduce = useReducedMotion()
  const content = barContent(props.ws, props.selection)
  const shown: 'hint' | 'bar' | null = props.modeHint ? 'hint' : content ? 'bar' : null
  return (
    <div className="contextual-row">
      <AnimatePresence>
        {shown && (
          <motion.div
            key={shown}
            className={shown === 'hint' ? 'mode-hint' : 'glass-bar'}
            role={shown === 'hint' ? 'status' : 'toolbar'}
            aria-label={shown === 'bar' ? t('canvas.ContextualBar.acoes_da_selecao') : undefined}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.9 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
            transition={reduce ? { duration: 0.1 } : { ...ENTER, opacity: { duration: 0.15, ease: 'easeOut' } }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {shown === 'hint' ? props.modeHint : content && <Buttons {...props} content={content} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
