import { reachable, resolveTarget } from '../../src/main/domain/reachability'
import type { CanvasNode, Workspace } from '../../src/shared/model'
const node = (id: string, name: string, kind: 'terminal' | 'note' = 'terminal'): CanvasNode => kind === 'note'
  ? { id, name, kind, floorId: null, content: '', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } }
  : { id, name, kind, floorId: null, agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } }
function workspace(): Workspace {
  return {
    id: 'ws', name: 'test', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, floors: {}, activeFloor: null,
    nodes: { me: node('me', 'Me'), a: node('a', 'Agent'), b: node('b', 'AGENT'), far: node('far', 'Far'), n1: node('n1', 'One', 'note'), n2: node('n2', 'Two', 'note'), n3: node('n3', 'Three', 'note') },
    connections: [
      { id: '1', a: 'me', b: 'a' }, { id: '2', a: 'b', b: 'me' },
      { id: '3', a: 'me', b: 'n1' }, { id: '4', a: 'n2', b: 'n1' }, { id: '5', a: 'n2', b: 'n3' },
      { id: '6', a: 'a', b: 'far' }, { id: '7', a: 'n2', b: 'far' }
    ]
  }
}
it('reaches direct terminals and the entire note chain without traversing terminals or notes to other terminals', () => {
  expect(reachable(workspace(), 'me').map(n => n.id).sort()).toEqual(['a', 'b', 'n1', 'n2', 'n3'])
  expect(reachable(workspace(), 'missing')).toEqual([])
})
it('handles dangling edges and old cyclic note data without duplicate nodes or infinite traversal', () => {
  const ws = workspace()
  ws.connections.push({ id: '8', a: 'n3', b: 'n1' }, { id: '9', a: 'me', b: 'gone' })
  expect(reachable(ws, 'me').map(n => n.id).sort()).toEqual(['a', 'b', 'n1', 'n2', 'n3'])
})
it('returns the same generic 404 for missing and disconnected names', () => {
  const missing = resolveTarget(workspace(), 'me', 'Absent')
  expect(missing).toEqual({ ok: false, status: 404, error: 'alvo não encontrado' })
  expect(resolveTarget(workspace(), 'me', 'Far')).toEqual(missing)
})
it('ignores exact and duplicate names outside reach when selecting a reachable node', () => {
  const ws = workspace()
  ws.nodes.far!.name = 'Two'
  expect(resolveTarget(ws, 'me', 'Two')).toMatchObject({ ok: true, node: { id: 'n2' } })
  ws.nodes.far!.name = 'two'
  expect(resolveTarget(ws, 'me', 'two')).toMatchObject({ ok: true, node: { id: 'n2' } })
})
it('prefers an exact match and falls back to a unique case-insensitive name', () => {
  expect(resolveTarget(workspace(), 'me', 'Agent')).toMatchObject({ ok: true, node: { id: 'a' } })
  expect(resolveTarget(workspace(), 'me', 'two')).toMatchObject({ ok: true, node: { id: 'n2' } })
})
it('rejects ambiguous case-insensitive and duplicate exact names with 404', () => {
  expect(resolveTarget(workspace(), 'me', 'agent')).toEqual({ ok: false, status: 404, error: 'nome ambíguo' })
  const ws = workspace()
  ws.nodes.b!.name = 'Agent'
  expect(resolveTarget(ws, 'me', 'Agent')).toEqual({ ok: false, status: 404, error: 'nome ambíguo' })
})

it('alcança terminal de outro floor por conexão direta, mas não o que está ligado a ele lá', () => {
  const ws = workspace()
  ws.floors = { f: { id: 'f', name: 'ui', repoRoot: '/r', dir: '/r.floors/ui', branch: 'palco/ui', baseRef: 'main', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, createdAt: 0 } }
  ws.nodes.rev = { ...node('rev', 'Rev'), floorId: 'f' } as CanvasNode
  ws.nodes.deep = { ...node('deep', 'Deep'), floorId: 'f' } as CanvasNode
  ws.nodes.fn = { ...node('fn', 'FloorNote', 'note'), floorId: 'f' } as CanvasNode
  ws.connections.push({ id: 'x1', a: 'me', b: 'rev' }, { id: 'x2', a: 'rev', b: 'deep' }, { id: 'x3', a: 'rev', b: 'fn' })
  const names = reachable(ws, 'me').map(n => n.name)
  expect(names).toContain('Rev')
  expect(names).not.toContain('Deep')
  expect(names).not.toContain('FloorNote')
  expect(resolveTarget(ws, 'me', 'Rev')).toMatchObject({ ok: true })
  // e o recrutado alcança quem o chamou (ask back / resposta)
  expect(reachable(ws, 'rev').map(n => n.name)).toEqual(expect.arrayContaining(['Me', 'Deep', 'FloorNote']))
})
