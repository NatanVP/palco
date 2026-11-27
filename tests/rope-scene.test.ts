import { RopeScene, PREVIEW_ROPE_ID } from '../src/renderer/src/canvas/rope-scene'
import { closestEdgePins, createRope, ropePath } from '../src/renderer/src/canvas/rope'
import type { CanvasNode } from '../src/shared/model'
const node = (id: string, x: number, y = 0): CanvasNode => ({ id, kind: 'note', name: id, content: '', floorId: null, pos: { x, y }, size: { w: 100, h: 100 } })
const nodes = () => ({ a: node('a', 0), b: node('b', 500), c: node('c', 2000), d: node('d', 2500), obstacle: node('obstacle', 10000, 10000) })
const links = [{ id: 'near', a: 'a', b: 'b' }, { id: 'far', a: 'c', b: 'd' }]
it("mudança de pins preserva interior da simulação, sem voltar à parábola antes do rAF", () => {
  const scene = new RopeScene(), all = nodes()
  scene.synchronize(all, links, {})
  for (let i = 0; i < 600; i++) scene.advance(1 / 60)
  const rope = scene.entries.get('near')!.rope, interior = { ...rope.points[10]! }
  const frames = { b: { pos: { x: 550, y: 30 }, size: all.b.size } }
  scene.synchronize(all, links, frames)
  expect(rope.points[10]).toEqual(interior)
  expect(rope.points[20]).toMatchObject({ x: 550, y: 80 })
  const pins = closestEdgePins(all.a, frames.b)
  expect(scene.path('near')).not.toBe(ropePath(createRope(pins.a, pins.b)))
  scene.setPreview('a', all.a, { x: 450, y: 50 })
  for (let i = 0; i < 200; i++) scene.advance(1 / 60)
  const preview = scene.entries.get(PREVIEW_ROPE_ID)!.rope, before = { ...preview.points[10]! }
  scene.setPreview('a', all.a, { x: 460, y: 70 })
  expect(preview.points[10]).toEqual(before)
  expect(preview.points[20]).toMatchObject({ x: 460, y: 70 })
})
it("sem serialização de obstáculos; mover card distante não acorda todas as cordas", () => {
  const scene = new RopeScene(), all = nodes()
  scene.synchronize(all, links, {})
  for (let i = 0; i < 600; i++) scene.advance(1 / 60)
  expect([...scene.entries.values()].every(e => e.rope.sleeping)).toBe(true)
  const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('JSON no caminho quente') })
  try {
    scene.synchronize(all, links, { obstacle: { pos: { x: 10000, y: 10100 }, size: all.obstacle.size } })
    expect([...scene.entries.values()].every(e => e.rope.sleeping)).toBe(true)
    scene.synchronize(all, links, { obstacle: { pos: { x: 250, y: 60 }, size: all.obstacle.size } })
    expect(scene.entries.get('near')!.rope.sleeping).toBe(false)
    expect(scene.entries.get('far')!.rope.sleeping).toBe(true)
    expect(stringify).not.toHaveBeenCalled()
  } finally { stringify.mockRestore() }
})
it('remoção de obstáculo próximo acorda só a corda afetada; mudança de pin acorda sua corda', () => {
  const scene = new RopeScene(), all = nodes()
  all.obstacle = node('obstacle', 250, 60)
  scene.synchronize(all, links, {})
  for (let i = 0; i < 610; i++) scene.advance(1 / 60)
  const { obstacle: _gone, ...remaining } = all
  scene.synchronize(remaining, links, {})
  expect(scene.entries.get('near')!.rope.sleeping).toBe(false)
  expect(scene.entries.get('far')!.rope.sleeping).toBe(true)
  scene.synchronize(remaining, links, { d: { pos: { x: 2600, y: 0 }, size: all.d.size } })
  expect(scene.entries.get('far')!.rope.sleeping).toBe(false)
})
