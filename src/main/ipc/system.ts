import { SYSTEM_CH } from '../../shared/system'
import { systemFor } from '../system/controller'
import type { IpcArea } from './area'
export const systemArea: IpcArea = ({ handle, send, deps }) => {
  const service = () => { const value = systemFor(deps.registry); if (!value) throw new Error('Sistema indisponível'); return value }
  const id = (v: unknown): string => { if (typeof v !== 'string' || v.length > 200 || !v.trim()) throw new Error('aviso inválido'); return v }
  handle(SYSTEM_CH.snapshot, () => service().snapshot())
  handle(SYSTEM_CH.next, () => service().nextAttention())
  handle(SYSTEM_CH.focus, value => service().focus(id(value)))
  handle(SYSTEM_CH.dismiss, value => service().dismiss(id(value)))
  return systemFor(deps.registry)?.onChange(state => send(SYSTEM_CH.changed, state))
}
