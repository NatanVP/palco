// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useDismissPopover } from '../src/renderer/src/canvas/useDismissPopover'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, close: ReturnType<typeof vi.fn<() => void>>
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); close = vi.fn<() => void>(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
const mount = async () => {
  function App() { const [open, setOpen] = useState(true); useDismissPopover(open, () => { close(); setOpen(false) }, '.minimap'); return open ? createElement('div', { className: 'minimap' }, createElement('button', null, 'dentro')) : null }
  await act(async () => root.render(createElement(App)))
}
const add = (html: string): HTMLElement => { const box = document.createElement('div'); box.innerHTML = html; document.body.append(box); return box.querySelector('[data-t]')! }
const gesture = async (el: Element, button = 0) => {
  const seen: string[] = []
  for (const type of ['pointerdown', 'mousedown', 'contextmenu', 'pointerup', 'mouseup', 'click']) el.addEventListener(type, () => seen.push(type))
  await act(async () => { for (const type of ['pointerdown', 'mousedown', ...(button === 2 ? ['contextmenu'] : []), 'pointerup', 'mouseup', ...(button === 0 ? ['click'] : [])]) el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button })) })
  return seen
}

it.each([
  ['Configurações', '<div class="settings-back"><div role="dialog"><button data-t>Dados</button></div></div>'],
  ['um diálogo', '<div class="modal-back"><form class="modal"><input data-t></form></div>'],
  ['um diálogo dentro do canvas', '<div class="canvas"><div role="dialog"><button data-t>x</button></div></div>'],
  ['a barra superior', '<div class="topbar"><button data-t>x</button></div>']
])("clique que cai sobre %s fecha o popover e não é engolido", async (_name, html) => {
  await mount(); const target = add(html)
  expect(await gesture(target)).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']); expect(close).toHaveBeenCalledOnce()
})
it.each(['<div class="canvas"><div data-t class="node"></div></div>', '<div class="floor-stage"><div data-t class="floor-overview-dismiss"></div></div>'])('sobre o canvas o gesto continua consumido: %s', async (html) => {
  await mount(); expect(await gesture(add(html))).toEqual([]); expect(close).toHaveBeenCalledOnce()
})
it("botão direito no canvas fecha sem abrir o menu do canvas", async () => {
  await mount(); expect(await gesture(add('<div class="canvas"><div data-t></div></div>'), 2)).toEqual([]); expect(close).toHaveBeenCalledOnce()
})
const press = async (el: Element, key = 'Escape') => { const reached = vi.fn(); el.addEventListener('keydown', reached); await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) }); return reached.mock.calls.length > 0 }
it("o Escape de um terminal focado chega ao terminal e não fecha o popover", async () => {
  await mount(); expect(await press(add('<div class="xterm"><textarea data-t></textarea></div>'))).toBe(true); expect(close).not.toHaveBeenCalled()
})
it('o Escape de um diálogo aberto por cima é do diálogo', async () => {
  await mount(); expect(await press(add('<div role="dialog"><button data-t></button></div>'))).toBe(true); expect(close).not.toHaveBeenCalled()
})
it('o Escape com um modal sem aria-modal aberto não fecha o popover por trás', async () => {
  await mount(); await press(add('<div class="modal-back"><form class="modal"><button data-t></button></form></div>')); await press(document.body); expect(close).not.toHaveBeenCalled()
})
it("vale o atalho \"cancelar\" remapeado", async () => {
  adoptPreferences({ ...defaultPreferences(), shortcuts: { ...defaultPreferences().shortcuts, cancel: [{ key: 'q' }] } })
  await mount(); await press(document.body); expect(close).not.toHaveBeenCalled(); await press(document.body, 'q'); expect(close).toHaveBeenCalledOnce()
})
