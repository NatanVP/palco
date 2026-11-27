// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '../src/renderer/src/canvas/Canvas'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRope, stepRope, ropePath, closestEdgePins, closestEdgePin, wakeRope } from '../src/renderer/src/canvas/rope'
import { Connections } from '../src/renderer/src/canvas/Connections'
import type { CanvasNode } from '../src/shared/model'

const a = { x: 0, y: 0 }, b = { x: 400, y: 0 }
const frame = (x: number, y = 0) => ({ pos: { x, y }, size: { w: 200, h: 120 } })
it('semeia 21 pontos parabólicos, slack1.05 e mínimo40', () => {
  const rope = createRope(a, b)
  expect(rope.points).toHaveLength(21)
  expect(rope.restLength).toBe(420)
  expect(rope.points[10]?.y).toBe(48)
  expect(rope.points[0]).toMatchObject(a); expect(rope.points[20]).toMatchObject(b)
  const tiny = createRope(a, { x: 1, y: 0 })
  expect(tiny.restLength).toBe(40); expect(tiny.points[10]?.y).toBe(20)
})
it('prende literalmente no meio das bordas mais próximas', () => {
  expect(closestEdgePins(frame(0), frame(500))).toEqual({ a: { x: 200, y: 60 }, b: { x: 500, y: 60 } })
  expect(closestEdgePins(frame(0), frame(0, 300))).toEqual({ a: { x: 100, y: 120 }, b: { x: 100, y: 300 } })
  expect(closestEdgePin(frame(0), { x: 400, y: 60 })).toEqual({ x: 200, y: 60 })
})
it('passo fixo usa gravidade1600 e retenção.965; frames grandes limitam a quatro passos', () => {
  const rope = createRope(a, b)
  const p = rope.points[10]!, before = p.y
  p.oldY = before - 1
  stepRope(rope, a, b, 1 / 120, { iterations: 0 })
  expect(p.y).toBe(before)
  stepRope(rope, a, b, 1 / 120, { iterations: 0 })
  expect(p.y).toBeCloseTo(before + .965 + 1600 / 3600)
  const slow = createRope(a, b), fast = createRope(a, b)
  stepRope(slow, a, b, 10)
  for (let i = 0; i < 4; i++) stepRope(fast, a, b, 1 / 60)
  expect(slow.points).toEqual(fast.points)
})
it('assenta sem queda excessiva, pins exatos, cúbicas e sem reset ao arrastar', () => {
  const rope = createRope(a, b)
  for (let i = 0; i < 600; i++) stepRope(rope, a, b, 1 / 60)
  expect(rope.sleeping).toBe(true)
  expect(Math.max(...rope.points.map(p => p.y))).toBeLessThan(100)
  expect(rope.points[0]).toMatchObject(a); expect(rope.points[20]).toMatchObject(b)
  expect(ropePath(rope)).toMatch(/^M .* C /)
  const interior = { ...rope.points[10]! }
  stepRope(rope, a, { x: 900, y: 0 }, 0)
  expect(rope.points[10]).toEqual(interior)
  expect(rope.points[20]).toMatchObject({ x: 900, y: 0 }); expect(rope.sleeping).toBe(false)
})
it('repouso respeita janela mínima .5s e limite10s; wake reabre o loop', () => {
  const rope = createRope(a, b)
  for (let i = 0; i < 29; i++) stepRope(rope, a, b, 1 / 60, { gravity: 0, iterations: 0 })
  expect(rope.sleeping).toBe(false)
  for (let i = 0; i < 3; i++) stepRope(rope, a, b, 1 / 60, { gravity: 0, iterations: 0 })
  expect(rope.sleeping).toBe(true)
  wakeRope(rope); expect(rope.sleeping).toBe(false)
  for (let i = 0; i < 602; i++) stepRope(rope, a, b, 1 / 60, { iterations: 0 })
  expect(rope.sleeping).toBe(true)
})
it('renderiza dash8 6 neutro; provisória gravitacional tem accent2.4 e ponta3px em tela', () => {
  const node: CanvasNode = { id: 'a', kind: 'note', floorId: null, name: 'A', content: '', ...frame(0) }
  const other: CanvasNode = { ...node, id: 'b', ...frame(500) }
  const props = { nodes: { a: node, b: other }, frames: {}, connections: [{ id: 'c', a: 'a', b: 'b' }], selected: null, onSelect: () => {}, zoom: 2 }
  const html = renderToStaticMarkup(createElement(Connections, { ...props, linkFrom: 'a', cursor: { x: 400, y: 60 } }))
  expect(html).toContain('stroke-dasharray:8 6'); expect(html).toContain('stroke:var(--rope)')
  expect(html).toContain('stroke-width:2.4'); expect(html).toContain('r="1.5"')
  expect(html).toContain('data-rope-preview="true"')
  expect(html).toContain(' C ')
})

it('modo conectar captura clique no conteúdo, segue cursor; vazio e Esc cancelam sem pointerup', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), link = vi.fn()
  const a: CanvasNode = { id: 'a', kind: 'note', floorId: null, name: 'A', content: '', ...frame(0) }
  const b: CanvasNode = { ...a, id: 'b', ...frame(500) }
  const ws = { id: 'w', name: 'W', nodes: { a, b }, connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 } }
  try {
    await act(async () => root.render(createElement(Canvas, { ws, camera: ws.camera, onCamera: vi.fn(), tool: 'draw', linkFrom: 'a', onLink: link, selectedConn: null, onSelectConn: vi.fn(), selection: new Set<string>(), onToggleSelect: vi.fn(), onGoToFloor: vi.fn() })))
    expect(host.querySelector('.draw-layer')).toBeNull()
    const canvas = host.querySelector('.canvas')!
    await act(async () => canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 60 })))
    expect(host.querySelector('[data-rope-preview]')).not.toBeNull()
    await act(async () => host.querySelector('[data-node-id="b"] textarea')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })))
    expect(link).toHaveBeenLastCalledWith('b')
    await act(async () => canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })))
    expect(link).toHaveBeenLastCalledWith('a')
    link.mockClear()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(link).toHaveBeenCalledExactlyOnceWith('a')
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
