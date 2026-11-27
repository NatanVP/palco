// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FloorBar } from '../src/renderer/src/floors/FloorBar'
import { useDismissPopover } from '../src/renderer/src/canvas/useDismissPopover'
import type { Workspace } from '../src/shared/model'
const nativeAnimate = Element.prototype.animate
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true, writable: true }) })
afterAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: nativeAnimate, configurable: true, writable: true }) })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const ws = { id: 'w', name: 'W', floors: {}, nodes: {}, connections: [], activeFloor: null } as unknown as Workspace
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const pointer = async (el: Element) => { await act(async () => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true })); (el as HTMLElement).click() }) }
it('Ground: clique fora fecha e consome o gesto antes de criar elemento/limpar seleção', async () => {
 const canvas = vi.fn(), toggle = vi.fn()
 function App() { const [open, setOpen] = useState(true); return createElement('div', null, createElement('div', { 'data-canvas': '', className: 'canvas', onPointerDown: canvas, onClick: canvas }), createElement(FloorBar, { ws, open, active: null, height: 700, busy: false, onToggle: () => { toggle(); setOpen(v => !v) }, onPreview: vi.fn(), onChoose: vi.fn(), onCreate: vi.fn(), onLand: vi.fn(), onDelete: vi.fn() })) }
 await act(async () => root.render(createElement(App)))
 await pointer(host.querySelector('[data-canvas]')!); expect(toggle).toHaveBeenCalledTimes(1); expect(canvas).not.toHaveBeenCalled()
 expect(host.querySelector('[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
})
it.each(['usage', 'minimap'])('%s: interação interna preserva, botão alterna e Escape fecha sem vazar', async kind => {
 const outside = vi.fn(), key = vi.fn()
 function App() { const [open, setOpen] = useState(true); useDismissPopover(open, () => setOpen(false), `[data-${kind}],[data-toggle-${kind}]`); return createElement('div', { onKeyDown: key }, createElement('button', { [`data-toggle-${kind}`]: '', onClick: () => setOpen(v => !v) }, 'toggle'), open && createElement('div', { [`data-${kind}`]: '' }, 'panel'), createElement('div', { 'data-outside': '', className: 'canvas', onPointerDown: outside })) }
 await act(async () => root.render(createElement(App)))
 await pointer(host.querySelector(`[data-${kind}]`)!); expect(host.querySelector(`[data-${kind}]`)).toBeTruthy()
 await pointer(host.querySelector(`[data-toggle-${kind}]`)!); expect(host.querySelector(`[data-${kind}]`)).toBeNull()
 await pointer(host.querySelector(`[data-toggle-${kind}]`)!); expect(host.querySelector(`[data-${kind}]`)).toBeTruthy()
 await act(async () => host.querySelector(`[data-${kind}]`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
 expect(host.querySelector(`[data-${kind}]`)).toBeNull(); expect(key).not.toHaveBeenCalled()
 await pointer(host.querySelector(`[data-toggle-${kind}]`)!); await pointer(host.querySelector('[data-outside]')!); expect(outside).not.toHaveBeenCalled()
})
it('Ground: botão próprio alterna uma vez, e Escape fecha mesmo com foco em botão interno', async () => {
 function App() { const [open, setOpen] = useState(true); return createElement(FloorBar, { ws, open, active: null, height: 700, busy: false, onToggle: () => setOpen(v => !v), onPreview: vi.fn(), onChoose: vi.fn(), onCreate: vi.fn(), onLand: vi.fn(), onDelete: vi.fn() }) }
 await act(async () => root.render(createElement(App)))
 const button = host.querySelector('.floor-indicator-button')!
 await pointer(button); expect(button.getAttribute('aria-expanded')).toBe('false')
 await pointer(button); expect(button.getAttribute('aria-expanded')).toBe('true')
 await act(async () => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
 expect(button.getAttribute('aria-expanded')).toBe('false')
})
it('trocar de botão inferior fecha o anterior e preserva o clique do novo controle', async () => {
 const toggle = vi.fn()
 function App() { const [open, setOpen] = useState(true); useDismissPopover(open, () => setOpen(false), '[data-panel]'); return createElement('div', null, open && createElement('div', { 'data-panel': '' }), createElement('button', { 'data-toggle-minimap': '', onClick: toggle }, 'map')) }
 await act(async () => root.render(createElement(App)))
 await pointer(host.querySelector('button')!); expect(toggle).toHaveBeenCalledTimes(1); expect(host.querySelector('[data-panel]')).toBeNull()
})
