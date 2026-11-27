import type { RoutineInput } from '../../shared/api'
import type { Routine, Schedule } from '../../shared/model'

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const fail = (message: string): never => { throw new Error(message) }
const date = (v: unknown, message: string): Date => {
  const d = typeof v === 'string' ? new Date(v) : new Date(NaN)
  return Number.isNaN(d.getTime()) ? fail(message) : d
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function schedule(raw: unknown, now: Date): Schedule {
  const bad = (): never => fail('agenda inválida')
  if (!obj(raw)) return bad()
  const time = (): string => (typeof raw.time === 'string' && TIME.test(raw.time) ? raw.time : bad())
  switch (raw.kind) {
    case 'once': {
      const at = date(raw.at, 'agenda inválida')
      return at > now ? { kind: 'once', at: at.toISOString() } : fail('o horário já passou')
    }
    case 'every': return Number.isInteger(raw.seconds) && (raw.seconds as number) >= 10 && (raw.seconds as number) <= 86_400 ? { kind: 'every', seconds: raw.seconds as number } : bad()
    case 'daily': return { kind: 'daily', time: time() }
    case 'weekly': {
      const days = Array.isArray(raw.days) ? [...new Set(raw.days)] : []
      return days.length && days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) ? { kind: 'weekly', days: (days as number[]).sort((a, b) => a - b), time: time() } : bad()
    }
    default: return bad()
  }
}

export type ParsedRoutine = { id?: string; workspaceId: string; routine: Omit<Routine, 'id' | 'createdBy' | 'workspaceId'> }

/** Confere o que veio da folha de rotina e devolve os campos como são gravados (os ausentes saem como `undefined`, para limpar). */
export function parseRoutineInput(raw: unknown, now: Date): ParsedRoutine {
  if (!obj(raw)) return fail('rotina inválida')
  const v = raw as Partial<Record<keyof RoutineInput, unknown>>
  const name = typeof v.name === 'string' ? v.name.trim() : ''
  if (!name || name.length > 200) fail('dê um nome à rotina')
  if (typeof v.workspaceId !== 'string' || !v.workspaceId) fail('workspace inexistente')
  if (v.terminalId !== null && (typeof v.terminalId !== 'string' || !v.terminalId)) fail('rotina inválida')
  if (typeof v.content !== 'string' || v.content.length > 100_000 || (v.preRun !== undefined && (typeof v.preRun !== 'string' || v.preRun.length > 100_000))) fail('rotina inválida')
  if (typeof v.skipIfBusy !== 'boolean' || typeof v.notify !== 'boolean' || typeof v.enabled !== 'boolean') fail('rotina inválida')
  if (v.background !== undefined && typeof v.background !== 'boolean') fail('rotina inválida')
  if (v.background === true && v.terminalId !== null) fail('rotina inválida')
  if (v.floorId !== undefined && v.floorId !== null && (typeof v.floorId !== 'string' || !v.floorId)) fail('rotina inválida')
  const background = v.background === true, reminder = v.terminalId === null && !background, content = v.content as string
  if (!reminder && !content.trim()) fail('escreva o comando ou o prompt')
  const when = schedule(v.schedule, now), repeats = when.kind !== 'once'
  const startsAt = repeats && v.startsAt !== undefined ? date(v.startsAt, 'início inválido') : undefined
  let remaining: number | undefined, until: string | undefined
  const end = obj(v.end) ? v.end : fail('rotina inválida')
  if (repeats && end.kind === 'count') {
    if (!Number.isInteger(end.count) || (end.count as number) < 1 || (end.count as number) > 1_000_000) fail('número de execuções inválido')
    remaining = end.count as number
  } else if (repeats && end.kind === 'date') {
    const last = date(end.date, 'data de término inválida')
    if (last <= now || (startsAt && last <= startsAt)) fail('a data de término precisa ser depois do início')
    until = last.toISOString()
  }
  return {
    ...(typeof v.id === 'string' && v.id ? { id: v.id } : {}),
    workspaceId: v.workspaceId as string,
    routine: {
      name, schedule: when, content, enabled: v.enabled as boolean, notify: v.notify as boolean, skipIfBusy: v.skipIfBusy as boolean,
      terminalId: reminder || background ? '' : (v.terminalId as string), reminder: reminder ? true : undefined, background: background ? true : undefined, floorId: background ? v.floorId as string | null | undefined : undefined,
      preRun: (v.preRun as string | undefined)?.trim() ? (v.preRun as string) : undefined,
      startsAt: startsAt?.toISOString(), remaining, until
    }
  }
}
