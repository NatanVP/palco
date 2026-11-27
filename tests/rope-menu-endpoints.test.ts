import { describe, expect, it } from 'vitest'
import * as menu from '../src/renderer/src/canvas/rope-menu'
import type { CanvasNode, Workspace } from '../src/shared/model'

const term = (id: string, x: number, extra: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, kind: 'terminal', name: id.toUpperCase(), agent: 'claude', command: 'claude', cwd: '/p', floorId: null, pos: { x, y: 0 }, size: { w: 200, h: 100 }, icon: 'bot', color: '#112233', ...extra }) as CanvasNode
const note = (id: string, x: number): CanvasNode => ({ id, kind: 'note', name: 'Nota', content: '', floorId: null, pos: { x, y: 0 }, size: { w: 100, h: 100 } }) as CanvasNode
const ws = (nodes: CanvasNode[], connections: Array<[string, string, string]>): Workspace => ({
  id: 'w', name: 'W', nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), connections: connections.map(([id, a, b]) => ({ id, a, b })),
  camera: { offset: { x: 0, y: 0 }, zoom: 1 }, floors: { f1: { id: 'f1', name: 'ui' } }, activeFloor: null
}) as unknown as Workspace

describe('linhas do menu da corda', () => {
  it('as pontas ficam da esquerda para a direita pelo centro, qualquer que seja a ordem da corda', () => {
    const rows = menu.ropeRows?.(ws([term('b', 500), term('a', 0)], [['c1', 'b', 'a']]), ['c1'])
    expect(rows?.[0]?.endpoints.map((e) => e.nodeId)).toEqual(['a', 'b'])
  })
  it('cada ponta traz nome, ícone e cor do terminal; nota e portal usam o ícone do tipo', () => {
    const [row] = menu.ropeRows?.(ws([term('a', 0), note('n', 400)], [['c1', 'a', 'n']]), ['c1']) ?? []
    expect(row?.endpoints[0]).toMatchObject({ name: 'A', icon: 'bot', tint: '#112233', place: null })
    expect(row?.endpoints[1]).toMatchObject({ name: 'Nota', icon: 'note', tint: null })
  })
  it('ponta em outro andar mostra o nome do andar; no térreo, Ground', () => {
    const w = ws([term('a', 0), term('b', 300, { floorId: 'f1' } as never)], [['c1', 'a', 'b']])
    const [row] = menu.ropeRows?.(w, ['c1']) ?? []
    expect(row?.endpoints[1]?.place).toBe('ui')
    expect(menu.ropeRows?.(ws([term('a', 0), term('b', 300, { floorId: 'f1' } as never)], [['c1', 'b', 'a']]), ['c1'])?.[0]?.endpoints[0]?.place).toBeNull()
  })
  it('corda que sumiu ou com ponta apagada fica de fora; a ordem pedida (de cima para baixo) é mantida', () => {
    const w = ws([term('a', 0), term('b', 300), term('c', 600)], [['c1', 'a', 'b'], ['c2', 'b', 'c']])
    expect(menu.ropeRows?.(w, ['c2', 'zz', 'c1'])?.map((r) => r.ropeId)).toEqual(['c2', 'c1'])
  })
  it('rótulo "A e B" para leitor de tela', () => {
    const [row] = menu.ropeRows?.(ws([term('a', 0), term('b', 300)], [['c1', 'a', 'b']]), ['c1']) ?? []
    expect(row && menu.ropeLabel?.(row)).toBe('A e B')
  })
})

describe('onde o menu abre', () => {
  it('centrado no clique, 6 px abaixo, sem sair da janela (margem 8)', () => {
    const p = menu.popoverPosition
    expect(p?.({ x: 500, y: 300 }, { w: 200, h: 40 }, { w: 1000, h: 800 })).toEqual({ left: 400, top: 306 })
    expect(p?.({ x: 20, y: 300 }, { w: 200, h: 40 }, { w: 1000, h: 800 })?.left).toBe(8)
    expect(p?.({ x: 990, y: 300 }, { w: 200, h: 40 }, { w: 1000, h: 800 })?.left).toBe(792)
    expect(p?.({ x: 500, y: 790 }, { w: 200, h: 40 }, { w: 1000, h: 800 })?.top).toBe(790 - 6 - 40)
  })
})

describe('qual corda recebe o clique', () => {
  it('só cordas distintas sob o ponto, na ordem do empilhamento', () => {
    expect(menu.uniqueRopeIds?.(['a', 'b', 'a', null, 'c'])).toEqual(['a', 'b', 'c'])
  })
})
