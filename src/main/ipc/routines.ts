import type { Routine } from '../../shared/model'
import type { RoutineView } from '../../shared/api'
import { describeSchedule } from '../routines/fire'
import { parseRoutineInput } from '../routines/routine-input'
import { workspaceRoutines } from '../routines/workspace-routines'
import type { IpcArea } from './area'

export const ROUTINE_CH = { list: 'palco:routine:list', changed: 'palco:routine:changed', save: 'palco:routine:save', setEnabled: 'palco:routine:setEnabled', runNow: 'palco:routine:runNow', remove: 'palco:routine:remove', history: 'palco:routine:history', historyChanged: 'palco:routine:historyChanged', historyRemove: 'palco:routine:historyRemove', historyClear: 'palco:routine:historyClear' } as const

/** As rotinas na interface: de todos os workspaces (o `palco routine` dos agentes continua preso ao workspace dele). */
export const routinesArea: IpcArea = ({ handle, send, deps }) => {
  const { registry, routines } = deps
  const id = (raw: unknown): string => { if (typeof raw !== 'string' || !raw || raw.length > 200) throw new Error('id inválido'); return raw }
  const store = () => { if (!routines) throw new Error('rotinas indisponíveis'); return routines.store }
  /** Workspace da rotina: o gravado nela ou, nas antigas, o do terminal alvo. */
  const ownerOf = (r: Routine): string | undefined => {
    if (r.workspaceId !== undefined) return r.workspaceId
    const owner = registry.storeOfNode(r.terminalId)
    return owner && registry.idOf(owner)
  }
  const views = (): RoutineView[] => {
    const names = new Map(registry.list().map((w) => [w.id, w.name]))
    return (routines?.store.list() ?? []).map((r) => {
      const workspaceId = ownerOf(r)
      return { ...r, ...(workspaceId === undefined ? {} : { workspaceId }), scheduleText: describeSchedule(r.schedule), terminal: r.background || r.reminder ? '' : registry.node(r.terminalId)?.name ?? '(removido)', workspace: names.get(workspaceId ?? '') ?? '(removido)' }
    })
  }
  const existing = (raw: unknown): Routine => {
    const r = store().byId(id(raw))
    if (!r) throw new Error('rotina inexistente')
    return r
  }

  handle(ROUTINE_CH.list, () => views())
  handle(ROUTINE_CH.save, (raw) => {
    const input = parseRoutineInput(raw, new Date())
    if (!registry.list().some((w) => w.id === input.workspaceId)) throw new Error('workspace inexistente')
    const target = registry.get(input.workspaceId), scope = workspaceRoutines(store(), target)
    const old = input.id === undefined ? undefined : existing(input.id)
    const { routine } = input
    if (!routine.reminder && !routine.background && !target.hasNode(routine.terminalId)) throw new Error('terminal fora do workspace')
    if (routine.background) {
      routine.floorId = routine.floorId === undefined ? old?.floorId ?? target.get().activeFloor : routine.floorId
      if (routine.floorId !== null && !target.get().floors[routine.floorId]) throw new Error('andar inexistente')
    }
    const namesake = scope.byName(routine.name)
    if (namesake && namesake.id !== old?.id) throw new Error(`já existe uma rotina chamada '${routine.name}'`)
    if (!old) {
      const clean = Object.fromEntries(Object.entries(routine).filter(([, value]) => value !== undefined)) as typeof routine
      return scope.add({ ...clean, createdBy: 'user' }).id
    }
    // Agenda, fim, início ou ligar de novo: a contagem recomeça e o último resultado some.
    const timing = (r: Partial<Routine>) => JSON.stringify([r.schedule, r.startsAt ?? null, r.remaining ?? null, r.until ?? null])
    const retimed = timing(old) !== timing(routine)
    store().patch(old.id, { ...routine, workspaceId: input.workspaceId, ...(retimed ? { nextRun: undefined, lastRun: undefined } : routine.enabled && !old.enabled ? { nextRun: undefined } : {}) })
    return old.id
  })
  handle(ROUTINE_CH.setEnabled, (raw, on) => {
    if (typeof on !== 'boolean') throw new Error('valor inválido')
    store().patch(existing(raw).id, on ? { enabled: true, nextRun: undefined } : { enabled: false })
  })
  handle(ROUTINE_CH.runNow, (raw) => routines ? routines.runner.runNow(existing(raw).id) : 'rotinas indisponíveis')
  handle(ROUTINE_CH.remove, (raw) => store().remove(existing(raw).id))
  handle(ROUTINE_CH.history, () => routines?.store.history() ?? [])
  handle(ROUTINE_CH.historyRemove, (raw) => store().removeRun(id(raw)))
  handle(ROUTINE_CH.historyClear, () => store().clearHistory())

  const publish = (): void => send(ROUTINE_CH.changed, views())
  const offs = [routines?.store.onChange(publish), routines?.store.onHistory((list) => send(ROUTINE_CH.historyChanged, list)),
    // Renomear ou tirar um workspace muda o que a lista mostra.
    routines ? registry.onSidebar?.(publish) : undefined]
  return () => { for (const off of offs) off?.() }
}
