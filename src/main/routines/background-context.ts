import { homedir } from 'node:os'
import type { Routine } from '../../shared/model'
import type { WorkspaceRegistry } from '../domain/workspace-registry'
import { addCliToEnvironment, localShellEnvironment } from '../pty/shell-environment'
import type { BackgroundContext } from './background-command'

/** Resolve o diretório gravado na rotina sem depender do workspace exibido na janela. */
export function routineBackgroundContext(r: Routine, registry: WorkspaceRegistry, palcoBin: string, inherited: NodeJS.ProcessEnv = process.env): BackgroundContext | undefined {
  const meta = registry.list().find(w => w.id === r.workspaceId)
  if (!meta) return undefined
  const floor = r.floorId ? registry.get(meta.id).get().floors[r.floorId] : undefined
  if (r.floorId && !floor) return undefined
  const cwd = floor?.dir ?? meta.dir ?? homedir(), env = localShellEnvironment(inherited)
  addCliToEnvironment(env, palcoBin)
  Object.assign(env, { PALCO_WORKSPACE_NAME: meta.name, PALCO_WORKSPACE_DIR: cwd, PALCO_ROUTINE_NAME: r.name })
  return { cwd, env, shell: env.SHELL || '/bin/sh' }
}
