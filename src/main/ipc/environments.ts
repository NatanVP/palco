import { which } from '../environments/system'
import type { IpcArea } from './area'

export const ENV_CH = { status: 'palco:environments:status' } as const
export interface EnvironmentStatus { tmux: string | null; ssh: string | null; docker: string | null; sbx: string | null }
/** Quais programas dos ambientes existem no PATH (a aba Geral › Ambientes mostra o estado de cada um). */
export const environmentsArea: IpcArea = ({ handle }) => {
  handle(ENV_CH.status, (): EnvironmentStatus => ({ tmux: which('tmux'), ssh: which('ssh'), docker: which('docker'), sbx: which('sbx') }))
}
