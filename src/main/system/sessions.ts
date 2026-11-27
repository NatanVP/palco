import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'
import { commandShape, shQuote, splitCommandTokens } from '../../shared/agent-command'
import type { TerminalNode } from '../../shared/model'
interface SavedSession { sessionId: string; agent: string; command: string; cwd: string; accountId?: string }
const sessionId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)
/** Only authenticated hook IDs are retained, never transcript/auth bytes. Never guess another terminal's 'last' session. */
export class SessionStore {
  private value: Record<string, SavedSession> = {}
  private readOnly = false
  /** `codexRoot`: troca o id de um subagente do Codex pelo da conversa principal (registros antigos). */
  constructor(private readonly file: string, private readonly codexRoot: (sessionId: string, accountId?: string) => string = (id) => id) {
    try {
      const e = readEnvelope<Record<string, SavedSession>>(file, 'agent-sessions', 1); this.readOnly = e.readOnly
      if (e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload)) for (const [id, s] of Object.entries(e.payload)) {
        if (s && sessionId(s.sessionId) && ['claude', 'codex'].includes(s.agent) && typeof s.command === 'string' && typeof s.cwd === 'string') this.value[id] = s
      }
    } catch { this.readOnly = true }
  }
  remember(node: TerminalNode, id: string): void {
    if (!sessionId(id)) throw new Error('ID de sessão inválido')
    if (this.readOnly || !['claude', 'codex'].includes(node.agent)) return
    const next = { ...this.value, [node.id]: { sessionId: id, agent: node.agent, cwd: node.cwd, command: node.command, ...(node.accountId ? { accountId: node.accountId } : {}) } }
    writeEnvelopeAtomic(this.file, 'agent-sessions', 1, next); this.value = next
  }
  /** Account changes start a fresh session, including deferred switches and removal to Default. */
  forAccountSwitch(node: TerminalNode, accountId: string | null, enabled: boolean): TerminalNode {
    if ((accountId ?? undefined) === node.accountId) return this.forRelaunch(node, enabled)
    if (this.value[node.id]) {
      const next = { ...this.value }; delete next[node.id]
      if (!this.readOnly) writeEnvelopeAtomic(this.file, 'agent-sessions', 1, next)
      this.value = next
    }
    return node
  }
  forRelaunch(node: TerminalNode, enabled: boolean): TerminalNode {
    const s = this.value[node.id]
    if (!enabled || !s || s.agent !== node.agent || s.cwd !== node.cwd || s.command !== node.command || s.accountId !== node.accountId) return node
    try {
      const id = node.agent === 'codex' ? this.codexRoot(s.sessionId, node.accountId) : s.sessionId
      return { ...node, command: resumeCommand(node.command, node.agent, id) }
    } catch { return node }
  }
}
export function resumeCommand(command: string, agent: string, id: string): string {
  if (!sessionId(id)) throw new Error('ID de sessão inválido')
  const shape = commandShape(command)
  if (shape.wrapper) {
    const w = shape.wrapper
    return command.slice(0, w.scriptStart) + shQuote(resumeCommand(w.script, agent, id)) + command.slice(w.scriptEnd)
  }
  const tokens = splitCommandTokens(command)
  if (tokens.some(t => ['--resume', '--continue', '-r', '-c', 'resume', 'exec', 'review'].includes(t.value))) return command
  return agent === 'claude' ? `${command} --resume ${shQuote(id)}` : agent === 'codex' ? `${command} resume ${shQuote(id)}` : command
}
