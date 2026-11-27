import { describe, expect, it, vi } from 'vitest'
import { setupSingleInstance } from '../../src/main/single-instance'

function fakeApp(lock: boolean) {
  const handlers = new Map<string, () => void>()
  return {
    requestSingleInstanceLock: vi.fn(() => lock),
    exit: vi.fn(),
    on: vi.fn((event: string, fn: () => void) => void handlers.set(event, fn)),
    handlers
  }
}
const fakeWindow = () => ({ isMinimized: vi.fn(() => true), restore: vi.fn(), show: vi.fn(), focus: vi.fn(), isDestroyed: () => false })

describe('setupSingleInstance', () => {
  it('sem a trava (segunda instância): sai e não registra nada', () => {
    const app = fakeApp(false)
    expect(setupSingleInstance(app, () => null)).toBe(false)
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(app.on).not.toHaveBeenCalled()
  })

  it('com a trava: registra second-instance, que restaura e foca a janela', () => {
    const app = fakeApp(true)
    const win = fakeWindow()
    expect(setupSingleInstance(app, () => win)).toBe(true)
    expect(app.exit).not.toHaveBeenCalled()
    app.handlers.get('second-instance')!()
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('second-instance sem janela (ainda subindo) não lança', () => {
    const app = fakeApp(true)
    setupSingleInstance(app, () => null)
    expect(() => app.handlers.get('second-instance')!()).not.toThrow()
  })
})
