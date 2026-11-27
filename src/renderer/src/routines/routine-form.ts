import type { RoutineInput, RoutineView } from '../../../shared/api'
import type { Schedule } from '../../../shared/model'

export type Kind = Schedule['kind']
export type Unit = 's' | 'm' | 'h'
const SECONDS: Record<Unit, number> = { s: 1, m: 60, h: 3600 }

/** O formulário como o usuário o vê (campos em texto, horários locais). `from` guarda os instantes originais ao editar. */
export interface Draft {
  id?: string
  floorId?: string | null
  name: string
  workspaceId: string
  /** Vazio = lembrete. */
  terminalId: string
  content: string
  preRun: string
  skipIfBusy: boolean
  kind: Kind
  time: string
  days: number[]
  amount: string
  unit: Unit
  at: string
  start: string
  end: RoutineInput['end']['kind']
  count: string
  endDate: string
  notify: boolean
  enabled: boolean
  from: { at?: string; start?: string; until?: string }
}

const two = (n: number): string => String(n).padStart(2, '0')
const localDate = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
/** O valor de um `datetime-local`. */
const localMoment = (d: Date): string => `${localDate(d)}T${two(d.getHours())}:${two(d.getMinutes())}`
const moment = (iso: string | undefined): string => (iso === undefined ? '' : localMoment(new Date(iso)))

export function newDraft(workspaceId: string, now: Date): Draft {
  return {
    name: '', workspaceId, terminalId: '', content: '', preRun: '', skipIfBusy: true, kind: 'daily', time: '09:00', days: [], amount: '30', unit: 'm',
    at: localMoment(new Date(now.getTime() + 60 * 60_000)), start: localMoment(now), end: 'never', count: '1', endDate: '', notify: true, enabled: true, from: {}
  }
}

export function draftOf(r: RoutineView, now: Date): Draft {
  const s = r.schedule
  const unit: Unit = s.kind !== 'every' ? 'm' : s.seconds % 3600 === 0 ? 'h' : s.seconds % 60 === 0 ? 'm' : 's'
  return {
    ...newDraft(r.workspaceId ?? '', now),
    id: r.id, floorId: r.floorId, name: r.name, terminalId: r.background ? '@background' : r.reminder ? '' : r.terminalId, content: r.content, preRun: r.preRun ?? '', skipIfBusy: r.skipIfBusy !== false,
    kind: s.kind,
    ...(s.kind === 'daily' || s.kind === 'weekly' ? { time: s.time } : {}),
    ...(s.kind === 'weekly' ? { days: [...s.days] } : {}),
    ...(s.kind === 'every' ? { amount: String(s.seconds / SECONDS[unit]), unit } : {}),
    ...(s.kind === 'once' ? { at: moment(s.at) } : {}),
    start: moment(r.startsAt),
    end: r.remaining !== undefined ? 'count' : r.until !== undefined ? 'date' : 'never',
    count: String(Math.max(1, r.remaining ?? 1)), endDate: r.until === undefined ? '' : localDate(new Date(r.until)),
    notify: r.notify !== false, enabled: r.enabled,
    from: { ...(s.kind === 'once' ? { at: s.at } : {}), ...(r.startsAt === undefined ? {} : { start: r.startsAt }), ...(r.until === undefined ? {} : { until: r.until }) }
  }
}

export type FormError = 'dias' | 'intervalo' | 'momento' | 'fim'

/** ISO do campo; sem mudança, o instante original (que pode ter segundos que o campo não mostra). */
function instant(field: string, original: string | undefined, shown: (iso: string) => string, parse: (v: string) => Date): string | undefined {
  if (original !== undefined && shown(original) === field) return original
  const d = parse(field)
  return field && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined
}

export function toInput(d: Draft): { input: RoutineInput } | { error: FormError } {
  let schedule: Schedule
  if (d.kind === 'every') {
    const seconds = Number(d.amount) * SECONDS[d.unit]
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 86_400) return { error: 'intervalo' }
    schedule = { kind: 'every', seconds }
  } else if (d.kind === 'once') {
    const at = instant(d.at, d.from.at, moment, (v) => new Date(v))
    if (at === undefined) return { error: 'momento' }
    schedule = { kind: 'once', at }
  } else {
    if (!d.time) return { error: 'momento' }
    if (d.kind === 'weekly' && !d.days.length) return { error: 'dias' }
    schedule = d.kind === 'daily' ? { kind: 'daily', time: d.time } : { kind: 'weekly', days: [...d.days].sort((a, b) => a - b), time: d.time }
  }
  const repeats = d.kind !== 'once'
  const startsAt = repeats ? instant(d.start, d.from.start, moment, (v) => new Date(v)) : undefined
  let end: RoutineInput['end'] = { kind: 'never' }
  if (repeats && d.end === 'count') end = { kind: 'count', count: Number(d.count) }
  if (repeats && d.end === 'date') {
    // A data vale até o fim do dia.
    const date = instant(d.endDate, d.from.until, (iso) => localDate(new Date(iso)), (v) => new Date(`${v}T23:59:59.999`))
    if (date === undefined) return { error: 'fim' }
    end = { kind: 'date', date }
  }
  const background = d.terminalId === '@background', reminder = d.terminalId === ''
  return {
    input: {
      ...(d.id === undefined ? {} : { id: d.id }), name: d.name.trim(), workspaceId: d.workspaceId, terminalId: reminder || background ? null : d.terminalId, ...(background ? { background: true, floorId: d.floorId } : {}), content: d.content,
      ...(d.preRun.trim() ? { preRun: d.preRun } : {}), skipIfBusy: d.skipIfBusy, schedule, ...(startsAt === undefined ? {} : { startsAt }), end,
      // O lembrete é a própria notificação.
      notify: reminder ? true : d.notify, enabled: d.enabled
    }
  }
}
