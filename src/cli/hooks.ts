function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function parseRecord(input: string): Record<string, unknown> | undefined {
  try { return record(JSON.parse(input)) } catch { return undefined }
}

/** Malformed/missing hook data must never interrupt the agent's own completion. */
export function lastAssistantText(stopInput: string, readFile: (p: string) => string): string | undefined {
  const stop = parseRecord(stopInput)
  if (typeof stop?.last_assistant_message === 'string') return stop.last_assistant_message
  if (typeof stop?.transcript_path !== 'string') return undefined
  let transcript: string
  try { transcript = readFile(stop.transcript_path) } catch { return undefined }
  let last: string | undefined
  for (const line of transcript.split('\n')) {
    const entry = parseRecord(line)
    if (entry?.type !== 'assistant') continue
    const content = record(entry.message)?.content
    if (typeof content === 'string') last = content
    else if (Array.isArray(content)) {
      const texts = content.flatMap(block => {
        const item = record(block)
        return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []
      })
      last = texts.length ? texts.join('\n') : undefined
    } else last = undefined
  }
  return last
}

export function parseCodexNotify(payload: string): string | undefined {
  const event = parseRecord(payload)
  return event?.type === 'agent-turn-complete' && typeof event['last-assistant-message'] === 'string'
    ? event['last-assistant-message'] : undefined
}

export interface CodexTurn { lastMessage?: string; inputMessages?: string[]; sessionId?: string }

/** `null` = não é um fim de turno que interesse ao palco (ignorar sem avisar o servidor). */
export function codexTurn(payload: string): CodexTurn | null {
  const event = parseRecord(payload)
  if (event?.type !== 'agent-turn-complete') return null
  const last = event['last-assistant-message']
  const inputs = event['input-messages']
  const turn: CodexTurn = {}
  const sessionId = hookSessionId(payload); if (sessionId) turn.sessionId = sessionId
  if (typeof last === 'string') turn.lastMessage = last
  if (Array.isArray(inputs)) turn.inputMessages = inputs.filter((m): m is string => typeof m === 'string')
  return turn
}

/** Session identifiers from authenticated agent hook payloads (never a transcript body). */
export function hookSessionId(payload: string): string | undefined {
  const event = parseRecord(payload), value = event?.session_id ?? event?.['thread-id']
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined
}
