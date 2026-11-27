/** Contratos do chat do terminal (o agente responde pelo comando `palco say`). Compartilhado entre main, preload e renderer. */
export const THREAD_COLORS = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green'] as const
export type ThreadColor = (typeof THREAD_COLORS)[number]
export const isThreadColor = (v: unknown): v is ThreadColor => typeof v === 'string' && (THREAD_COLORS as readonly string[]).includes(v)

export type ChatStatus = 'idle' | 'working' | 'needsAttention' | 'interrupted'
export interface ChatAttachment { id: string; name: string; kind: 'image' | 'file'; size: number }
export interface ChatQuestion { prompt: string; options: Array<{ label: string; detail?: string; recommended?: boolean }> }
export interface ChatEntry {
  id: string
  ts: number
  role: 'user' | 'agent'
  /** `divider`: marca "a conversa anterior aconteceu no terminal". */
  kind: 'message' | 'progress' | 'question' | 'divider'
  text: string
  attachments?: ChatAttachment[]
  question?: ChatQuestion
}
export interface ChatState {
  terminalId: string
  thread: ThreadColor
  entries: ChatEntry[]
  hasOlder: boolean
  status: ChatStatus
  unreadCount: number
  workingSince: number | null
  filledThreads: ThreadColor[]
  /** `queued`: a mensagem espera o agente ficar pronto; `lost`: o terminal encerrou antes de recebê-la. */
  delivery?: 'queued' | 'lost'
}
export type ChatSendResult = { accepted: true; entryId: string } | { accepted: false; cause: 'empty' | 'notRunning' | 'shell' | 'attachment' | 'failed'; reason?: string }
export interface ChatSayInput { text?: string; progress?: boolean; question?: ChatQuestion; attach?: string[] }

/**
 * Mensagem que o agente recebe no terminal. A instrução completa vai em linha (não depende da skill estar carregada, vale para Claude Code
 * e Codex); tudo depois da cerca é o texto do usuário, os anexos vêm por caminho absoluto.
 */
export function chatHeader(thread: ThreadColor, text: string, attachments: ReadonlyArray<{ name: string; path: string; kind: 'image' | 'file' }>): string {
  const head = [
    '---',
    'Below is a message from the user through Palco Chat.',
    'Reply only via `palco say` (run it with your shell tool); terminal text does not reach the user. If the palco-chat skill is not loaded yet, load it.',
    "Usage: palco say <<'EOF' ... EOF  |  palco say 'short answer'  |  palco say --file <path>  |  palco say --attach <path> 'text'  |  palco say --progress 'status' (turn continues)",
    '       palco say --question "Question?" --option "A" [--detail "note"] [--recommended] --option "B"  |  palco recall [thread] [--turns N | --all]',
    'Every `palco say` is a bubble the user sees; the last one without --progress closes your turn. Math: $..$ and $$..$$; code and mermaid blocks render.',
    `thread: ${thread}`,
    '---'
  ].join('\n')
  const files = attachments.length ? `\n\nAttached by the user:\n${attachments.map(a => `- ${a.kind}: ${a.path}`).join('\n')}` : ''
  return `${head}\n${text}${files}`
}
