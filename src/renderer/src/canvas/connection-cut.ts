import type { HistoryApi } from '../../../shared/api'

/**
 * Corta cordas pelo histórico: um `connection.remove` por corda, numa transação só (Ctrl+Z traz todas de volta).
 * O `connection.remove` direto é uma edição "externa" e LIMPA a pilha de desfazer; todo corte de corda passa por aqui
 * (tesoura do menu da corda, lista de conexões da barra contextual, Delete na corda selecionada e o corte da corda até outro andar).
 */
export async function cutConnections(api: Pick<HistoryApi, 'commit'>, workspaceId: string, ids: readonly string[]): Promise<void> {
  if (!ids.length) return
  await api.commit(workspaceId, ids.map((id) => ({ type: 'connection.remove' as const, id })))
}
