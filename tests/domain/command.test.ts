import { parseNewNode } from '../../src/main/validate'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
const terminal = { kind: 'terminal' as const, floorId: null, name: 'Agent', agent: 'codex' as const, command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 600, h: 400 } }
it.each(['codex; echo unsafe', '$(echo unsafe)', 'X=bad', 'codex "aberta', 'x\ny', 'x|y', 'x&y', 'x>y', '`pwd`', '-x'])('rejects shell syntax at IPC and store boundaries: %s', command => {
  expect(() => parseNewNode({ ...terminal, command })).toThrow(/command/)
  const dir = mkdtempSync(join(process.cwd(), 'tests/domain/.command-'))
  try { expect(() => new WorkspaceStore(join(dir, 'ws')).addNode({ ...terminal, command })).toThrow(/command/) }
  finally { rmSync(dir, { recursive: true, force: true }) }
})
it.each(['claude', 'codex', 'shell'] as const)('normalizes an empty command for %s', agent => {
  expect(parseNewNode({ ...terminal, agent })).toMatchObject({ command: agent === 'shell' ? '' : agent })
})
it('permits a safe executable path', () => {
  expect(parseNewNode({ ...terminal, command: '/opt/agent/bin/codex' })).toMatchObject({ command: '/opt/agent/bin/codex' })
})
