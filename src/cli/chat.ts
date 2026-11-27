import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ChatQuestion } from '../shared/chat'

/** `palco say`: uma bolha do agente no chat do usuário. */
export interface SayCommand { text?: string; file?: string; attach: string[]; progress: boolean; question?: ChatQuestion; stdin: boolean }
export type RecallPeriod = { last?: 'day' | 'week' | 'month'; from?: string; to?: string }
export type RecallCommand = { kind: 'list' } | { kind: 'attachment'; id: string } | ({ kind: 'thread'; thread?: string; turns?: number; all: boolean; json: boolean } & RecallPeriod)

const bad = (reason: string): never => { throw new Error(`Uso: ${reason}`) }
export const SAY_USAGE = "say [--progress] [--file arq] [--attach arq]... ['texto' | texto via stdin] | say --question \"?\" --option A [--detail D] [--recommended] --option B"
export const RECALL_USAGE = 'recall [tópico] [--turns N | --last day|week|month | --from AAAA-MM-DD [--to AAAA-MM-DD] | --all] [--json] | recall list | recall attachment <id>'

/** Data de calendário de verdade (2026-13-40 não passa). */
export const isCalendarDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toJSON()?.slice(0, 10) === v

export function parseSay(args: string[]): SayCommand {
  const out: SayCommand = { attach: [], progress: false, stdin: false }
  const text: string[] = []
  let literal = false, prompt: string | undefined
  const options: ChatQuestion['options'] = []
  const value = (i: number, flag: string): string => { const v = args[i + 1]; if (v === undefined || (v.startsWith('--') && v.length > 2)) return bad(`${flag} precisa de um valor`); return v }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (!literal && a === '--') { literal = true; continue }
    if (literal || !a.startsWith('--')) { text.push(a); continue }
    switch (a) {
      case '--progress': out.progress = true; break
      case '--file': out.file = value(i, a); i++; break
      case '--attach': out.attach.push(value(i, a)); i++; break
      case '--question': prompt = value(i, a); i++; break
      case '--option': options.push({ label: value(i, a) }); i++; break
      case '--detail': { const o = options.at(-1); if (!o) bad('--detail vem depois de uma --option'); o!.detail = value(i, a); i++; break }
      case '--recommended': { const o = options.at(-1); if (!o) bad('--recommended vem depois de uma --option'); o!.recommended = true; break }
      default: bad(`opção desconhecida: ${a}`)
    }
  }
  if (prompt !== undefined) {
    if (options.length < 2) bad('--question precisa de pelo menos duas --option')
    if (text.length || out.file || out.progress) bad('--question não combina com texto, --file nem --progress')
    out.question = { prompt, options }
  } else if (options.length) bad('--option só vale com --question')
  if (text.length) out.text = text.join(' ')
  // Sem texto, --file nem pergunta, o texto vem do stdin (heredoc), também junto de --attach.
  if (out.text === undefined && out.file === undefined && !out.question) out.stdin = true
  return out
}

/** Monta o corpo do POST /say. `--file`: texto UTF-8 vira o texto; imagem vira anexo (o main confirma o tipo). Caminho relativo é resolvido aqui. */
export function sayBody(cmd: SayCommand, stdin: () => string, cwd = process.cwd()): Record<string, unknown> {
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(cwd, p))
  const attach = cmd.attach.map(abs)
  let text = cmd.text
  if (cmd.file !== undefined) {
    const p = abs(cmd.file)
    if (!statSync(p).isFile()) bad(`${cmd.file} não é um arquivo`)
    const buf = readFileSync(p)
    if (looksBinary(buf)) attach.push(p)
    else text = [text, buf.toString('utf8')].filter(Boolean).join('\n')
  }
  if (cmd.stdin) { const piped = stdin(); if (piped.trim() !== '') text = piped }
  return { ...(text !== undefined ? { text } : {}), ...(cmd.progress ? { progress: true } : {}), ...(cmd.question ? { question: cmd.question } : {}), ...(attach.length ? { attach } : {}) }
}
const looksBinary = (b: Buffer): boolean => b.subarray(0, 4096).includes(0)

export function parseRecall(args: string[]): RecallCommand {
  if (args[0] === 'list' && args.length === 1) return { kind: 'list' }
  if (args[0] === 'attachment') { if (args.length !== 2) bad(RECALL_USAGE); return { kind: 'attachment', id: args[1]! } }
  let thread: string | undefined, turns: number | undefined, all = false, json = false
  const period: RecallPeriod = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--last') { const v = args[++i]; if (v !== 'day' && v !== 'week' && v !== 'month') bad('--last aceita day, week ou month'); period.last = v as RecallPeriod['last'] }
    else if (a === '--from' || a === '--to') { const v = args[++i]; if (!v || !isCalendarDate(v)) bad(`${a} pede uma data AAAA-MM-DD`); period[a === '--from' ? 'from' : 'to'] = v! }
    else if (a === '--all') all = true
    else if (a === '--json') json = true
    else if (a === '--turns') { const v = args[++i]; if (!v || !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 500) bad('--turns aceita de 1 a 500'); turns = Number(v) }
    else if (a.startsWith('--')) bad(`opção desconhecida: ${a}`)
    else if (thread === undefined) thread = a
    else bad(RECALL_USAGE)
  }
  if (all && turns !== undefined) bad('--all não combina com --turns')
  if (period.to !== undefined && period.from === undefined) bad('--to só vale com --from')
  if ([turns !== undefined, all, period.last !== undefined, period.from !== undefined].filter(Boolean).length > 1) bad('--turns, --all, --last e --from não se combinam')
  return { kind: 'thread', ...(thread ? { thread } : {}), ...(turns ? { turns } : {}), all, json, ...period }
}

/** Preserve the requested representation all the way to the authenticated route. */
export function recallRequestPath(c: RecallCommand): string {
  if (c.kind === 'list') return '/recall?list=1'
  if (c.kind === 'attachment') return `/recall/attachment?id=${encodeURIComponent(c.id)}`
  return '/recall?' + new URLSearchParams({
    ...(c.thread ? { thread: c.thread } : {}), ...(c.turns ? { turns: String(c.turns) } : {}),
    ...(c.all ? { all: '1' } : {}), ...(c.json ? { json: '1' } : {}),
    ...(c.last ? { last: c.last } : {}), ...(c.from ? { from: c.from } : {}), ...(c.to ? { to: c.to } : {})
  })
}
