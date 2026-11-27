import { isThreadColor, chatHeader, type ChatEntry, type ChatQuestion, type ChatSayInput, type ChatSendResult, type ChatState, type ChatStatus, type ThreadColor } from '../../shared/chat'
import { openAttachment, MAX_ATTACHMENT_BYTES } from './attach'
import type { AttachmentSource, ChatStore } from './chat-store'

export interface ChatEvent { kind: 'changed'; terminalId: string }
export interface ChatDeps {
  store: ChatStore
  /** Pasta pessoal do usuário (base da lista de pastas de credenciais). */
  home: string
  /**
   * Digita a mensagem no terminal do agente. Se ele ainda não está pronto, ela entra na fila: devolve como desistir,
   * e `settled` avisa depois se saiu ou se o terminal encerrou antes.
   */
  deliver(terminalId: string, text: string, settled: (sent: boolean) => void): (() => void) | undefined | void
  write(terminalId: string, data: string): void
  isRunning(terminalId: string): boolean
  isAgent(terminalId: string): boolean
  /** Últimas linhas visíveis do terminal (prévia ao vivo durante o turno). */
  screenText?(terminalId: string, lines: number): string
  onTerminalData(cb: (terminalId: string) => void): () => void
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(timer: unknown): void
  /** Silêncio da saída (sem `say`) que fecha o turno pedindo atenção. */
  settleMs: number
}
interface Queued { thread: ThreadColor; cancel(): void }
interface Session { status: ChatStatus; unread: number; workingSince: number | null; turnThread: ThreadColor | null; timer: unknown; queued: Map<string, Queued>; lost: boolean }
const PAGE = 200

/**
 * O chat de cada terminal de agente. A mensagem do usuário é gravada e digitada no PTY com o cabeçalho; a resposta chega quando o agente
 * roda `palco say`. O turno só fecha com o `say` final, com o silêncio da saída (atenção) ou com a interrupção.
 */
export class ChatService {
  private readonly sessions = new Map<string, Session>()
  private readonly offData: () => void
  private readonly listeners = new Set<(event: ChatEvent) => void>()
  constructor(private readonly d: ChatDeps) { this.offData = d.onTerminalData(id => this.activity(id)) }
  dispose(): void { this.offData(); for (const s of this.sessions.values()) if (s.timer) this.d.clearTimer(s.timer) }

