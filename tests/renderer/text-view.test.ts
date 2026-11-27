// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TextView } from '../../src/renderer/src/nodes/TextView'
it('prevents an oversized paste and surfaces a rejected save while retaining its draft across remount', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear()
  const patch = vi.fn(async () => { throw new Error('IPC failed') })
  Reflect.set(window, 'palco', { node: { patch } })
  const box = document.createElement('div'); document.body.append(box); let root = createRoot(box)
  try {
    await act(async () => root.render(createElement(TextView, { id: 'a', text: 'old', fontSize: 20 })))
    const input = box.querySelector('textarea')!
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'x'.repeat(100001) } })
    await act(async () => input.dispatchEvent(paste))
    expect(paste.defaultPrevented).toBe(true)
    expect(input.value).toBe('old')
    expect(box.querySelector('[role=alert]')!.textContent).toContain('limite')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'new')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(patch).toHaveBeenCalledWith('a', { text: 'new' })
    expect(box.querySelector('[role=alert]')!.textContent).toContain('rascunho preservado')
    await act(async () => root.unmount()); root = createRoot(box)
    await act(async () => root.render(createElement(TextView, { id: 'a', text: 'old', fontSize: 20 })))
    expect(box.querySelector('textarea')!.value).toBe('new')
  } finally { await act(async () => root.unmount()); box.remove(); localStorage.clear() }
})
