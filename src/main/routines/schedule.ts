import type { Schedule } from '../../shared/model'

const DAYS: Record<string, number> = {
  dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, 'sáb': 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
}

const MAX_EVERY_S = 24 * 60 * 60
const MIN_EVERY_S = 10

/** "9:05" ou "09:05" → "09:05"; lança em hora inválida. */
function parseTime(text: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  const h = m ? Number(m[1]) : NaN
  const min = m ? Number(m[2]) : NaN
  if (!m || h > 23 || min > 59) throw new Error(`hora inválida: ${text} (use HH:MM)`)
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

function atTime(day: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
}

/** "AAAA-MM-DD HH:MM" (ou com T) em hora local, ou null se o formato não bater. */
function localDateTime(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0)
  // Recusa datas que o Date "conserta" (31/02, 25:00).
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3]) || d.getHours() !== Number(m[4])) return null
  return d
}

export interface ScheduleOptions {
  every?: string
  daily?: string
  /** `mon,wed,fri@09:00` */
  weekly?: string
  once?: string
}

/** `45s`, `30m`, `2h`, `1h30m`; número sozinho é minutos. Devolve segundos. */
function parseInterval(text: string): number {
  const t = text.trim().toLowerCase()
  let seconds: number
  if (/^\d+$/.test(t)) seconds = Number(t) * 60
  else {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
    if (!m || t === '' || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) seconds = NaN
    else seconds = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  }
  if (!Number.isFinite(seconds) || seconds < MIN_EVERY_S || seconds > MAX_EVERY_S) {
    throw new Error(`intervalo inválido: ${text} (use 45s, 30m, 2h ou 1h30m; de ${MIN_EVERY_S}s a 24h)`)
  }
  return seconds
}

/** `mon,wed,fri@09:00` → dias (0 = domingo) e hora. */
function parseWeekly(text: string): { days: number[]; time: string } {
  const at = text.lastIndexOf('@')
  if (at === -1) throw new Error(`semanal inválido: ${text} (use mon,wed,fri@09:00)`)
  const days = text.slice(0, at).split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (days.length === 0) throw new Error(`semanal inválido: ${text} (use mon,wed,fri@09:00)`)
  const nums = days.map((d) => {
    const n = DAYS[d]
    if (n === undefined) throw new Error(`dia inválido: ${d} (use mon, tue, wed, thu, fri, sat, sun)`)
    return n
  })
  return { days: [...new Set(nums)].sort((a, b) => a - b), time: parseTime(text.slice(at + 1)) }
}

/** Lê as opções do CLI; exatamente um formato. `now` resolve `--once HH:MM` e recusa o passado. */
export function parseSchedule(o: ScheduleOptions, now: Date): Schedule {
  const given = [o.every, o.daily, o.weekly, o.once].filter((v) => v !== undefined)
  if (given.length !== 1) throw new Error('use exatamente um de --every, --daily, --weekly, --once')
  if (o.every !== undefined) return { kind: 'every', seconds: parseInterval(o.every) }
  if (o.daily !== undefined) return { kind: 'daily', time: parseTime(o.daily) }
  if (o.weekly !== undefined) return { kind: 'weekly', ...parseWeekly(o.weekly) }
  const text = o.once!.trim()
  let when = localDateTime(text)
  if (!when) {
    if (!/^\d{1,2}:\d{2}$/.test(text)) throw new Error(`horário inválido: ${text} (use "AAAA-MM-DD HH:MM")`)
    when = atTime(now, parseTime(text))
    if (when <= now) when = new Date(when.getFullYear(), when.getMonth(), when.getDate() + 1, when.getHours(), when.getMinutes())
  }
  if (when <= now) throw new Error(`horário já passou: ${text}`)
  return { kind: 'once', at: when.toISOString() }
}

/** Próximo disparo estritamente depois de `after`; `null` quando um `once` já passou. */
export function nextRun(s: Schedule, after: Date): Date | null {
  switch (s.kind) {
    case 'every':
      return new Date(after.getTime() + s.seconds * 1000)
    case 'daily': {
      const today = atTime(after, s.time)
      return today > after ? today : atTime(new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1), s.time)
    }
    case 'weekly': {
      for (let i = 0; i <= 7; i++) {
        const candidate = atTime(new Date(after.getFullYear(), after.getMonth(), after.getDate() + i), s.time)
        if (s.days.includes(candidate.getDay()) && candidate > after) return candidate
      }
      return null
    }
    case 'once': {
      const when = new Date(s.at)
      return when > after ? when : null
    }
  }
}

/** `--until`: "AAAA-MM-DD" vale até o fim do dia; "AAAA-MM-DDTHH:MM", exato. Devolve ISO. */
export function parseUntil(text: string): string {
  const full = localDateTime(text)
  if (full) return full.toISOString()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    if (d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) return d.toISOString()
  }
  throw new Error(`data inválida: ${text} (use AAAA-MM-DD ou AAAA-MM-DDTHH:MM)`)
}
