import { restoreTerminals } from '../../src/main/agents/restore'
import type { TerminalNode } from '../../src/shared/model'
it('does not abort app startup when one role is missing and never starts disabled nodes', () => {
  const node: TerminalNode = { id: 'bad', kind: 'terminal', floorId: null, name: 'Bad', role: 'missing', agent: 'claude', command: 'claude', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
  const started: string[] = []
  const failed = restoreTerminals([node, { ...node, id: 'good', role: undefined }, { ...node, id: 'disabled', autoStart: false }], n => { if (n.role) throw new Error('role não encontrado'); started.push(n.id) })
  expect(failed).toEqual(['bad'])
  expect(started).toEqual(['good'])
})
