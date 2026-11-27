import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Connections } from '../../src/renderer/src/canvas/Connections'
import type { CanvasNode } from '../../src/shared/model'
it('visibly highlights the selected rope rather than overriding the selected styling', () => {
  const a: CanvasNode = { id: 'a', kind: 'note', floorId: null, name: 'A', content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
  const b: CanvasNode = { ...a, id: 'b', pos: { x: 300, y: 0 } }
  const html = renderToStaticMarkup(createElement(Connections, { nodes: { a, b }, frames: {}, connections: [{ id: 'c', a: 'a', b: 'b' }], selected: 'c', onSelect: () => {} }))
  expect(html).toContain('stroke:var(--rope-selected)')
  expect(html).toContain('stroke-width:2.5')
})
