import type { Routine, TerminalNode } from '../../shared/model'
import type { WorkspaceStore } from '../domain/workspace-store'
import { describeSchedule } from './fire'
import type { RoutineRunner } from './routine-runner'
import type { RoutineStore } from './routine-store'
import { parseSchedule, parseUntil, type ScheduleOptions } from './schedule'
import { workspaceRoutines } from './workspace-routines'

import { RouteError as RoutineHttpError, requireMaestro } from '../server/route-error'

type Ctx = { caller: TerminalNode; url: URL; body: Record<string, unknown> }
type Reply = { status: number; body: string; type?: 'application/json' }
export interface RoutineRouteDeps {
  routines?: { store: RoutineStore; runner: Pick<RoutineRunner, 'runNow'> }
  store: WorkspaceStore
  /** Terminal citado por nome (alcançável ou o próprio chamador); lança o erro HTTP certo. */
  memberTarget(ctx: Ctx, name: string): TerminalNode
  /** Nome de um terminal em qualquer workspace. */
  nameOf(id: string): string | undefined
}

const SCHEDULE_KEYS = ['every', 'daily', 'weekly', 'once'] as const
const MAX_CONTENT = 100_000

const text = (body: string, status = 200): Reply => ({ status, body })
const json = (value: unknown): Reply => ({ status: 200, body: JSON.stringify(value), type: 'application/json' })
const shortId = (id: string): string => id.slice(0, 8)
const when = (iso: string | undefined): string => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nenhum (desativada)'

function optStr(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new RoutineHttpError(400, `campo '${key}' deve ser texto`)
  return v
}
function optBool(body: Record<string, unknown>, key: string): boolean | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw new RoutineHttpError(400, `campo '${key}' deve ser verdadeiro ou falso`)
  return v
}
const bad = <T>(fn: () => T): T => {
  try { return fn() } catch (err) {
    if (err instanceof RoutineHttpError) throw err
    throw new RoutineHttpError(400, err instanceof Error ? err.message : String(err))
  }
}

