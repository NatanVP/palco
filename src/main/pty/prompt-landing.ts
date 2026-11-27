import type { AgentKind } from '../../shared/model'

const squash = (s: string): string => s.replace(/\s+/g, '')

/** Quantos caracteres do início do prompt (sem espaços) precisam aparecer na tela do Codex. */
const CODEX_PREFIX = 24

/** Sinais na tela do Codex de que o prompt entrou mesmo sem aparecer por extenso. */
const CODEX_BUSY = ['[Pasted Content', 'esc to interrupt']

/**
 * O prompt entregue entrou de fato no agente? Um diálogo aberto (ex.: aviso de cota do Codex)
 * engole a colagem e o Enter sem erro nenhum.
 * - Claude: só o hook (`UserPromptSubmit`/`PreToolUse` → busy, ou Stop) confirma; a tela não serve,
 *   porque colagens longas aparecem como "[Pasted text #1]".
 * - Codex: o início do prompt aparece na tela (o composer ecoa "› <prompt>"), ou um notify chegou.
 */
export function promptLanded(agent: AgentKind, screen: string, prompt: string, hookSeen: boolean): boolean {
  if (agent === 'shell' || hookSeen) return true
  if (agent === 'claude') return false
  // Colagem grande vira "[Pasted Content N chars]"; trabalhando, o Codex mostra "esc to interrupt".
  if (CODEX_BUSY.some((mark) => screen.includes(mark))) return true
  const head = squash(prompt).slice(0, CODEX_PREFIX)
  return head.length > 0 && squash(screen).includes(head)
}

/**
 * Marcas de diálogos de seleção na tela do agente. Colar um prompt com um deles aberto é perigoso: o Enter
 * escolhe a opção destacada (ex.: o Codex troca de modelo no aviso de cota).
 */
const DIALOG_MARKS = ['enter select · esc back', 'Approaching rate limits', 'Enter to confirm · Esc to cancel', 'Do you want to proceed?']

/** A marca do diálogo aberto na tela do agente, ou `null`. Shell não tem diálogo. */
export function dialogOpen(agent: AgentKind, screen: string): string | null {
  if (agent === 'shell') return null
  const marks = DIALOG_MARKS.filter((mark) => screen.includes(mark))
  if (marks.length === 0) return null
  // Mostra a marca mais descritiva primeiro (o título do diálogo, quando houver).
  return marks.find((m) => !m.includes('·')) ?? marks[0]!
}
