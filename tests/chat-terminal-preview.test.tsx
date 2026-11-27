// @vitest-environment happy-dom
// a prévia do chat é o próprio terminal (xterm em leitura, mesmas fonte, cores e colunas), não texto raspado.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const made = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; cols: number; rows: number; written: string[]; disposed: boolean; element?: HTMLElement; lines: string[]; cursor: number }>)
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>; cols: number; rows: number; written: string[] = []; disposed = false; element?: HTMLElement
    lines: string[] = []; cursor = 0
    constructor(options: Record<string, unknown>) { this.options = options; this.cols = (options.cols as number) ?? 80; this.rows = (options.rows as number) ?? 24; made.push(this) }
    get buffer() {
      const self = this
      return { active: { viewportY: 0, baseY: 0, get cursorY() { return self.cursor }, getLine: (i: number) => ({ translateToString: () => self.lines[i] ?? '' }) } }
    }
    open(el: HTMLElement) { this.element = el }
    write(data: string, done?: () => void) { this.written.push(data); done?.() }
    reset() { this.written = [] }
    resize(cols: number, rows: number) { this.cols = cols; this.rows = rows }
    dispose() { this.disposed = true }
  }
}))

import { ChatView } from '../src/renderer/src/chat/ChatView'
import { previewTop } from '../src/renderer/src/chat/TerminalMirror'
import { registerTerminal } from '../src/renderer/src/nodes/terminal-registry'
import { defaultPreferences } from '../src/shared/preferences'
import { resolveTerminalTheme, toXtermTheme } from '../src/shared/terminal-themes'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
let status: string, changed: (id: string) => void, data: (id: string, chunk: string, seq: number, gen: number) => void
let size: { cols: number; rows: number }, unregister: () => void
const terminal = { write: vi.fn(), resize: vi.fn(), restart: vi.fn(), setFocused: vi.fn(), attach: vi.fn(async () => ({ data: 'TELA', seq: 4, gen: 1, cols: 100, rows: 30 })), onData: vi.fn((cb) => { data = cb; return () => {} }), onExit: vi.fn(() => () => {}) }
const preview = vi.fn(async () => '▀▀▀▀')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  made.length = 0; status = 'working'; size = { cols: 100, rows: 30 }
  adoptPreferences({ ...defaultPreferences(), appearance: 'dark' })
  for (const f of [terminal.write, terminal.resize, terminal.attach, preview]) f.mockClear()
  Object.assign(window, { palco: { terminal, chat: { state: async () => ({ terminalId: 't1', thread: 'blue', entries: [], hasOlder: false, status, unreadCount: 0, workingSince: 1, filledThreads: [] }), older: async () => [], onChange: (cb: (id: string) => void) => { changed = cb; return () => {} }, preview, markRead: async () => {} } } })
  unregister = registerTerminal('t1', { selection: () => '', paste: () => {}, selectAll: () => {}, focus: () => {}, size: () => size })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); unregister(); vi.unstubAllGlobals() })

const look = { fontFamily: 'Fira Code', fontSize: 15, themeId: undefined, darkThemeId: undefined }
const mount = (showsShell = true) => act(async () => root.render(<ChatView terminalId="t1" name="Ana" showsShell={showsShell} shell={look} />))
const window_ = () => host.querySelector('.chat-preview')

describe('prévia do chat', () => {
  it('é um xterm só de leitura, com a fonte, as cores e as colunas do terminal, alimentado pelo mesmo fluxo', async () => {
    await mount()
    expect(made).toHaveLength(1)
    const mirror = made[0]!
    expect(mirror.options).toMatchObject({ fontFamily: 'Fira Code', fontSize: 15, disableStdin: true, cursorBlink: false, theme: toXtermTheme(resolveTerminalTheme(defaultPreferences(), false)) })
    expect([mirror.cols, mirror.rows]).toEqual([100, 30])
    expect(window_()!.contains(mirror.element!)).toBe(true)
    await act(async () => { data('t1', 'mais', 5, 1); data('outro', 'não', 6, 1) })
    expect(mirror.written).toEqual(['TELA', 'mais'])
    expect(preview).not.toHaveBeenCalled()
    expect(host.querySelector('pre.chat-preview')).toBeNull()
    // A prévia nunca manda nada ao processo nem muda o tamanho dele.
    expect([terminal.write.mock.calls.length, terminal.resize.mock.calls.length]).toEqual([0, 0])
  })

  it('acompanha o tamanho do terminal quando ele muda', async () => {
    await mount()
    size = { cols: 72, rows: 20 }
    await act(async () => data('t1', 'redesenho', 5, 1))
    expect([made[0]!.cols, made[0]!.rows]).toEqual([72, 20])
  })

  it('some quando o turno acaba ou quando a prévia está oculta, e o xterm é descartado', async () => {
    await mount()
    status = 'idle'
    await act(async () => changed('t1'))
    expect(window_()).toBeNull()
    expect(made[0]!.disposed).toBe(true)
    status = 'working'
    await act(async () => changed('t1'))
    expect(window_()).toBeTruthy()
    await mount(false)
    expect(window_()).toBeNull()
  })

  it.each<[string, string[], number, number]>([
    ['tela cheia mostra o pé', Array.from({ length: 30 }, (_, i) => `l${i}`), 29, 18],
    ['tela com pouco texto começa do alto', ['$ claude', 'pronto'], 2, 0],
    ['o cursor abaixo do último texto conta', ['a'], 20, 9],
    ['linhas vazias no fim não aparecem', [...Array.from({ length: 16 }, (_, i) => `l${i}`), '', ''], 0, 4]
  ])('janela de 12 linhas: %s', (_name, lines, cursor, top) => {
    expect(previewTop((i) => lines[i] ?? '', cursor, 30, 12)).toBe(top)
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
it('a moldura da prévia não desconta a borda da altura das linhas (a última não fica cortada)', () => {
  const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
  expect(/^\.chat-preview \{[^}]*box-sizing: content-box/m.test(css)).toBe(true)
})
