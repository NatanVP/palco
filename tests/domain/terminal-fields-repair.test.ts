import { describe, expect, it } from 'vitest'
import { validateWorkspace } from '../../src/main/domain/workspace-schema'

const ws = (terminal: Record<string, unknown>) => ({
  id: 'w', name: 'W', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, connections: [], floors: {}, activeFloor: null,
  nodes: {
    t: { id: 't', kind: 'terminal', floorId: null, name: 'T', agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 }, ...terminal },
    n: { id: 'n', kind: 'note', floorId: null, name: 'N', content: 'fica', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
  }
})

describe('schema repara role e autoStart em vez de reprovar o workspace', () => {
  it.each([
    ['role em shell', { role: 'revisor' }],
    ['role vazio', { agent: 'claude', command: 'claude', role: '  ' }],
    ['role que não é texto', { agent: 'codex', command: 'codex', role: 42 }]
  ])('%s: o campo sai com aviso e o resto abre', (_label, extra) => {
    const warnings: string[] = []
    const out = validateWorkspace(ws(extra), (m) => warnings.push(m))
    expect(out.nodes.t).not.toHaveProperty('role')
    expect(out.nodes.n).toMatchObject({ content: 'fica' })
    expect(warnings.join(';')).toMatch(/role/)
  })

  it('autoStart que não é booleano sai com aviso', () => {
    const warnings: string[] = []
    const out = validateWorkspace(ws({ autoStart: 'sim' }), (m) => warnings.push(m))
    expect(out.nodes.t).not.toHaveProperty('autoStart')
    expect(warnings.join(';')).toMatch(/autoStart/)
  })

  it('valores válidos ficam', () => {
    const out = validateWorkspace(ws({ agent: 'claude', command: 'claude', role: 'revisor', autoStart: false }))
    expect(out.nodes.t).toMatchObject({ role: 'revisor', autoStart: false })
  })
})
