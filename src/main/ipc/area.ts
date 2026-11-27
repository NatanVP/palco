import { ipcMain } from 'electron'
import type { IpcDeps } from '../ipc'

/**
 * Registro de IPC por área. Cada área mantém seus handlers separados e compartilha as verificações de remetente.
 * O arquivo `src/main/ipc/<área>.ts` exporta um `IpcArea`, registrado em `AREAS` (`src/main/ipc/index.ts`).
 *
 * - `handle`: `ipcMain.handle` com a checagem de remetente do app (mutações de canvas continuam em `ipc.ts`).
 * - `listen`: `ipcMain.on` sem resposta (erro é registrado e descartado).
 * - `send`: evento para a janela.
 * - `deps`: as dependências injetadas no `registerIpc`.
 */
export interface IpcAreaContext {
  handle(channel: string, fn: (...args: unknown[]) => unknown): void
  listen(channel: string, fn: (...args: unknown[]) => void): void
  send(channel: string, ...args: unknown[]): void
  deps: IpcDeps
  /** Tira um canal registrado durante a limpeza das áreas; injetável para testes. */
  removeChannel?(channel: string): void
}
/** Devolve, se precisar, a limpeza própria (assinaturas, timers); os canais registrados saem sozinhos. */
export type IpcArea = (ctx: IpcAreaContext) => (() => void) | void

/** Registra as áreas em ordem e devolve a limpeza (limpezas próprias na ordem inversa, depois os canais). */
export function registerAreas(areas: readonly IpcArea[], ctx: IpcAreaContext): () => void {
  const channels: string[] = [], offs: Array<() => void> = []
  const tracking: IpcAreaContext = {
    ...ctx,
    handle: (c, fn) => { channels.push(c); ctx.handle(c, fn) },
    listen: (c, fn) => { channels.push(c); ctx.listen(c, fn) }
  }
  for (const area of areas) { const off = area(tracking); if (off) offs.push(off) }
  const remove = ctx.removeChannel ?? ((c: string) => { ipcMain.removeHandler(c); ipcMain.removeAllListeners(c) })
  return () => {
    for (const off of offs.reverse()) off()
    for (const c of channels) remove(c)
  }
}
