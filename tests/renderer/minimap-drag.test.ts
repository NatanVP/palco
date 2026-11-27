// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Minimap } from '../../src/renderer/src/canvas/Minimap'
it('draws and inverts coordinates with the same frozen transform during drag', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const box = document.createElement('div'); document.body.append(box); const root = createRoot(box)
  const node = { id: 'a', kind: 'note' as const, floorId: null, name: 'A', content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
  function Host() { const [camera, setCamera] = useState({ zoom: 1, offset: { x: 0, y: 0 } }); return createElement(Minimap, { nodes: [node], camera, view: { w: 800, h: 600 }, onCamera: setCamera }) }
  try {
    await act(async () => root.render(createElement(Host)))
    const svg = box.querySelector('svg')!; svg.setPointerCapture = () => {}
    const first = () => box.querySelector('rect')!.getAttribute('x')
    const original = first()
    await act(async () => svg.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 210, clientY: 140 })))
    expect(first()).toBe(original)
    await act(async () => svg.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })))
    expect(first()).not.toBe(original)
  } finally { await act(async () => root.unmount()); box.remove() }
})