  private session(t: string): Session {
    let s = this.sessions.get(t)
    if (!s) { s = { status: 'idle', unread: 0, workingSince: null, turnThread: null, timer: null, queued: new Map(), lost: false }; this.sessions.set(t, s) }
    return s
  }
  private changed(t: string): void { for (const l of this.listeners) l({ kind: 'changed', terminalId: t }) }
  /** A interface escuta aqui: cada mudança de histórico, estado ou tópico de um terminal. */
  onChange(cb: (event: ChatEvent) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  private arm(t: string): void {
    const s = this.session(t)
    if (s.timer) this.d.clearTimer(s.timer)
    s.timer = this.d.setTimer(() => { s.timer = null; if (s.status === 'working') { s.status = 'needsAttention'; s.workingSince = null; this.changed(t) } }, this.d.settleMs)
  }
  private activity(t: string): void { const s = this.sessions.get(t); if (s?.status === 'working' && !s.queued.size) this.arm(t) }
  private disarm(s: Session): void { if (s.timer) { this.d.clearTimer(s.timer); s.timer = null } }
  /** A mensagem que esperava na fila saiu (o turno começa agora) ou se perdeu. */
  private settled(t: string, id: string, sent: boolean): void {
    const s = this.session(t), item = s.queued.get(id)
    if (!item) return
    s.queued.delete(id)
    if (sent) { s.status = 'working'; s.workingSince = this.d.now() / 1000; s.turnThread = item.thread; this.arm(t) }
    else { s.lost = true; this.close(t, 'needsAttention') }
    this.changed(t)
  }
  /** Tira da fila o que o usuário apagou ou interrompeu; sem mais nada esperando, o turno some. */
  private cancelQueued(t: string, match: (id: string, item: Queued) => boolean): boolean {
    const s = this.session(t)
    let removed = false
    for (const [id, item] of s.queued) if (match(id, item)) { item.cancel(); s.queued.delete(id); removed = true }
    return removed
  }
  private close(t: string, status: ChatStatus): void {
    const s = this.session(t)
    this.disarm(s)
    s.status = status; s.workingSince = null; s.turnThread = null
  }

  state(t: string, thread?: ThreadColor): ChatState {
    const s = this.session(t), th = thread ?? this.d.store.activeThread(t), all = this.d.store.all(t, th)
    return { terminalId: t, thread: this.d.store.activeThread(t) === th || !thread ? this.d.store.activeThread(t) : th, entries: all.slice(-PAGE), hasOlder: all.length > PAGE, status: s.status, unreadCount: s.unread, workingSince: s.workingSince, filledThreads: this.d.store.filledThreads(t), ...(s.queued.size ? { delivery: 'queued' as const } : s.lost ? { delivery: 'lost' as const } : {}) }
  }
  older(t: string, thread: ThreadColor, beforeId: string): ChatEntry[] { return this.d.store.before(t, thread, beforeId, PAGE) }

  async send(t: string, input: { text: string; attachments: string[] }): Promise<ChatSendResult> {
    const text = input.text.trim()
    if (!text && !input.attachments.length) return { accepted: false, cause: 'empty' }
    if (!this.d.isRunning(t)) return { accepted: false, cause: 'notRunning' }
    if (!this.d.isAgent(t)) return { accepted: false, cause: 'shell' }
    const sources: AttachmentSource[] = [], opened: Array<{ close(): void }> = []
    try {
      for (const p of input.attachments) {
        const v = openAttachment(p, this.d.home)
        if (!v.ok) return { accepted: false, cause: 'attachment', reason: v.reason }
        opened.push(v); sources.push({ name: v.name, fd: v.fd, maxBytes: MAX_ATTACHMENT_BYTES, kind: v.kind })
      }
      const thread = this.d.store.activeThread(t)
      try {
        const entry = this.d.store.append(t, thread, { role: 'user', kind: 'message', text }, sources)
        const files = (entry.attachments ?? []).map(a => ({ name: a.name, kind: a.kind, path: this.d.store.attachmentPath(t, thread, a.id)! }))
        const s = this.session(t)
        s.status = 'working'; s.workingSince = this.d.now() / 1000; s.turnThread = thread; s.lost = false
        const cancel = this.d.deliver(t, chatHeader(thread, text, files), sent => this.settled(t, entry.id, sent))
        // Na fila, o prazo de resposta só começa na entrega.
        if (cancel) { s.queued.set(entry.id, { thread, cancel }); this.disarm(s) } else this.arm(t)
        this.changed(t)
        return { accepted: true, entryId: entry.id }
      } catch (err) { return { accepted: false, cause: 'failed', reason: err instanceof Error ? err.message : String(err) } }
    } finally { for (const file of opened) file.close() }
  }

  /** `palco say`: uma bolha do agente. Sem `progress`, fecha o turno. Lança com a razão quando o pedido é inválido. */
  async say(t: string, input: ChatSayInput): Promise<ChatEntry> {
    const q = input.question
    if (q) validateQuestion(q)
    const text = (input.text ?? '').trim()
    if (!q && !text && !input.attach?.length) throw new Error('nada para enviar: informe o texto, --file, --attach ou --question')
    const sources: AttachmentSource[] = [], opened: Array<{ close(): void }> = []
    try {
      for (const p of input.attach ?? []) {
        const v = openAttachment(p, this.d.home)
        if (!v.ok) throw new Error(`${p}: ${v.reason}`)
        opened.push(v); sources.push({ name: v.name, fd: v.fd, maxBytes: MAX_ATTACHMENT_BYTES, kind: v.kind })
      }
      const s = this.session(t), thread = s.turnThread ?? this.d.store.activeThread(t)
      const entry = this.d.store.append(t, thread, { role: 'agent', kind: q ? 'question' : input.progress ? 'progress' : 'message', text: q ? q.prompt : text, ...(q ? { question: q } : {}) }, sources)
      if (input.progress) { if (s.status === 'working') this.arm(t) } else { this.close(t, 'idle'); s.unread += 1 }
      this.changed(t)
      return entry
    } finally { for (const file of opened) file.close() }
  }

  async interrupt(t: string): Promise<boolean> {
    const s = this.session(t)
    if (s.status !== 'working') return false
    // Se a mensagem ainda nem saiu, basta desistir dela: ESC num agente subindo faria outra coisa.
    if (!this.cancelQueued(t, () => true)) this.d.write(t, '\x1b')
    this.close(t, 'interrupted'); this.changed(t)
    return true
  }
  /** O agente terminou o turno (hook Stop do Claude, notify do Codex) sem ter dado o `say` final: pede atenção na hora. */
  turnEnded(t: string): void {
    const s = this.sessions.get(t)
    if (s?.status !== 'working' || s.queued.size) return
    this.close(t, 'needsAttention'); this.changed(t)
  }
  /** Terminais que pedem a atenção do usuário: resposta do agente não lida, ou turno que acabou sem resposta. (Selo no trilho de workspaces.) */
  attentionIds(): string[] { return [...this.sessions].filter(([, s]) => s.unread > 0 || s.status === 'needsAttention').map(([id]) => id) }
  acknowledgeAttention(t: string): void { const s = this.session(t); if (s.status === 'needsAttention' || s.status === 'interrupted') { s.status = 'idle'; s.lost = false; this.changed(t) } }
  markRead(t: string): void { const s = this.session(t); if (s.unread) { s.unread = 0; this.changed(t) } }
  switchThread(t: string, thread: ThreadColor): void { if (!isThreadColor(thread)) throw new Error('tópico inválido'); this.d.store.setActiveThread(t, thread); this.changed(t) }
  clearThread(t: string, thread: ThreadColor): void {
    this.cancelQueued(t, (_id, item) => item.thread === thread)
    this.d.store.clearThread(t, thread)
    const s = this.session(t)
    if (s.turnThread === thread) this.close(t, 'idle')
    this.changed(t)
  }
  clearHistory(t: string): void {
    this.cancelQueued(t, () => true)
    this.d.store.clearAll(t); this.close(t, 'idle')
    const s = this.session(t)
    s.unread = 0; s.lost = false
    this.changed(t)
  }
  deleteEntry(t: string, thread: ThreadColor, id: string): void {
    const waited = this.cancelQueued(t, (queued) => queued === id)
    this.d.store.deleteEntry(t, thread, id)
    if (waited && !this.session(t).queued.size) this.close(t, 'idle')
    this.changed(t)
  }

  /** `palco recall`: o que já foi dito, em texto, para o agente reler depois de reiniciar ou compactar. */
  recall(t: string, o: { thread?: ThreadColor; turns?: number; all?: boolean; list?: boolean; json?: boolean; /** Período em segundos desde 1970: só as voltas que começaram dentro dele. */ since?: number; until?: number }): string {
    if (o.list) {
      const filled = this.d.store.filledThreads(t)
      return filled.length ? filled.map(c => `${c} (${this.d.store.all(t, c).length} messages)`).join('\n') : 'No threads with messages.'
    }
    const thread = o.thread ?? this.session(t).turnThread ?? this.d.store.activeThread(t), entries = this.d.store.all(t, thread)
    if (!entries.length) return o.json ? JSON.stringify({thread,entries:[]}) : `Thread ${thread} is empty.`
    const turns: ChatEntry[][] = []
    for (const e of entries) { if (e.role === 'user' || !turns.length) turns.push([e]); else turns[turns.length - 1]!.push(e) }
    const dated = o.since !== undefined || o.until !== undefined
    const chosen = dated ? turns.filter((turn) => turn[0]!.ts >= (o.since ?? -Infinity) && turn[0]!.ts <= (o.until ?? Infinity))
      : o.all ? turns : turns.slice(-Math.min(500, Math.max(1, o.turns ?? 10)))
    if (dated && !chosen.length) return o.json ? JSON.stringify({ thread, entries: [] }) : `O tópico ${thread} não tem mensagens nesse período.`
    if(o.json)return JSON.stringify({thread,entries:chosen.flat()})
    const lines = [`## thread ${thread} (${o.all ? 'all' : dated ? `${chosen.length} in period` : `last ${chosen.length}`} turns)`]
    for (const e of chosen.flat()) {
      lines.push(`[${new Date(e.ts * 1000).toISOString()}] ${e.role}${e.kind === 'message' ? '' : ` (${e.kind})`}: ${e.text}`)
      if (e.question) lines.push(...e.question.options.map(op => `  option: ${op.label}${op.detail ? ` — ${op.detail}` : ''}${op.recommended ? ' (recommended)' : ''}`))
      for (const a of e.attachments ?? []) lines.push(`  attachment ${a.id}: ${a.name} -> ${this.d.store.attachmentPath(t, thread, a.id) ?? 'missing'}`)
    }
    return lines.join('\n')
  }
  /** Prévia do terminal: só enquanto o turno está em andamento (fora dele, texto vazio). */
  preview(t: string): string { return this.session(t).status === 'working' ? (this.d.screenText?.(t, 12) ?? '').trimEnd() : '' }
  attachmentPath(t: string, id: string): string | null { return this.d.store.findAttachment(t, id)?.path ?? null }
}
function validateQuestion(q: ChatQuestion): void {
  if (!q.prompt.trim()) throw new Error('a pergunta está vazia')
  if (q.options.length < 2) throw new Error('a pergunta precisa de pelo menos duas opções (--option)')
  if (q.options.length > 8 || q.options.some(o => !o.label.trim() || o.label.length > 200 || (o.detail?.length ?? 0) > 500) || q.prompt.length > 2000) throw new Error('pergunta grande demais (até 8 opções)')
}
