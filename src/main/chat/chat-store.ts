import { copyFdExclusive } from '../secure-files'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isThreadColor, THREAD_COLORS, type ChatAttachment, type ChatEntry, type ThreadColor } from '../../shared/chat'

const ID = /^[A-Za-z0-9_-]{1,80}$/, ATT_ID = /^[0-9A-F-]{36}$/
type NewEntry = Pick<ChatEntry, 'role' | 'kind' | 'text'> & Partial<Pick<ChatEntry, 'question'>>
export interface AttachmentSource { name: string; fd: number; maxBytes: number; kind: 'image' | 'file' }

/** Histórico do chat: `<raiz>/<terminal>/<cor>/transcript.jsonl` e `attachments/<id>/<arquivo>`. Só o palco grava; nomes sempre validados. */
export class ChatStore {
  constructor(private readonly root: string) {}
  private terminalDir(t: string): string { if (!ID.test(t)) throw new Error('terminal inválido'); return join(this.root, t) }
  private threadDir(t: string, thread: ThreadColor): string { if (!isThreadColor(thread)) throw new Error('tópico inválido'); return join(this.terminalDir(t), thread) }
  private file(t: string, thread: ThreadColor): string { return join(this.threadDir(t, thread), 'transcript.jsonl') }

  private read(t: string, thread: ThreadColor): ChatEntry[] {
    let raw: string
    try { raw = readFileSync(this.file(t, thread), 'utf8') } catch { return [] }
    const out: ChatEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { const e = JSON.parse(line) as ChatEntry; if (typeof e?.id === 'string' && typeof e.text === 'string') out.push(e) } catch { /* linha corrompida: o resto do histórico vale */ }
    }
    return out
  }

  append(t: string, thread: ThreadColor, entry: NewEntry, attachments: AttachmentSource[] = []): ChatEntry {
    const dir = this.threadDir(t, thread); mkdirSync(dir, { recursive: true })
    const saved: ChatAttachment[] = []
    for (const a of attachments) {
      const id = randomUUID().toUpperCase(), name = safeName(a.name)
      mkdirSync(join(dir, 'attachments', id), { recursive: true })
      const size = copyFdExclusive(a.fd, join(dir, 'attachments', id, name), a.maxBytes)
      saved.push({ id, name, kind: a.kind, size })
    }
    const full: ChatEntry = { id: randomUUID().toUpperCase(), ts: Date.now() / 1000, ...entry, ...(saved.length ? { attachments: saved } : {}) }
    appendFileSync(this.file(t, thread), JSON.stringify(full) + '\n')
    return full
  }
  tail(t: string, thread: ThreadColor, n: number): ChatEntry[] { return this.read(t, thread).slice(-Math.max(0, n)) }
  all(t: string, thread: ThreadColor): ChatEntry[] { return this.read(t, thread) }
  /** As `n` mensagens imediatamente antes de `id`, da mais antiga para a mais nova. */
  before(t: string, thread: ThreadColor, id: string, n: number): ChatEntry[] {
    const all = this.read(t, thread), i = all.findIndex(e => e.id === id)
    return i <= 0 ? [] : all.slice(Math.max(0, i - n), i)
  }
  deleteEntry(t: string, thread: ThreadColor, id: string): void {
    const all = this.read(t, thread), gone = all.find(e => e.id === id)
    if (!gone) return
    writeFileSync(this.file(t, thread), all.filter(e => e.id !== id).map(e => JSON.stringify(e) + '\n').join(''))
    for (const a of gone.attachments ?? []) if (ATT_ID.test(a.id)) rmSync(join(this.threadDir(t, thread), 'attachments', a.id), { recursive: true, force: true })
  }
  clearThread(t: string, thread: ThreadColor): void { rmSync(this.threadDir(t, thread), { recursive: true, force: true }) }
  clearAll(t: string): void { rmSync(this.terminalDir(t), { recursive: true, force: true }) }
  filledThreads(t: string): ThreadColor[] { return THREAD_COLORS.filter(c => existsSync(this.file(t, c)) && this.read(t, c).length > 0) }
  activeThread(t: string): ThreadColor {
    try { const c = (JSON.parse(readFileSync(join(this.terminalDir(t), 'meta.json'), 'utf8')) as { activeThread?: unknown }).activeThread; if (isThreadColor(c)) return c } catch { /* sem meta */ }
    return 'blue'
  }
  setActiveThread(t: string, thread: ThreadColor): void {
    if (!isThreadColor(thread)) throw new Error('tópico inválido')
    mkdirSync(this.terminalDir(t), { recursive: true }); writeFileSync(join(this.terminalDir(t), 'meta.json'), JSON.stringify({ activeThread: thread }))
  }
  /** Caminho do anexo dentro do histórico, ou null (id fora do formato, ou arquivo sumido). */
  attachmentPath(t: string, thread: ThreadColor, attachmentId: string): string | null {
    if (!ATT_ID.test(attachmentId)) return null
    const dir = join(this.threadDir(t, thread), 'attachments', attachmentId)
    try { const [name] = readdirSync(dir); return name ? join(dir, name) : null } catch { return null }
  }
  findAttachment(t: string, attachmentId: string): { thread: ThreadColor; path: string; name: string } | null {
    for (const thread of THREAD_COLORS) { const p = this.attachmentPath(t, thread, attachmentId); if (p) return { thread, path: p, name: basename(p) } }
    return null
  }
}
function safeName(name: string): string {
  const base = basename(name.replace(/\\/g, '/')).replace(/[\0-\x1f]/g, '').trim().slice(0, 120)
  return base && base !== '.' && base !== '..' ? base : 'arquivo'
}
