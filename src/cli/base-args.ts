/** Quando dois tipos têm o mesmo nome, a flag logo depois do nome diz qual é. */
export const ELEMENT_KINDS = ['agent', 'band', 'note', 'fichario', 'portal'] as const
export type ElementKind = (typeof ELEMENT_KINDS)[number]
const kindFlag = (value: string | undefined): ElementKind | undefined => ELEMENT_KINDS.find((k) => value === `--${k}`)
export type BaseCommand =
  | { cmd: 'ask-batch'; prompts: Record<string, string> }
  | { cmd: 'ask-raw'; to: string; data: string }
  | { cmd: 'notify'; message: string }
  | { cmd: 'debug' }
  | { cmd: 'arrange'; target?: string; name?: string; icon?: string; color?: string; json?: boolean; kind?: ElementKind }
  | { cmd: 'connect'; from: string; to: string; fromKind?: ElementKind; toKind?: ElementKind }
  | { cmd: 'note-stack'; name: string; stack?: string }
  | { cmd: 'note-unstack'; name: string }
  | { cmd: 'note-import'; file: string; copy?: boolean }
  | { cmd: 'note-delete'; name: string; stack?: boolean }
/** `\n` é a tecla Enter: no terminal, Enter é CR (`\r`); um LF não confirma menus de TUI. */
export function rawEscapes(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|[nte\\])/g, (_, c: string) => c[0] === 'x' ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ n: '\r', t: '\t', e: '\x1b', '\\': '\\' }[c]!))
}
const bad = (): never => { throw new Error('Uso: palco ask --batch JSON | ask Nome --raw texto | notify mensagem | debug | arrange [Nome] [--name N] [--icon I] [--color C] [--json] | connect De Para | note stack|unstack|delete Nome') }
export function parseBase(a: string[]): BaseCommand | undefined {
  if (a[0] === 'ask' && a[1] === '--batch') {
    if (a.length !== 3) bad()
    let value: unknown
    try { value = JSON.parse(a[2]!) } catch { return bad() }
    if (!value || Array.isArray(value) || typeof value !== 'object' || !Object.keys(value).length || Object.entries(value).some(([k, v]) => !k.trim() || typeof v !== 'string')) bad()
    return { cmd: 'ask-batch', prompts: value as Record<string, string> }
  }
  if (a[0] === 'ask' && a[2] === '--raw') {
    if (a.length !== 4 || !a[1]?.trim()) bad()
    return { cmd: 'ask-raw', to: a[1]!, data: rawEscapes(a[3]!) }
  }
  if (a[0] === 'debug') { if (a.length !== 1) bad(); return { cmd: 'debug' } }
  if (a[0] === 'notify') { if (a.length !== 2) bad(); return { cmd: 'notify', message: a[1]! } }
  if (a[0] === 'connect') {
    const ends: Array<{ name: string; kind?: ElementKind }> = []
    for (let i = 1; i < a.length; i++) {
      const kind = kindFlag(a[i]), last = ends[ends.length - 1]
      if (kind) { if (!last || last.kind) bad(); else last.kind = kind }
      else { if (a[i]!.startsWith('--') || !a[i]!.trim()) bad(); ends.push({ name: a[i]! }) }
    }
    if (ends.length !== 2) bad()
    const [from, to] = ends as [typeof ends[number], typeof ends[number]]
    return { cmd: 'connect', from: from.name, to: to.name, ...(from.kind ? { fromKind: from.kind } : {}), ...(to.kind ? { toKind: to.kind } : {}) }
  }
  if (a[0] === 'arrange') {
    const out: Extract<BaseCommand, {cmd:'arrange'}> = { cmd: 'arrange' }; let literal = false
    for (let i = 1; i < a.length; i++) {
      const x = a[i]!
      if (x === '--' && !literal) { literal = true; continue }
      if (!literal && x === '--json') { if (out.json) bad(); out.json = true; continue }
      const kind = literal ? undefined : kindFlag(x)
      if (kind) { if (kind === 'portal' || out.kind || out.target === undefined) bad(); out.kind = kind; continue }
      if (!literal && x.startsWith('-')) {
        const key = x.slice(2)
        if (!['name', 'color', 'icon'].includes(key) || Object.hasOwn(out, key) || !a[i + 1] || a[i + 1]!.startsWith('--')) bad()
        Object.assign(out, { [key]: a[++i] })
      } else { if (out.target !== undefined) bad(); out.target = x }
    }
    // `--json` só na consulta do visual (sem mudar nada).
    if (out.json && (out.name !== undefined || out.icon !== undefined || out.color !== undefined)) bad()
    return out
  }
  if (a[0] === 'note' && a[1] === 'import') {
    const files = a.slice(2).filter((x) => x !== '--copy'), copy = a.includes('--copy')
    if (files.length !== 1 || files[0]!.startsWith('--') || !files[0]!.trim() || a.length > 4) bad()
    return { cmd: 'note-import', file: files[0]!, ...(copy ? { copy: true } : {}) }
  }
  if (a[0] === 'note' && ['stack', 'unstack', 'delete'].includes(a[1]!)) {
    if (a[1] === 'delete' && a[2] === '--stack' && a.length === 4) return { cmd: 'note-delete', name: a[3]!, stack: true }
    const p = a.slice(2); if (p[0] === '--') p.shift()
    if (!p[0]?.trim() || p.length > (a[1] === 'stack' ? 2 : 1)) bad()
    if (a[1] === 'stack') return { cmd: 'note-stack', name: p[0]!, ...(p[1] === undefined ? {} : { stack: p[1] }) }
    return { cmd: a[1] === 'unstack' ? 'note-unstack' : 'note-delete', name: p[0]! }
  }
  return undefined
}
