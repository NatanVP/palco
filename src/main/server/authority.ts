import type { FloorId } from '../../shared/model'

type Caller = { id: string; floorId: FloorId; maestro?: boolean }

/**
 * Integrar ou excluir um floor: só do Ground (orquestrador), de dentro do próprio floor, ou de um Maestro.
 * Devolve a mensagem do 403, ou `null` se pode.
 */
export function floorAuthorityError(caller: Caller, floor: { id: string; name: string }, action: string): string | null {
  if (caller.maestro === true || caller.floorId === null || caller.floorId === floor.id) return null
  return `só o Ground ou o próprio floor pode ${action} '${floor.name}'`
}

/** Encerrar (`dismiss`): quem recrutou o terminal, ou um Maestro (qualquer terminal alcançável). */
export function canDismiss(caller: Caller, target: { recruitedBy?: string }): boolean {
  return caller.maestro === true || (target.recruitedBy !== undefined && target.recruitedBy === caller.id)
}
