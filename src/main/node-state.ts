/** "Descarregar" e "Acordar" do menu do elemento: a marca no workspace só muda depois que o processo confirma. */
interface Store { get(): { nodes: Record<string, { kind: string; unloaded?: boolean }> }; setUnloaded(id: string, unloaded: boolean): void; hasNode(id: string): boolean }
export interface NodeStateDeps {
  registry: { storeOfNode(id: string): unknown }
  terminals: {
    /** Encerra pelo mesmo caminho do reiniciar (espera a saída, escala para SIGKILL); rejeita se o processo não morrer. */
    unload(id: string): Promise<void>
    /** Sobe e só resolve com o processo de pé. */
    startConfirmed(node: never): Promise<void>
    dispose(id: string): void
    isRunning(id: string): boolean
  }
  portals: { unregister(id: string): void }
}

const owner = (d: NodeStateDeps, id: string): Store => {
  const store = d.registry.storeOfNode(id) as Store | undefined
  if (!store) throw new Error('nó inexistente')
  return store
}

export async function unloadNodes(d: NodeStateDeps, ids: readonly string[]): Promise<void> {
  const results = await Promise.allSettled(ids.map(async (id) => {
    const store = owner(d, id), kind = store.get().nodes[id]!.kind
    if (kind === 'portal') { store.setUnloaded(id, true); d.portals.unregister(id); return }
    if (kind !== 'terminal') return
    await d.terminals.unload(id)
    // O usuário pode ter apagado o nó enquanto o processo saía.
    if (store.hasNode(id)) store.setUnloaded(id, true)
  }))
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) throw failed.reason
}

/** Partidas em andamento: dois pedidos juntos (botão e Recarregar) esperam a mesma. */
const waking = new Map<string, Promise<void>>()

export function wakeNode(d: NodeStateDeps, id: string): Promise<void> {
  const running = waking.get(id)
  if (running) return running
  const start = (async () => {
    const store = owner(d, id), node = store.get().nodes[id]!
    if (node.kind === 'terminal' && !d.terminals.isRunning(id)) {
      try { await d.terminals.startConfirmed(node as never) }
      catch (error) {
        // Nada pela metade: a partida sai e o terminal continua descarregado (também no próximo lançamento).
        d.terminals.dispose(id)
        throw error
      }
    }
    if (store.hasNode(id)) store.setUnloaded(id, false)
  })().finally(() => waking.delete(id))
  waking.set(id, start)
  return start
}
