import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { routineBackgroundContext } from '../../src/main/routines/background-context'
import type { Routine } from '../../src/shared/model'

const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })
it('resolve o workspace e andar gravados e inclui o CLI no ambiente local sem herdar outra sessão', () => {
  const root = mkdtempSync(join(tmpdir(), 'palco-routine-context-')); dirs.push(root)
  const registry = new WorkspaceRegistry(join(root, 'workspaces')), workspaceId = registry.activeId()
  registry.setWorkspaceDir(workspaceId, root)
  const r = { workspaceId, background: true, floorId: null, name: 'Resumo' } as Routine
  const env = { PATH: '/usr/bin', SHELL: '/bin/sh', PALCO_TOKEN: 'test-session', CLAUDECODE: 'test-session', CODEX_HOME: '/fake/account', CLAUDE_CONFIG_DIR: '/fake/account', HOME: root }
  const context = routineBackgroundContext(r, registry, '/opt/palco/bin/palco', env)!
  expect(context).toMatchObject({ cwd: root, shell: '/bin/sh', env: { PATH: '/opt/palco/bin:/usr/bin', PALCO_CLI: '/opt/palco/bin/palco', HOME: root, PALCO_WORKSPACE_DIR: root } })
  for (const key of ['PALCO_TOKEN', 'CLAUDECODE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) expect(context.env).not.toHaveProperty(key)
  const snapshot = registry.get(workspaceId).get()
  // O registro oferece os diretórios dos andares, independentemente da câmera ativa.
  const floor = { dir: join(root, 'andar') }
  const get = registry.get.bind(registry)
  registry.get = id => ({ ...get(id), get: () => ({ ...snapshot, floors: { floor } }) }) as never
  expect(routineBackgroundContext({ ...r, floorId: 'floor' }, registry, '/opt/palco/bin/palco', env)?.cwd).toBe(floor.dir)
  expect(routineBackgroundContext({ ...r, floorId: 'apagado' }, registry, '/opt/palco/bin/palco', env)).toBeUndefined()
  expect(routineBackgroundContext({ ...r, workspaceId: 'apagado' }, registry, '/opt/palco/bin/palco', env)).toBeUndefined()
})
