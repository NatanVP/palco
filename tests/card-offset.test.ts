// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '../src/renderer/src/canvas/Canvas'
import { snap, screenToWorld, worldToScreen } from '../src/renderer/src/canvas/camera'
import { savedCamera } from '../src/renderer/src/focus'
import type { Workspace } from '../src/shared/model'
const workspace = (): Workspace => ({ id: 'w', name: 'W', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, activeFloor: null, floors: {
  f: { id: 'f', name: 'F', repoRoot: '/r', dir: '/r/f', branch: 'f', baseRef: 'main', createdAt: 1, camera: { offset: { x: 10, y: -40 }, zoom: 2 } }
}, nodes: { n: { id: 'n', kind: 'note', name: 'Nota', content: '', floorId: null, pos: { x: 100, y: 100 }, size: { w: 260, h: 120 } } }, connections: [] })
const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} }))
afterAll(() => { if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture); else delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())
const props = (ws: Workspace) => ({ ws, camera: savedCamera(ws), onCamera: vi.fn(), linkFrom: null, onLink: vi.fn(), selectedConn: null, onSelectConn: vi.fn(), selection: new Set<string>(), onToggleSelect: vi.fn(), onGoToFloor: vi.fn() })
const point = (target: Element, type: string, y: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 120, clientY: y }))
it.each([1, 2])('reproduz 40px: último move e up no mesmo lote persistem o drop, sem voltar ao frame anterior (zoom %s)', async zoom => {
  const ws = workspace(); ws.camera.zoom = zoom
  let resolve!: () => void
  const commit = vi.fn(() => new Promise<void>(done => { resolve = done }))
  Object.assign(window, { palco: { history: { commit } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Canvas, props(ws))))
    const canvas = host.querySelector('.canvas')!, header = host.querySelector('.node-header')!
    await act(async () => { point(header, 'pointerdown', 150); point(canvas, 'pointermove', 150 + 40 * zoom); point(canvas, 'pointerup', 150 + 40 * zoom) })
    expect(commit).toHaveBeenCalledWith('w', [{ type: 'node.patch', id: 'n', patch: { pos: { x: 100, y: 140 } } }])
    expect((host.querySelector('[data-node-id="n"]') as HTMLElement).style.top).toBe('140px')
    await act(async () => resolve())
    expect((host.querySelector('[data-node-id="n"]') as HTMLElement).style.top).toBe('140px')
    const restored = structuredClone(ws); restored.nodes.n!.pos.y = 140
    await act(async () => root.render(createElement(Canvas, props(restored))))
    expect((host.querySelector('[data-node-id="n"]') as HTMLElement).style.top).toBe('140px')
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('trocar de andar durante arrasto não grava nem conserva o frame transitório 40px acima', async () => {
  const ws = workspace(), commit = vi.fn(async () => {})
  Object.assign(window, { palco: { history: { commit } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Canvas, props(ws))))
    await act(async () => { point(host.querySelector('.node-header')!, 'pointerdown', 150); point(host.querySelector('.canvas')!, 'pointermove', 110) })
    expect((host.querySelector('[data-node-id="n"]') as HTMLElement).style.top).toBe('60px')
    await act(async () => root.render(createElement(Canvas, props({ ...ws, activeFloor: 'f' }))))
    await act(async () => point(host.querySelector('.canvas')!, 'pointerup', 110))
    expect(commit).not.toHaveBeenCalled()
    await act(async () => root.render(createElement(Canvas, props(ws))))
    expect((host.querySelector('[data-node-id="n"]') as HTMLElement).style.top).toBe('100px')
  } finally { await act(async () => root.unmount()); host.remove() }
})
it.each(['blur', 'Escape', 'pointercancel'])('cancelar com %s descarta o preview sem persistir', async reason => {
  const ws = workspace(), commit = vi.fn(async () => {})
  Object.assign(window, { palco: { history: { commit } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Canvas, props(ws))))
    const canvas = host.querySelector('.canvas')!
    await act(async () => { point(host.querySelector('.node-header')!, 'pointerdown', 115); point(canvas, 'pointermove', 155) })
    expect((host.querySelector('[data-node-id="n"]') as HTMLElement).style.top).toBe('140px')
    await act(async () => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'))
      else if (reason === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      else point(canvas, 'pointercancel', 155)
      point(canvas, 'pointerup', 155)
    })
    expect(commit).not.toHaveBeenCalled()
    expect((host.querySelector('[data-node-id="n"]') as HTMLElement).style.top).toBe('100px')
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('snap de 20 não explica 40px; origem da viewport e câmera do andar são transformações distintas', () => {
  for (let y = -100; y <= 100; y++) expect(Math.abs(snap(y) - y)).toBeLessThanOrEqual(10)
  const ws = workspace(); ws.activeFloor = 'f'
  const camera = savedCamera(ws), world = { x: 100, y: 100 }, relative = worldToScreen(world, camera)
  for (const top of [0, 40, 56]) {
    const client = { x: relative.x, y: relative.y + top }
    expect(screenToWorld({ x: client.x, y: client.y - top }, camera)).toEqual(world)
  }
  expect(savedCamera(structuredClone(ws))).toEqual(camera)
})

it('clique sem arrasto no cabeçalho (selecionar) ou na alça não grava nem encaixa um card fora da grade', async () => {
  const ws = workspace(); ws.nodes.n!.pos = { x: 105, y: 113 }; ws.nodes.n!.size = { w: 263, h: 127 }
  const commit = vi.fn(async () => {})
  Object.assign(window, { palco: { history: { commit } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Canvas, props(ws))))
    const canvas = host.querySelector('.canvas')!
    await act(async () => { point(host.querySelector('.node-header')!, 'pointerdown', 150); point(canvas, 'pointerup', 150) })
    await act(async () => { point(host.querySelector('.resize-handle')!, 'pointerdown', 150); point(canvas, 'pointerup', 150) })
    expect(commit).not.toHaveBeenCalled()
    const el = host.querySelector('[data-node-id="n"]') as HTMLElement
    expect([el.style.left, el.style.top, el.style.width, el.style.height]).toEqual(['105px', '113px', '263px', '127px'])
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('expira o drop quando outro escritor substitui a posição antes da confirmação', async () => {
  vi.useFakeTimers()
  const ws = workspace(), commit = vi.fn(async () => {})
  Object.assign(window, { palco: { history: { commit } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Canvas, props(ws))))
    await act(async () => { point(host.querySelector('.node-header')!, 'pointerdown', 115); point(host.querySelector('.canvas')!, 'pointerup', 155) })
    const external = structuredClone(ws); external.nodes.n!.pos.y = 220
    await act(async () => root.render(createElement(Canvas, props(external))))
    await act(async () => vi.advanceTimersByTime(2100))
    expect((host.querySelector('[data-node-id="n"]') as HTMLElement).style.top).toBe('220px')
    expect(vi.getTimerCount()).toBe(0)
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() }
})

it('um gesto sobre fichário move todas as notas em um único commit, só ao soltar', async () => {
  const ws = workspace(); const n = ws.nodes.n!
  if (n.kind !== 'note') throw new Error('fixture')
  n.stackId = 'stack'; ws.nodes.n2 = { ...n, id: 'n2', name: 'Segunda' }
  const commit = vi.fn(async () => [])
  Object.assign(window, { palco: { history: { commit } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Canvas, props(ws))))
    const canvas = host.querySelector('.canvas')!
    await act(async () => { point(host.querySelector('.node-header')!, 'pointerdown', 150); point(canvas, 'pointermove', 190) })
    expect(commit).not.toHaveBeenCalled()
    await act(async () => point(canvas, 'pointerup', 190))
    expect(commit).toHaveBeenCalledExactlyOnceWith('w', [
      { type: 'node.patch', id: 'n', patch: { pos: { x: 100, y: 140 } } },
      { type: 'node.patch', id: 'n2', patch: { pos: { x: 100, y: 140 } } }
    ])
  } finally { await act(async () => root.unmount()); host.remove() }
})
