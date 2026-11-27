// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { mountApp, type Harness } from '../helpers/app-harness'

let app: Harness | undefined
afterEach(async () => { await app?.unmount(); app = undefined; vi.unstubAllGlobals() })

it('mostra a tela de encerramento, bloqueia atalhos e confirma após dois frames', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  let begin: (() => void) | undefined
  const painted = vi.fn()
  app = await mountApp({ api: {
    'shutdown.onBegin': ((callback: () => void) => { begin = callback; return () => {} }) as never,
    'shutdown.painted': painted as never
  } })
  expect(app.host.querySelector('.shutdown-overlay')).toBeNull()

  await act(async () => begin?.())
  const status = app.host.querySelector('.shutdown-overlay[role="status"]')
  expect(status?.getAttribute('aria-live')).toBe('polite')
  expect(status?.textContent).toContain('Encerrando processos…')
  expect(document.activeElement).toBe(status)
  const key = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
  window.dispatchEvent(key)
  expect(key.defaultPrevented).toBe(true)

  await act(async () => frames.shift()?.(0))
  expect(painted).not.toHaveBeenCalled()
  await act(async () => frames.shift()?.(0))
  expect(painted).toHaveBeenCalledOnce()
})
