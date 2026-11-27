import type { Routine } from '../../shared/model'
import type { WorkspaceStore } from '../domain/workspace-store'
import type { RoutineStore } from './routine-store'
/** A rotina pertence ao workspace onde nasceu (`workspaceId`); rotinas antigas, ao workspace do terminal alvo. Nunca pelo nome ou pelo criador. */
export function workspaceRoutines(store: RoutineStore, workspace: Pick<WorkspaceStore, 'get'> & Partial<Pick<WorkspaceStore, 'hasNode'>>) {
  const includes = (id: string): boolean => workspace.hasNode?.(id) ?? Object.hasOwn(workspace.get().nodes, id)
  const belongs = (r: Routine): boolean => (r.workspaceId !== undefined ? r.workspaceId === workspace.get().id : includes(r.terminalId))
  const byId = (id: string): Routine | undefined => { const r = store.byId(id); return r && belongs(r) ? r : undefined }
  const requireId = (id: string): void => { if (!byId(id)) throw new Error('rotina inexistente neste workspace') }
  return {
    list: () => store.list().filter(belongs),
    byName: (name: string) => store.byName(name, belongs),
    byId,
    add: (routine: Omit<Routine, 'id'>) => {
      if (!routine.reminder && !routine.background && !includes(routine.terminalId)) throw new Error('terminal fora do workspace')
      return store.add({ ...routine, workspaceId: workspace.get().id }, belongs)
    },
    patch: (id: string, patch: Partial<Omit<Routine, 'id'>>) => {
      requireId(id)
      if (patch.terminalId !== undefined && patch.terminalId !== '' && !includes(patch.terminalId)) throw new Error('terminal fora do workspace')
      store.patch(id, patch)
    },
    remove: (id: string) => { requireId(id); store.remove(id) },
    runNow: (id: string, runner: { runNow(id: string): string | Promise<string> }) => { requireId(id); return runner.runNow(id) }
  }
}
