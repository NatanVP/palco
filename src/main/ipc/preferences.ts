import { isShortcutId } from '../../shared/shortcuts'
import type { IpcArea } from './area'

export const PREFS_CH = {
  get: 'palco:preferences:get', set: 'palco:preferences:set', changed: 'palco:preferences:changed',
  bind: 'palco:preferences:bind', reset: 'palco:preferences:resetShortcuts'
} as const

/** Preferências: leitura, patch validado, regravação de atalho e o evento de mudança. */
export const preferencesArea: IpcArea = ({ handle, send, deps }) => {
  const prefs = () => { if (!deps.preferences) throw new Error('preferências indisponíveis'); return deps.preferences }
  handle(PREFS_CH.get, () => prefs().get())
  handle(PREFS_CH.set, raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.hasOwn(raw, 'shortcuts')) throw new Error('patch de preferências inválido')
    return prefs().set(raw)
  })
  handle(PREFS_CH.bind, (id, binding) => {
    if (!isShortcutId(id)) throw new Error('atalho inválido')
    return prefs().bind(id, binding as never)
  })
  handle(PREFS_CH.reset, () => prefs().resetShortcuts())
  return deps.preferences?.onChange(value => send(PREFS_CH.changed, value))
}
