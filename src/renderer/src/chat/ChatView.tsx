import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowUp, Ellipsis, Plus } from 'lucide-react'
import { THREAD_COLORS, type ChatAttachment, type ChatEntry, type ThreadColor } from '../../../shared/chat'
import { usePreferences } from '../settings/preferences'
import { Markdown } from './Markdown'
import { useChat } from './useChat'
import { TerminalMirror, type MirrorLook } from './TerminalMirror'
import { MicButton } from '../voice/MicButton'
import { useDictation } from '../voice/useDictation'
import { VoiceSetup } from '../voice/VoiceSetup'
import { t } from '../i18n'

const COLOR_NAME: Record<ThreadColor, string> = { get blue() { return t('chat.ChatView.azul') }, get purple() { return t('chat.ChatView.roxo') }, get pink() { return t('chat.ChatView.rosa') }, get red() { return t('chat.ChatView.vermelho') }, get orange() { return t('chat.ChatView.laranja') }, get yellow() { return t('chat.ChatView.amarelo') }, get green() { return t('chat.ChatView.verde') } }
const COLOR_HEX: Record<ThreadColor, string> = { blue: '#4f9cff', purple: '#a58be0', pink: '#e58fb0', red: '#ef6b6b', orange: '#e8a35e', yellow: '#e0c45c', green: '#78c58a' }

function Attachment({ terminalId, a }: { terminalId: string; a: ChatAttachment }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { if (a.kind === 'image') void window.palco.chat.attachment(terminalId, a.id).then(setSrc).catch(() => {}) }, [terminalId, a])
  return a.kind === 'image' && src
    ? <img className="chat-attachment-image" src={src} alt={a.name} />
    : <span className="chat-attachment-file" title={t('chat.ChatView.size_bytes', { size: a.size })}>{a.kind === 'image' ? t('chat.ChatView.imagem_anexada') : t('chat.ChatView.arquivo_anexado')}: {a.name}</span>
}

function Bubble({ terminalId, entry, onQuote, onDelete, thread }: { terminalId: string; entry: ChatEntry; onQuote(text: string): void; onDelete(): void; thread: ThreadColor }) {
  if (entry.kind === 'divider') return <div className="chat-divider" role="separator">{t('chat.ChatView.a_conversa_anterior_aconteceu_')}</div>
  const user = entry.role === 'user'
  return <div className={`chat-bubble ${user ? 'user' : 'agent'} ${entry.kind}`} data-entry={entry.id} data-thread={thread}>
    <div className="chat-bubble-body">
      {user ? <p className="chat-user-text">{entry.text}</p> : entry.kind === 'question' ? <p className="chat-question-prompt">{entry.text}</p> : <Markdown source={entry.text} />}
      {entry.question && <div className="chat-options" role="group" aria-label={t('chat.ChatView.opcoes')}>{entry.question.options.map(o =>
        <button key={o.label} type="button" title={t('chat.ChatView.citar_opcao_na_resposta')} onClick={() => onQuote(`> ${entry.question!.prompt}\n> ${o.label}\n\n`)}>
          <span>{o.label}{o.recommended ? ` ${t('chat.ChatView.recomendado')}` : ''}</span>{o.detail && <small>{o.detail}</small>}</button>)}</div>}
      {entry.attachments?.map(a => <Attachment key={a.id} terminalId={terminalId} a={a} />)}
    </div>
    <div className="chat-bubble-actions">
      <button type="button" aria-label={t('chat.ChatView.citar')} onClick={() => onQuote(entry.text.split('\n').map(l => `> ${l}`).join('\n') + '\n\n')}>{t('chat.ChatView.citar')}</button>
      <button type="button" aria-label={t('chat.ChatView.copiar')} onClick={() => { void navigator.clipboard.writeText(entry.text).catch(() => {}) }}>{t('chat.ChatView.copiar')}</button>
      <button type="button" aria-label={t('chat.ChatView.excluir_mensagem')} onClick={onDelete}>{t('chat.ChatView.excluir')}</button>
    </div>
  </div>
}

