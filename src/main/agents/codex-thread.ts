import { closeSync, openSync, opendirSync, readSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

/** `root`: a conversa principal, a única que o `codex resume` aceita reabrir. */
export interface CodexThread { subagent: boolean; root: string }

const THREAD_ID = /^[A-Za-z0-9_-]{1,128}$/
/** A primeira linha do rollout leva as instruções do agente: passa de 64 KB com folga, mas tem teto. */
const MAX_META_BYTES = 4 * 1024 * 1024
const MAX_DEPTH = 8
const MAX_ENTRIES = 20_000

function firstLine(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const chunks: Buffer[] = []
    for (let size = 0; size < MAX_META_BYTES;) {
      const chunk = Buffer.alloc(64 * 1024)
      const read = readSync(fd, chunk, 0, chunk.length, null)
      if (read === 0) break
      const end = chunk.subarray(0, read).indexOf(10)
      chunks.push(chunk.subarray(0, end === -1 ? read : end))
      if (end !== -1) break
      size += read
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally { closeSync(fd) }
}

function findRollout(sessions: string, id: string, entryLimit: number): string | undefined {
  let visited = 0
  let exhausted = false
  const readEntries = (dir: string): Dirent[] => {
    const handle = opendirSync(dir)
    const entries: Dirent[] = []
    try {
      while (visited < entryLimit) {
        const entry = handle.readSync()
        if (!entry) break
        visited++
        entries.push(entry)
      }
      if (visited >= entryLimit) exhausted = true
    } finally { handle.closeSync() }
    return entries
  }
  const matchingFile = (entries: Dirent[], dir: string): string | undefined => {
    const entry = entries
      .filter((candidate) => candidate.isFile() && candidate.name.startsWith('rollout-') && candidate.name.endsWith(`-${id}.jsonl`))
      .sort((a, b) => b.name.localeCompare(a.name))[0]
    return entry ? join(dir, entry.name) : undefined
  }

  const rootEntries = readEntries(sessions)
  if (exhausted) return undefined
  const years = rootEntries.filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name))
  for (const year of years) {
    const yearPath = join(sessions, year.name)
    for (const month of readEntries(yearPath).filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name))) {
      const monthPath = join(yearPath, month.name)
      for (const day of readEntries(monthPath).filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name))) {
        const dayPath = join(monthPath, day.name)
        const file = matchingFile(readEntries(dayPath), dayPath)
        if (file) return file
        if (exhausted) return undefined
      }
      if (exhausted) return undefined
    }
    if (exhausted) return undefined
  }
  const direct = matchingFile(rootEntries, sessions)
  return exhausted ? undefined : direct
}

function sessionMeta(sessions: string, id: string, files: Map<string, string | undefined>, entryLimit: number): Record<string, unknown> | undefined {
  if (!files.has(id)) files.set(id, findRollout(sessions, id, entryLimit))
  const file = files.get(id)
  if (!file) return undefined
  const line = JSON.parse(firstLine(file)) as { type?: unknown; payload?: unknown }
  return line.type === 'session_meta' && typeof line.payload === 'object' && line.payload !== null ? line.payload as Record<string, unknown> : undefined
}

function isSubagent(meta: Record<string, unknown>): boolean {
  const source = meta.source
  return meta.thread_source === 'subagent' || (typeof source === 'object' && source !== null && 'subagent' in source)
}

/**
 * O `notify` do Codex também dispara no fim de turno dos subagentes, com o id deles. Lê só os metadados do rollout
 * em `<CODEX_HOME>/sessions`. Na dúvida (sem arquivo, formato novo), trata como conversa principal.
 */
export function codexThread(threadId: string, codexHome: string, requestedEntryLimit = MAX_ENTRIES): CodexThread {
  const self = { subagent: false, root: threadId }
  if (!THREAD_ID.test(threadId)) return self
  try {
    const dir = join(codexHome, 'sessions')
    const files = new Map<string, string | undefined>()
    const entryLimit = Math.max(1, Math.min(requestedEntryLimit, MAX_ENTRIES))
    const meta = sessionMeta(dir, threadId, files, entryLimit)
    if (!meta || !isSubagent(meta)) return self
    let current = meta, id = threadId
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      // `session_id` é o da conversa principal; se vier igual ao próprio id, sobe pelo pai.
      const next = [current.session_id, current.parent_thread_id].find((v): v is string => typeof v === 'string' && v !== id && THREAD_ID.test(v))
      if (!next) break
      id = next
      const parent = sessionMeta(dir, id, files, entryLimit)
      if (!parent || !isSubagent(parent)) break
      current = parent
    }
    return { subagent: true, root: id }
  } catch { return self }
}
