import { describe, expect, it } from 'vitest'
import { crossFloorPeers, floorTabs, nodesOnFloor, visibleConnections } from '../../src/renderer/src/floors/floor-view'
import type { Workspace } from '../../src/shared/model'

const node = (id: string, floorId: string | null, kind: 'note' | 'portal' = 'note') =>
  kind === 'note'
    ? { id, kind, floorId, name: id, content: '', pos: { x: 0, y: 0 }, size: { w: 10, h: 10 } }
    : { id, kind, floorId, name: id, url: 'about:blank', pos: { x: 0, y: 0 }, size: { w: 10, h: 10 } }

const ws = (activeFloor: string | null): Workspace => ({
  id: 'w',
  name: 'w',
  nodes: { g1: node('g1', null), g2: node('g2', null, 'portal'), f1: node('f1', 'ui'), f2: node('f2', 'ui') } as never,
  connections: [{ id: 'c1', a: 'g1', b: 'g2' }, { id: 'c2', a: 'f1', b: 'f2' }],
  camera: { offset: { x: 0, y: 0 }, zoom: 1 },
  floors: {
    ui: { id: 'ui', name: 'ui', repoRoot: '/r', dir: '/r.floors/ui', branch: 'palco/ui', baseRef: 'main', status: { state: 'review', progress: '2/3' }, camera: { offset: { x: 0, y: 0 }, zoom: 1 }, createdAt: 20 },
    api: { id: 'api', name: 'api', repoRoot: '/r', dir: '/r.floors/api', branch: 'palco/api', baseRef: 'main', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, createdAt: 10 }
  },
  activeFloor
})

describe('floor-view', () => {
  it('nodesOnFloor só devolve os nós do floor ativo (Ground = null)', () => {
    expect(nodesOnFloor(ws(null)).map((n) => n.id).sort()).toEqual(['g1', 'g2'])
    expect(nodesOnFloor(ws('ui')).map((n) => n.id).sort()).toEqual(['f1', 'f2'])
    expect(nodesOnFloor(ws('api'))).toEqual([])
  })

  it('visibleConnections só devolve as conexões entre nós visíveis', () => {
    expect(visibleConnections(ws(null)).map((c) => c.id)).toEqual(['c1'])
    expect(visibleConnections(ws('ui')).map((c) => c.id)).toEqual(['c2'])
  })

  it('floorTabs: Ground primeiro, depois os floors por criação, com status e aba ativa', () => {
    const tabs = floorTabs(ws('ui'))
    expect(tabs.map((t) => [t.id, t.label, t.active])).toEqual([[null, 'Ground', false], ['api', 'api', false], ['ui', 'ui', true]])
    expect(tabs[1]!.status).toBeUndefined()
    expect(tabs[2]!.status).toEqual({ state: 'review', progress: '2/3' })
    expect(tabs[2]!.tooltip).toBe('review (2/3)')
    expect(tabs[1]!.tooltip).toBe('palco/api')
    expect(floorTabs(ws(null))[0]!.active).toBe(true)
  })
})

describe('crossFloorPeers', () => {
  const t = (id: string, floorId: string | null, name = id) => ({ id, kind: 'terminal', floorId, name, agent: 'shell', command: '', cwd: '/', pos: { x: 0, y: 0 }, size: { w: 10, h: 10 } })
  const base = (): Workspace => ({
    ...ws(null),
    nodes: { a: t('a', null, 'Maestro'), b: t('b', 'ui', 'Rev'), c: t('c', 'ui', 'Outro'), d: t('d', null, 'Vizinho'), n: node('n', null) } as never,
    connections: [
      { id: 'x1', a: 'a', b: 'b' }, // Ground <-> ui
      { id: 'x2', a: 'c', b: 'a' }, // ui <-> Ground (ordem invertida)
      { id: 'x3', a: 'a', b: 'd' }, // mesmo floor: não conta
      { id: 'x4', a: 'b', b: 'c' } // mesmo floor (ui): não conta
    ]
  })

  it('lista só as conexões com terminais de outro floor, com o rótulo do floor do outro lado', () => {
    const peers = crossFloorPeers(base(), 'a')
    expect(peers.map((p) => [p.connectionId, p.peerName, p.floorId, p.floorLabel])).toEqual([
      ['x1', 'Rev', 'ui', 'ui'],
      ['x2', 'Outro', 'ui', 'ui']
    ])
  })

  it('visto do outro lado, o rótulo é Ground', () => {
    const peers = crossFloorPeers(base(), 'b')
    expect(peers).toEqual([{ connectionId: 'x1', peerId: 'a', peerName: 'Maestro', floorId: null, floorLabel: 'Ground' }])
  })

  it('nó sem conexões entre floors, ou que não é terminal, não tem chips', () => {
    expect(crossFloorPeers(base(), 'd')).toEqual([])
    expect(crossFloorPeers(base(), 'n')).toEqual([])
    expect(crossFloorPeers(base(), 'inexistente')).toEqual([])
  })
})
