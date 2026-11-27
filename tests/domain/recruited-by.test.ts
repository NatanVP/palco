import { describe, expect, it } from 'vitest'
import { validateWorkspace } from '../../src/main/domain/workspace-schema'

const ws = (extra: Record<string, unknown>) => ({
  id: 'w', name: 'w', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, connections: [], floors: {}, activeFloor: null,
  nodes: { t1: { id: 't1', kind: 'terminal', floorId: null, name: 'T', agent: 'shell', command: '', cwd: '/', pos: { x: 0, y: 0 }, size: { w: 10, h: 10 }, ...extra } }
})

describe('recruitedBy no workspace salvo', () => {
  it('aceita o campo opcional (texto) e o preserva', () => {
    const loaded = validateWorkspace(ws({ recruitedBy: 'abc' }))
    expect((loaded.nodes.t1 as { recruitedBy?: string }).recruitedBy).toBe('abc')
    expect(() => validateWorkspace(ws({}))).not.toThrow()
  })

  it('recusa recruitedBy que não é texto', () => {
    expect(() => validateWorkspace(ws({ recruitedBy: 5 }))).toThrow()
  })
})
