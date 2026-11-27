// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { mountApp, type Harness } from '../helpers/app-harness'
let app: Harness | undefined
afterEach(async () => { vi.useRealTimers(); await app?.unmount(); app = undefined; vi.unstubAllGlobals() })
it('o aviso de histórico usa o toast e some após quatro segundos, renovando o prazo ao repetir', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  let notice: ((message: string) => void) | undefined
  const off = vi.fn()
  app = await mountApp({ api: { 'history.onNotice': ((cb: (message: string) => void) => { notice = cb; return off }) as never } })
  vi.useFakeTimers()
  const message = 'Nada para desfazer: um agente alterou o canvas.'
  await act(async () => notice?.(message))
  expect(app.host.querySelector('.flash[role=status]')?.textContent).toBe(message)
  expect(app.host.querySelector('.warning')).toBeNull()
  await act(async () => { vi.advanceTimersByTime(3900) })
  expect(app.host.querySelector('.flash')).toBeTruthy()
  await act(async () => notice?.(message))
  await act(async () => { vi.advanceTimersByTime(3900) })
  expect(app.host.querySelector('.flash')).toBeTruthy()
  await act(async () => { vi.advanceTimersByTime(100) })
  expect(app.host.querySelector('.flash')).toBeNull()
  await app.unmount(); app = undefined
  expect(off).toHaveBeenCalledOnce()
})
