// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { installHistoryKeys } from '../../src/renderer/src/canvas/history-keys'

afterEach(() => { document.body.innerHTML = '' })
it('Ctrl/Cmd+Z e Shift+Z só no canvas; deixa editores, terminal, portal e modais em paz', async () => {
  const root = document.createElement('div'); root.tabIndex = 0; document.body.append(root)
  const undo = vi.fn(async () => true), redo = vi.fn(async () => true), done = vi.fn(), error = vi.fn()
  const off = installHistoryKeys(root, 'w1', { undo, redo }, done, error)
  const key = (target: HTMLElement, shiftKey = false, altKey = false) => {
    target.focus(); const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey, altKey, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e
  }
  expect(key(root).defaultPrevented).toBe(true); expect(undo).toHaveBeenCalledWith('w1')
  await new Promise(resolve => setTimeout(resolve, 0)); expect(done).toHaveBeenCalledOnce()
  key(root, true); expect(redo).toHaveBeenCalledWith('w1')
  for (const html of ['<input>', '<textarea>', '<select></select>', '<div contenteditable="true" tabindex="0"></div>', '<div class="xterm"><button>T</button></div>', '<webview tabindex="0"></webview>', '<div role="dialog"><button>M</button></div>']) {
    root.innerHTML = html
    const target = root.querySelector<HTMLElement>('button') ?? root.firstElementChild as HTMLElement
    expect(key(target).defaultPrevented).toBe(false)
  }
  document.body.tabIndex = 0; key(document.body); key(root, false, true)
  expect(undo).toHaveBeenCalledOnce(); expect(redo).toHaveBeenCalledOnce()
  off(); key(root); expect(undo).toHaveBeenCalledOnce()
})
it('erro IPC é tratado e não limpa seleção; repetição não dispara undo', async () => {
  const root = document.createElement('div'); root.tabIndex = 0; document.body.append(root); root.focus()
  const error = vi.fn(), done = vi.fn(), undo = vi.fn(async () => { throw new Error('não') })
  const off = installHistoryKeys(root, 'w', { undo, redo: vi.fn() }, done, error)
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, repeat: true, bubbles: true })); expect(undo).not.toHaveBeenCalled()
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0))
  expect(error).toHaveBeenCalledOnce(); expect(done).not.toHaveBeenCalled(); off()
})
it('uma resposta da vista anterior não limpa a seleção da próxima vista', async () => {
  const root = document.createElement('div'); root.tabIndex = 0; document.body.append(root); root.focus()
  let resolve!: (changed: boolean) => void
  const done = vi.fn(), off = installHistoryKeys(root, 'old', { undo: () => new Promise<boolean>(r => { resolve = r }), redo: vi.fn() }, done, vi.fn())
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
  off(); resolve(true); await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
})