/** A face de chat do terminal de agente: conversa por tópico, estado do turno, anexos e a entrada de mensagem. */
export function ChatView({ terminalId, name, showsShell = true, look, shell }: { terminalId: string; name: string; showsShell?: boolean; look?: { fontFamily?: string; fontSize?: number }; shell?: MirrorLook }) {
  const { state, entries, loadOlder } = useChat(terminalId)
  const prefs = usePreferences()
  const [draft, setDraft] = useState(''), [files, setFiles] = useState<string[]>([]), [error, setError] = useState(''), [confirm, setConfirm] = useState<'thread' | 'history' | null>(null)
  /** Menu "…" das ações do chat, no lugar dos links quando a barra é estreita. */
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    if (!menu) return
    const close = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(false) } }
    // Clique em qualquer outro lugar (inclusive no canvas) fecha.
    const outside = (e: Event): void => { if (!(e.target as Element).closest?.('.chat-more')) setMenu(false) }
    window.addEventListener('keydown', close, true)
    window.addEventListener('pointerdown', outside, true)
    return () => { window.removeEventListener('keydown', close, true); window.removeEventListener('pointerdown', outside, true) }
  }, [menu])
  const end = useRef<HTMLDivElement>(null), area = useRef<HTMLTextAreaElement>(null)
  // O campo começa com uma linha e cresce com o texto, até onze linhas (medidas pela fonte do chat).
  const line = Math.round(((look?.fontSize ?? prefs.chatFontSize) * 20) / 13), lowest = line + 16, highest = Math.round((220 * line) / 20)
  const count = entries.length, status = state?.status ?? 'idle'
  // Texto ditado entra onde está o cursor, separado por espaços; quem envia é o usuário.
  const [caret, setCaret] = useState<number | null>(null)
  const dictated = (text: string): void => {
    const field = area.current
    if (!field) return
    const before = field.value.slice(0, field.selectionStart), after = field.value.slice(field.selectionEnd)
    const lead = before && !/\s$/.test(before) ? ' ' : '', tail = after && !/^\s/.test(after) ? ' ' : ''
    setDraft(before + lead + text + tail + after)
    setCaret(before.length + lead.length + text.length)
  }
  useEffect(() => {
    if (caret === null) return
    area.current?.focus(); area.current?.setSelectionRange(caret, caret); setCaret(null)
  }, [caret])
  const dictation = useDictation(terminalId, dictated, setError)
  const ready = state !== null
  useLayoutEffect(() => {
    const field = area.current
    if (!field) return
    const fit = (): void => {
      field.style.height = 'auto'
      const wanted = field.scrollHeight
      field.style.height = `${Math.min(highest, Math.max(lowest, wanted))}px`
      field.style.overflowY = wanted > highest ? 'auto' : 'hidden'
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    // Chat mais estreito quebra mais linhas: refaz quando a largura muda.
    let width = field.clientWidth
    const observer = new ResizeObserver(() => { if (field.clientWidth !== width) { width = field.clientWidth; fit() } })
    observer.observe(field)
    return () => observer.disconnect()
  }, [draft, lowest, highest, ready])
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [count, status])
  useEffect(() => { if (state && state.unreadCount > 0) void window.palco.chat.markRead(terminalId).catch(() => {}) }, [state, terminalId])
  if (!state) return <div className="chat-face" aria-label={t('chat.ChatView.chat')} />
  const thread = state.thread
  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text && !files.length) return
    setError('')
    const r = await window.palco.chat.send(terminalId, { text, attachments: files })
    if (r.accepted) { setDraft(''); setFiles([]) }
    else setError(r.cause === 'notRunning' ? t('chat.ChatView.o_terminal_nao_esta_em_execuca') : r.cause === 'shell' ? t('chat.ChatView.este_terminal_nao_e_um_agente') : r.cause === 'attachment' ? t('chat.ChatView.anexo_recusado_v1', { v1: r.reason ?? '' }) : t('chat.ChatView.nao_foi_possivel_enviar_a_mens'))
  }
  const attach = async (): Promise<void> => { const p = await window.palco.files.pick('file').catch(() => null); if (p) setFiles(f => (f.includes(p) ? f : [...f, p].slice(0, 10))) }
  const style = { fontFamily: (look?.fontFamily ?? prefs.chatFontFamily) || 'var(--font-sans)', fontSize: look?.fontSize ?? prefs.chatFontSize }
  return <div className="chat-face" aria-label={t('chat.ChatView.chat')} style={style} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header className="chat-threads" role="group" aria-label={t('chat.ChatView.topicos')}>
      {THREAD_COLORS.map(c => <button key={c} type="button" className={c === thread ? 'chat-dot current' : 'chat-dot'} aria-label={t('chat.ChatView.topico_v1', { v1: COLOR_NAME[c] })} aria-pressed={c === thread}
        title={state.filledThreads.includes(c) ? t('chat.ChatView.cor_tem_mensagens', { color: COLOR_NAME[c] }) : t('chat.ChatView.cor_vazio', { color: COLOR_NAME[c] })} style={{ '--dot': COLOR_HEX[c] } as React.CSSProperties}
        data-filled={state.filledThreads.includes(c)} onClick={() => void window.palco.chat.switchThread(terminalId, c)} />)}
      <span className="chat-spacer" />
      <button type="button" className="chat-link" onClick={() => setConfirm('thread')}>{t('chat.ChatView.limpar_topico')}</button>
      <button type="button" className="chat-link" onClick={() => setConfirm('history')}>{t('chat.ChatView.limpar_historico_do_chat')}</button>
      <div className="chat-more">
        <button type="button" aria-label={t('chat.ChatView.acoes_do_chat')} title={t('chat.ChatView.acoes_do_chat')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(v => !v)}><Ellipsis size={16} aria-hidden="true" /></button>
        {menu && <div className="chat-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); setConfirm('thread') }}>{t('chat.ChatView.limpar_topico')}</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); setConfirm('history') }}>{t('chat.ChatView.limpar_historico_do_chat')}</button>
        </div>}
      </div>
    </header>
    {menu && <div className="chat-menu-back" onClick={() => setMenu(false)} />}
    <div className="chat-list" role="log" aria-label={t('chat.ChatView.conversa')} aria-live="polite">
      {state.hasOlder && <button type="button" className="chat-link" onClick={() => void loadOlder()}>{t('chat.ChatView.carregar_mensagens_anteriores')}</button>}
      {!count && <div className="chat-empty"><strong>{t('chat.ChatView.ainda_nao_ha_mensagens')}</strong><span>{t('chat.ChatView.envie_uma_mensagem_e_o_agente_')}</span></div>}
      {entries.map(e => <Bubble key={e.id} terminalId={terminalId} entry={e} thread={thread} onQuote={t => { setDraft(d => d + t); area.current?.focus() }} onDelete={() => void window.palco.chat.deleteEntry(terminalId, thread, e.id)} />)}
      {status === 'working' && <div className="chat-status working" role="status"><span className="chat-dots" aria-hidden="true" />{state.delivery === 'queued' ? t('chat.ChatView.na_fila', { name }) : t('chat.ChatView.esta_trabalhando', { name })}
        <button type="button" onClick={() => void window.palco.chat.interrupt(terminalId)}>{t('chat.ChatView.interromper')}</button>
        <button type="button" onClick={() => void window.palco.node.patch(terminalId, { chatShowsShell: !showsShell })}>{showsShell ? t('chat.ChatView.ocultar_previa_do_terminal') : t('chat.ChatView.mostrar_previa_do_terminal')}</button></div>}
      {status === 'working' && showsShell && <TerminalMirror id={terminalId} label={t('chat.ChatView.previa_ao_vivo_de_name', { name })} look={shell} />}
      {status === 'needsAttention' && <div className="chat-status attention" role="status">{state.delivery === 'lost' ? t('chat.ChatView.mensagem_perdida') : t('chat.ChatView.nenhuma_resposta_recebida')} <button type="button" onClick={() => void window.palco.chat.acknowledge(terminalId)}>{t('chat.ChatView.ok')}</button></div>}
      {status === 'interrupted' && <div className="chat-status" role="status">{t('chat.ChatView.interrompido')} <button type="button" onClick={() => void window.palco.chat.acknowledge(terminalId)}>{t('chat.ChatView.ok')}</button></div>}
      <div ref={end} />
    </div>
    {error && <p className="chat-error" role="alert">{error}</p>}
    {files.length > 0 && <div className="chat-files" aria-label={t('chat.ChatView.anexos')}>{files.map(f => <span key={f}>{f.split('/').pop()}<button type="button" aria-label={t('chat.ChatView.remover_f', { f })} onClick={() => setFiles(l => l.filter(x => x !== f))}>×</button></span>)}</div>}
    <div className="chat-input">
      <div className="chat-composer" style={{ '--chat-line': `${line}px`, '--chat-field-min': `${lowest}px`, '--chat-control-inset': `${(lowest - 28) / 2}px` } as CSSProperties}>
        <button type="button" aria-label={t('chat.ChatView.anexar_arquivo')} title={t('chat.ChatView.anexar_arquivo')} onClick={() => void attach()}><Plus size={18} aria-hidden="true" /></button>
        <textarea ref={area} aria-label={t('chat.ChatView.mensagem')} rows={1} value={draft} placeholder={t('chat.ChatView.mensagem_para_name', { name })} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
        <MicButton state={dictation.state} onClick={dictation.toggle} />
        <button type="button" className="chat-send" aria-label={t('chat.ChatView.enviar')} title={t('chat.ChatView.enviar')} disabled={!draft.trim() && !files.length} onClick={() => void send()}><ArrowUp size={17} aria-hidden="true" /></button>
      </div>
    </div>
    {dictation.state === 'setup' && <VoiceSetup onClose={dictation.closeSetup} />}
    {confirm && <div className="chat-confirm" role="alertdialog" aria-label={confirm === 'thread' ? t('chat.ChatView.limpar_topico_2') : t('chat.ChatView.limpar_historico_do_chat_2')}>
      <p>{confirm === 'thread' ? t('chat.ChatView.limpar_o_topico_v1_as_mensagen', { v1: COLOR_NAME[thread] }) : t('chat.ChatView.isso_exclui_permanentemente_to')}</p>
      <div><button type="button" onClick={() => setConfirm(null)}>{t('chat.ChatView.cancelar')}</button>
        <button type="button" className="danger" onClick={() => { const c = confirm; setConfirm(null); void (c === 'thread' ? window.palco.chat.clearThread(terminalId, thread) : window.palco.chat.clearHistory(terminalId)) }}>{t('chat.ChatView.limpar')}</button></div>
    </div>}
  </div>
}
