import type { AgentUsage } from '../../shared/model'

/**
 * Leitura de uso com cache curto: o painel pode pedir várias vezes por segundo, mas a leitura varre
 * diretórios no processo main (junto dos PTYs). Pedidos simultâneos compartilham a mesma leitura.
 */
export function cachedUsage(read: () => Promise<AgentUsage[]>, ttlMs: number, now: () => number = Date.now): () => Promise<AgentUsage[]> {
  let at = -Infinity
  let pending: Promise<AgentUsage[]> | undefined
  return () => {
    if (!pending || now() - at >= ttlMs) {
      at = now()
      pending = read().catch((err: unknown) => {
        at = -Infinity
        throw err
      })
    }
    return pending
  }
}