/** Rotas `palco routine` (skill palco-routines): só o Maestro, só o workspace do chamador. */
export function createRoutineRoutes(deps: RoutineRouteDeps): Record<string, (ctx: Ctx) => Reply | Promise<Reply>> {
  const scope = () => {
    if (!deps.routines) throw new RoutineHttpError(501, 'rotinas indisponíveis')
    return workspaceRoutines(deps.routines.store, deps.store)
  }
  const maestro = (ctx: Ctx): void => requireMaestro(ctx.caller)
  const view = (r: Routine) => ({
    ...r,
    shortId: shortId(r.id),
    terminal: r.background ? '(segundo plano)' : r.reminder ? '(lembrete)' : deps.nameOf(r.terminalId) ?? '(removido)',
    schedule: describeSchedule(r.schedule)
  })
  /** Nome (sem caixa) e, com `--id`, o prefixo do id; nome repetido sem `--id` devolve as correspondências. */
  const find = (name: string, id: string | undefined): Routine => {
    const wanted = name.trim().toLowerCase()
    let matches = scope().list().filter((r) => r.name.toLowerCase() === wanted)
    if (id !== undefined && id.trim() !== '') matches = matches.filter((r) => r.id.startsWith(id.trim().toLowerCase()))
    if (matches.length === 0) throw new RoutineHttpError(404, `rotina '${name}' não existe${id ? ` com id ${id}` : ''}; rode palco routine list`)
    if (matches.length > 1) {
      const lines = matches.map((r) => `  ${shortId(r.id)}  ${r.name}  ${describeSchedule(r.schedule)}  ${view(r).terminal}`)
      throw new RoutineHttpError(409, `há ${matches.length} rotinas chamadas '${name}'; rode de novo com --id <prefixo>:\n${lines.join('\n')}`)
    }
    return matches[0]!
  }
  const target = (ctx: Ctx, q: Record<string, unknown>): Routine => find(String(q.name ?? ''), optStr(q, 'id'))
  const content = (body: Record<string, unknown>): string | undefined => {
    const c = optStr(body, 'command') ?? optStr(body, 'content')
    if (c !== undefined && (c.trim() === '' || c.length > MAX_CONTENT)) throw new RoutineHttpError(400, "campo 'command' vazio ou grande demais")
    return c
  }
  const schedule = (body: Record<string, unknown>) => {
    const given: ScheduleOptions = {}
    for (const k of SCHEDULE_KEYS) { const v = optStr(body, k); if (v !== undefined) given[k] = v }
    return Object.keys(given).length === 0 ? undefined : bad(() => parseSchedule(given, new Date()))
  }
  /** Destino: `reminder` (sem terminal), `terminal` nomeado ou, se nenhum, `fallback`. */
  const destination = (ctx: Ctx, body: Record<string, unknown>): { reminder: boolean; terminalId: string; label: string } | undefined => {
    const reminder = optBool(body, 'reminder') === true
    const terminal = optStr(body, 'terminal')
    if (reminder && terminal !== undefined) throw new RoutineHttpError(400, '--reminder não tem terminal de destino: não combine com --terminal')
    if (reminder) return { reminder: true, terminalId: '', label: 'lembrete' }
    if (terminal === undefined) return undefined
    const to = deps.memberTarget(ctx, terminal)
    return { reminder: false, terminalId: to.id, label: to.name }
  }
  const count = (body: Record<string, unknown>): number | undefined => {
    const c = body.count
    if (c === undefined || c === null) return undefined
    if (!(Number.isInteger(c) && (c as number) >= 1)) throw new RoutineHttpError(400, "campo 'count' deve ser inteiro ≥ 1")
    return c as number
  }
  /** Opções comuns a create e edit (só as que vieram). */
  const options = (body: Record<string, unknown>): Partial<Routine> => {
    const out: Partial<Routine> = {}
    const preRun = optStr(body, 'preRun')
    if (preRun !== undefined) out.preRun = preRun
    if (optBool(body, 'noSkipIfBusy') === true) out.skipIfBusy = false
    if (optBool(body, 'noNotify') === true) out.notify = false
    const n = count(body)
    if (n !== undefined) out.remaining = n
    const until = optStr(body, 'until')
    if (until !== undefined) out.until = bad(() => parseUntil(until))
    if (optBool(body, 'disabled') === true) out.enabled = false
    return out
  }

  return {
    'GET /routine/list': (ctx) => { maestro(ctx); return json(scope().list().map(view)) },

    'GET /routine/show': (ctx) => {
      maestro(ctx)
      return json(view(find(ctx.url.searchParams.get('name') ?? '', ctx.url.searchParams.get('id') ?? undefined)))
    },

    'POST /routine/create': (ctx) => {
      maestro(ctx)
      const s = scope()
      const name = optStr(ctx.body, 'name')?.trim() ?? ''
      if (name === '' || name.length > 200) throw new RoutineHttpError(400, "campo 'name' vazio ou grande demais")
      const c = content(ctx.body)
      if (c === undefined) throw new RoutineHttpError(400, 'routine create precisa de --command')
      const sched = schedule(ctx.body)
      if (!sched) throw new RoutineHttpError(400, 'use exatamente uma agenda: --every, --daily, --weekly ou --once')
      if (s.byName(name)) throw new RoutineHttpError(409, `já existe uma rotina chamada '${name}'`)
      const dest = destination(ctx, ctx.body) ?? { reminder: false, terminalId: '', label: 'segundo plano' }
      const routine = bad(() => s.add({
        name, schedule: sched, terminalId: dest.terminalId, content: c, enabled: true, createdBy: ctx.caller.id,
        ...(dest.reminder ? { reminder: true } : !dest.terminalId ? { background: true, floorId: ctx.caller.floorId } : {}),
        ...options(ctx.body)
      }))
      const saved = s.byId(routine.id)!
      return text(`OK: rotina ${name} (${shortId(saved.id)}) criada para ${dest.label}, ${describeSchedule(saved.schedule)}; próximo disparo: ${when(saved.nextRun)}`)
    },

    'POST /routine/edit': (ctx) => {
      maestro(ctx)
      const s = scope()
      const r = target(ctx, ctx.body)
      const patch: Partial<Routine> = {}
      const newName = optStr(ctx.body, 'newName')?.trim()
      if (newName !== undefined) {
        if (newName === '' || newName.length > 200) throw new RoutineHttpError(400, "campo 'newName' vazio ou grande demais")
        const clash = s.byName(newName)
        if (clash && clash.id !== r.id) throw new RoutineHttpError(409, `já existe uma rotina chamada '${newName}'`)
        patch.name = newName
      }
      const c = content(ctx.body)
      if (c !== undefined) patch.content = c
      const sched = schedule(ctx.body)
      // Agenda nova: o próximo disparo é recalculado e o último resultado some.
      if (sched) Object.assign(patch, { schedule: sched, nextRun: undefined, lastRun: undefined })
      const dest = destination(ctx, ctx.body)
      if (dest) Object.assign(patch, { terminalId: dest.terminalId, reminder: dest.reminder ? true : undefined, background: undefined, floorId: undefined })
      Object.assign(patch, options(ctx.body))
      if (Object.keys(patch).length === 0) throw new RoutineHttpError(400, 'routine edit precisa de ao menos uma mudança (--name, --command, agenda ou opções)')
      bad(() => s.patch(r.id, patch))
      const saved = s.byId(r.id)!
      return text(`OK: rotina ${saved.name} (${shortId(saved.id)}) alterada; ${describeSchedule(saved.schedule)}; próximo disparo: ${when(saved.nextRun)}`)
    },

    'POST /routine/enable': (ctx) => {
      maestro(ctx)
      const r = target(ctx, ctx.body)
      scope().patch(r.id, { enabled: true, nextRun: undefined })
      return text(`OK: rotina ${r.name} ativada`)
    },

    'POST /routine/disable': (ctx) => {
      maestro(ctx)
      const r = target(ctx, ctx.body)
      scope().patch(r.id, { enabled: false })
      return text(`OK: rotina ${r.name} desativada`)
    },

    'POST /routine/run': async (ctx) => {
      maestro(ctx)
      const r = target(ctx, ctx.body)
      return text(await scope().runNow(r.id, deps.routines!.runner))
    },

    'POST /routine/delete': (ctx) => {
      maestro(ctx)
      const r = target(ctx, ctx.body)
      scope().remove(r.id)
      return text(`OK: rotina ${r.name} excluída`)
    }
  }
}
