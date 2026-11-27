interface AppLike {
  requestSingleInstanceLock(): boolean
  exit(code?: number): void
  on(event: 'second-instance', listener: () => void): unknown
}

interface WindowLike {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  isDestroyed(): boolean
}

/**
 * Uma única instância por usuário: duas instâncias regravariam o mesmo workspace.json uma por cima da outra.
 * Devolve false (e encerra) na segunda instância; na primeira, a segunda tentativa só traz a janela para a frente.
 */
export function setupSingleInstance(app: AppLike, getWindow: () => WindowLike | null): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
    return false
  }
  app.on('second-instance', () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  return true
}
