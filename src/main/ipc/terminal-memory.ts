import type { IpcArea } from './area'

export const MEMORY_CH = { countAbove: 'palco:terminal:memoryCountAbove' } as const
/** Quantos terminais usam hoje mais memória que um limite: base do aviso "Reduzir o limite de memória?". */
export const terminalMemoryArea: IpcArea = ({ handle, deps }) => {
  handle(MEMORY_CH.countAbove, mb => {
    if (typeof mb !== 'number' || !Number.isFinite(mb)) throw new Error('limite inválido')
    return deps.memoryGuard?.countAbove(mb) ?? 0
  })
}
