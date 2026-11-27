/**
 * A regra única de "Bloquear" (`positionLocked` nos nós, `locked` nos desenhos), usada pelo store e pela tela:
 * - o elemento bloqueado não se apaga, não se move e não muda de tamanho; só desbloquear o libera;
 * - num fichário, um membro bloqueado segura o conjunto: os outros não se movem nem mudam de tamanho (podem sair dele),
 *   e o fichário inteiro não se apaga.
 * Renomear, mudar cor e ordem continuam valendo. Apagar um andar ou um workspace é ação sobre o lugar, não sobre o elemento.
 */
export interface LockNode { kind: string; floorId: string | null; positionLocked?: boolean; stackId?: string }
export interface LockDrawing { locked?: boolean }

export const LOCKED_MESSAGE = 'elemento bloqueado: desbloqueie antes'
export class LockedError extends Error {
  constructor() { super(LOCKED_MESSAGE); this.name = 'LockedError' }
}

const sameStack = (nodes: Record<string, LockNode>, node: LockNode): LockNode[] =>
  node.kind !== 'note' || !node.stackId ? [node] : Object.values(nodes).filter((n) => n.kind === 'note' && n.stackId === node.stackId && n.floorId === node.floorId)

/** O elemento está preso no lugar: bloqueado, ou no fichário de um bloqueado. */
export const isHeld = (nodes: Record<string, LockNode>, node: LockNode): boolean => sameStack(nodes, node).some((n) => n.positionLocked === true)

/** Dos ids pedidos para apagar, os que podem sair: nunca um bloqueado, nem o resto de um fichário pedido inteiro que tenha um. */
export function removableIds(nodes: Record<string, LockNode & { id: string }>, ids: readonly string[]): string[] {
  const asked = new Set(ids)
  return ids.filter((id) => {
    const node = nodes[id]
    if (!node || node.positionLocked) return false
    const stack = sameStack(nodes, node) as Array<LockNode & { id: string }>
    return !(stack.length > 1 && stack.some((n) => n.positionLocked) && stack.every((n) => asked.has(n.id)))
  })
}
