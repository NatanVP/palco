// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Connections, curve } from '../src/renderer/src/canvas/Connections'
import { closestEdgePin, closestEdgePins } from '../src/renderer/src/canvas/rope'
import { Canvas } from '../src/renderer/src/canvas/Canvas'
import type { CanvasNode } from '../src/shared/model'
const counter = vi.hoisted(() => ({ renders: 0 }))
vi.mock('../src/renderer/src/nodes/TerminalView', () => ({ TerminalView: () => { counter.renders++; return createElement('div', null, 'terminal falso') } }))
const node = (id: string, x: number): CanvasNode => ({ id, kind: 'note', name: id, content: '', floorId: null, pos: { x, y: 0 }, size: { w: 100, h: 100 } })
let frames = new Map<number, FrameRequestCallback>(), sequence = 0, timestamp = 0
beforeEach(() => {
  frames = new Map(); sequence = 0; timestamp = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++sequence, fn); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => vi.unstubAllGlobals())
async function advance(count: number) {
  await act(async () => {
    for (let i = 0; i < count; i++) {
      timestamp += 1000 / 60
      const pending = [...frames.values()]; frames.clear()
      pending.forEach(frame => frame(timestamp))
    }
  })
}
it("DOM mantém o interior simulado entre mudança de frame e próximo rAF", async () => {
  const host = document.createElement('div'), root = createRoot(host)
  const a = node('a', 0), b = node('b', 500)
  const props = { nodes: { a, b }, connections: [{ id: 'c', a: 'a', b: 'b' }], selected: null, onSelect: vi.fn() }
  try {
    await act(async () => root.render(createElement(Connections, { ...props, frames: {} })))
    await advance(80)
    const next = { pos: { x: 550, y: 30 }, size: b.size }
    const scheduled = frames.size
    await act(async () => root.render(createElement(Connections, { ...props, frames: { b: next } })))
    const pins = closestEdgePins(a, next)
    const path = host.querySelector('.rope')!.getAttribute('d')!
    expect(path.startsWith('M 100.00 50.00')).toBe(true)
    expect(path.endsWith('550.00 80.00')).toBe(true)
    expect(path).not.toBe(curve(pins.a, pins.b))
    expect(frames.size).toBe(scheduled || 1)
  } finally { await act(async () => root.unmount()) }
})
it("preview mantém gravidade durante movimento, sem frame de semente", async () => {
  const host = document.createElement('div'), root = createRoot(host), a = node('a', 0)
  const props = { nodes: { a }, connections: [], frames: {}, selected: null, onSelect: vi.fn(), linkFrom: 'a' }
  try {
    await act(async () => root.render(createElement(Connections, { ...props, cursor: { x: 500, y: 50 } })))
    await advance(80)
    const cursor = { x: 510, y: 70 }
    await act(async () => root.render(createElement(Connections, { ...props, cursor })))
    expect(host.querySelector('[data-rope-preview] path')!.getAttribute('d')).not.toBe(curve(closestEdgePin(a, cursor), cursor))
  } finally { await act(async () => root.unmount()) }
})
it("pointermove de conexão não renderiza novamente os cards do Canvas", async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const a = { ...node('a', 0), kind: 'terminal' as const, agent: 'shell' as const, cwd: '/', command: '' }
  const camera = { offset: { x: 0, y: 0 }, zoom: 1 }
  const ws = { id: 'w', name: 'W', nodes: { a }, connections: [], floors: {}, activeFloor: null, camera }
  try {
    await act(async () => root.render(createElement(Canvas, { ws, camera, onCamera: vi.fn(), linkFrom: 'a', onLink: vi.fn(), selectedConn: null, onSelectConn: vi.fn(), selection: new Set<string>(), onToggleSelect: vi.fn(), onGoToFloor: vi.fn() })))
    const before = counter.renders
    await act(async () => {
      for (let i = 0; i < 10; i++) host.querySelector('.canvas')!.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 + i, clientY: 70, bubbles: true }))
    })
    expect(counter.renders).toBe(before)
    expect(host.querySelector('[data-rope-preview]')).not.toBeNull()
  } finally { await act(async () => root.unmount()); host.remove() }
})
