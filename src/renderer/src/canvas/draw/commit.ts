import type { HistoryApi } from '../../../../shared/api'
import type { Drawing } from '../../../../shared/model'

/** Grava o traço confirmado como uma transação do histórico (Ctrl+Z desfaz só ele). Devolve o id novo. */
export async function commitDrawing(api: Pick<HistoryApi, 'commit'>, workspaceId: string, drawing: Omit<Drawing, 'id'>): Promise<string | undefined> {
  const [id] = await api.commit(workspaceId, [{ type: 'drawing.add', drawing }])
  return typeof id === 'string' ? id : undefined
}
