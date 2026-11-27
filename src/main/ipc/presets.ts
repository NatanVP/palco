import { validateAppearance } from '../../shared/appearance'
import type { IpcArea } from './area'

export const PRESET_CH = {
  set: 'palco:presets:set', create: 'palco:presets:create', remove: 'palco:presets:remove', reorder: 'palco:presets:reorder',
  restore: 'palco:presets:restore', missing: 'palco:presets:missing', reset: 'palco:presets:reset'
} as const

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const opt = (o: Record<string, unknown>, key: string, type: 'string' | 'boolean'): void => {
  if (o[key] !== undefined && typeof o[key] !== type) throw new Error(`${key} inválido`)
}
/** Início Rápido (Terminal): criar, editar, excluir, ligar/desligar, reordenar e restaurar os presets. A leitura segue em `presets:list`. */
export const presetsArea: IpcArea = ({ handle, deps }) => {
  const store = () => { if (!deps.agents) throw new Error('presets indisponíveis'); return deps.agents.presets }
  handle(PRESET_CH.create, raw => {
    if (!isObject(raw)) throw new Error('preset inválido')
    for (const k of ['name', 'command', 'role', 'account']) opt(raw, k, 'string')
    for (const k of ['maestro', 'quickStart', 'startInChat']) opt(raw, k, 'boolean')
    if (typeof raw.name !== 'string') throw new Error('nome obrigatório')
    return store().create({ name: raw.name, command: typeof raw.command === 'string' ? raw.command : '', ...(raw.role ? { role: raw.role as string } : {}), ...(raw.account ? { account: raw.account as string } : {}),
      ...(raw.maestro === undefined ? {} : { maestro: raw.maestro as boolean }), ...(raw.quickStart === undefined ? {} : { quickStart: raw.quickStart as boolean }), ...(raw.startInChat === undefined ? {} : { startInChat: raw.startInChat as boolean }), ...(raw.appearance === undefined ? {} : { appearance: validateAppearance(raw.appearance) }) })
  })
  handle(PRESET_CH.set, (name, raw) => {
    if (typeof name !== 'string' || !isObject(raw)) throw new Error('preset inválido')
    for (const k of ['newName', 'command']) opt(raw, k, 'string')
    for (const k of ['maestro', 'quickStart', 'startInChat']) opt(raw, k, 'boolean')
    if (raw.account !== undefined && raw.account !== null && typeof raw.account !== 'string') throw new Error('account inválido')
    const appearance = raw.appearance === undefined ? undefined : validateAppearance(raw.appearance)
    const { newName, command, account, maestro, quickStart, startInChat } = raw as { newName?: string; command?: string; account?: string | null; maestro?: boolean; quickStart?: boolean; startInChat?: boolean }
    return store().set(name, { ...(newName === undefined ? {} : { newName }), ...(command === undefined ? {} : { command }), ...(account === undefined ? {} : { account }), ...(maestro === undefined ? {} : { maestro }), ...(quickStart === undefined ? {} : { quickStart }), ...(startInChat === undefined ? {} : { startInChat }), ...(appearance === undefined ? {} : { appearance }) })
  })
  handle(PRESET_CH.remove, name => { if (typeof name !== 'string') throw new Error('nome inválido'); store().remove(name) })
  handle(PRESET_CH.reorder, names => { if (!Array.isArray(names) || names.some(n => typeof n !== 'string')) throw new Error('ordem inválida'); store().reorder(names as string[]) })
  handle(PRESET_CH.restore, () => { store().restoreDefaults() })
  handle(PRESET_CH.reset, () => { store().resetDefaults() })
  handle(PRESET_CH.missing, () => store().missingDefaults())
}
