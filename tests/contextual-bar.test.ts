import { barContent, connectionCount, connectionRows, focusCamera } from '../src/renderer/src/canvas/contextual'
import type { CanvasNode, Workspace } from '../src/shared/model'

const term = (id: string, floorId: string | null = null): CanvasNode =>
  ({ id, kind: 'terminal', name: id.toUpperCase(), agent: 'shell', command: 'bash', cwd: '/tmp', floorId, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }) as CanvasNode

function ws(nodes: CanvasNode[], connections: Array<[string, string]> = [], activeFloor: string | null = null): Workspace {
  return {
    id: 'w', name: 'W', nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    connections: connections.map(([a, b], i) => ({ id: `c${i}`, a, b })),
    camera: { offset: { x: 0, y: 0 }, zoom: 1 }, floors: { f1: { id: 'f1', name: 'ui', branch: 'palco/ui', worktree: '/x', createdAt: 1, camera: { offset: { x: 0, y: 0 }, zoom: 1 } } },
    activeFloor
  } as unknown as Workspace
}

const note: CanvasNode = { id: 'n', kind: 'note', name: 'Nota', content: '', floorId: null, pos: { x: 0, y: 0 }, size: { w: 260, h: 100 } } as CanvasNode
const band: CanvasNode = { id: 'b', kind: 'band', name: 'Banda', members: ['a', 'b2'], floorId: null, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } } as CanvasNode

describe('barContent: o que a barra mostra conforme a seleção', () => {
  it('nada selecionado → sem barra', () => {
    expect(barContent(ws([term('a')]), new Set())).toBeNull()
  })
  it('um terminal → barra do terminal', () => {
    expect(barContent(ws([term('a')]), new Set(['a']))).toEqual({ kind: 'terminal', id: 'a' })
  })
  it('uma nota → barra própria', () => {
    expect(barContent(ws([note]), new Set(['n']))).toEqual({ kind: 'note', id: 'n' })
  })
  it('2 ou mais terminais soltos → Criar banda', () => {
    expect(barContent(ws([term('a'), term('c')]), new Set(['a', 'c']))).toEqual({ kind: 'band-create', terminals: ['a', 'c'], ids: ['a', 'c'] })
  })
  it('1 banda + terminais soltos → Adicionar à banda', () => {
    const w = ws([term('a'), term('b2'), term('c'), band])
    expect(barContent(w, new Set(['b', 'c']))).toEqual({ kind: 'band-add', band: 'b', terminals: ['c'], ids: ['b', 'c'] })
  })
  it('terminal que já está numa banda não conta como solto', () => {
    const w = ws([term('a'), term('b2'), band])
    expect(barContent(w, new Set(['a', 'b2']))).toEqual({ kind: 'multi', ids: ['a', 'b2'] })
  })
  it('mistura com outro tipo → só excluir', () => {
    expect(barContent(ws([term('a'), term('c'), note]), new Set(['a', 'c', 'n']))).toEqual({ kind: 'multi', ids: ['a', 'c', 'n'] })
  })
  it('ignora ids que não existem mais e nós de outro floor', () => {
    expect(barContent(ws([term('a'), term('z', 'f1')]), new Set(['a', 'z', 'sumiu']))).toEqual({ kind: 'terminal', id: 'a' })
  })
})

describe('selo de conexões', () => {
  it('conta as cordas do nó, inclusive as que vão a outro floor', () => {
    const w = ws([term('a'), term('c'), note, term('z', 'f1')], [['a', 'c'], ['n', 'a'], ['a', 'z'], ['c', 'n']])
    expect(connectionCount(w, 'a')).toBe(3)
    expect(connectionCount(w, 'c')).toBe(2)
  })
  it('não conta a ligação entre membros da mesma banda', () => {
    const w = ws([term('a'), term('b2'), term('c'), band], [['a', 'b2'], ['a', 'c']])
    expect(connectionCount(w, 'a')).toBe(1)
  })
  it('zero quando não há cordas', () => {
    expect(connectionCount(ws([term('a')]), 'a')).toBe(0)
  })
  it('linhas da lista Conexões: nome do outro lado e floor', () => {
    const w = ws([term('a'), term('c'), term('z', 'f1')], [['a', 'c'], ['z', 'a']])
    expect(connectionRows(w, 'a')).toEqual([
      { connectionId: 'c0', peerId: 'c', peerName: 'C', floorId: null, floorLabel: null },
      { connectionId: 'c1', peerId: 'z', peerName: 'Z', floorId: 'f1', floorLabel: 'ui' }
    ])
  })
})

describe('focusCamera', () => {
  it('centraliza o nó na área visível mantendo o zoom', () => {
    const cam = focusCamera({ offset: { x: 0, y: 0 }, zoom: 2 }, { pos: { x: 100, y: 50 }, size: { w: 200, h: 100 } }, { w: 1000, h: 800 })
    expect(cam).toEqual({ zoom: 2, offset: { x: 500 - 200 * 2, y: 400 - 100 * 2 } })
  })
})
