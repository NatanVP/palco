// @vitest-environment happy-dom
// o botão de chat da barra do terminal alterna entre o terminal e o chat.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { ContextualBar } from '../src/renderer/src/canvas/ContextualBar'
import type { TerminalNode, Workspace } from '../src/shared/model'

const animate = Element.prototype.animate
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true, writable: true }) })
afterAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true }) })

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
let unread: number, changed: (id: string) => void
const patch = vi.fn(async () => {}), state = vi.fn(async (id: string) => ({ terminalId: id, thread: 'blue', entries: [], hasOlder: false, status: 'idle', unreadCount: unread, workingSince: null, filledThreads: [] }))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  unread = 0; patch.mockClear(); state.mockClear()
  Object.assign(window, { palco: { node: { patch }, chat: { state, older: async () => [], onChange: (cb: (id: string) => void) => { changed = cb; return () => {} } } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

async function bar(over: Partial<TerminalNode> = {}) {
  const node: TerminalNode = { id: 't1', kind: 'terminal', name: 'Agente', agent: 'claude', command: 'claude', cwd: '/tmp', floorId: null, pos: { x: 0, y: 0 }, size: { w: 600, h: 300 }, ...over }
  const ws: Workspace = { id: 'w', name: 'W', nodes: { [node.id]: node }, connections: [], floors: {}, activeFloor: null, camera: { zoom: 1, offset: { x: 0, y: 0 } } }
  await act(async () => root.render(<ContextualBar ws={ws} selection={new Set([node.id])} linkFrom={null} onLink={vi.fn()} onEdit={vi.fn()} onCreateBand={vi.fn()} onFocus={vi.fn()} onCleared={vi.fn()} onError={vi.fn()} modeHint={null} />))
}
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)

it('no terminal de agente liga o chat, com o atalho na dica', async () => {
  await bar()
  const chat = button('Mostrar chat')!
  expect(chat.disabled).toBe(false)
  expect(chat.title).toMatch(/^Mostrar chat \(Ctrl\+Shift\+j\)$/i)
  expect(chat.getAttribute('aria-keyshortcuts')).toMatch(/^Control\+Shift\+j$/i)
  expect(chat.querySelector('.lucide-messages-square')).toBeTruthy()
  await act(async () => chat.click())
  expect(patch).toHaveBeenCalledWith('t1', { chatMode: true })
})

it('com o chat à frente vira "Mostrar terminal", com outro ícone, e volta ao terminal', async () => {
  await bar({ chatMode: true })
  const back = button('Mostrar terminal')!
  expect(button('Mostrar chat')).toBeNull()
  expect(back.title).toMatch(/^Mostrar terminal \(Ctrl\+Shift\+j\)$/i)
  expect(back.querySelector('.lucide-square-terminal')).toBeTruthy()
  await act(async () => back.click())
  expect(patch).toHaveBeenCalledWith('t1', { chatMode: false })
})

it('no terminal à frente mostra as respostas não lidas, e acompanha os avisos', async () => {
  unread = 3
  await bar()
  const chat = () => button('Mostrar chat')!
  expect(chat().querySelector('.chat-badge')?.textContent).toBe('3')
  expect(chat().getAttribute('aria-label')).toContain('3')
  unread = 0
  await act(async () => changed('t1'))
  expect(chat().querySelector('.chat-badge')).toBeNull()
})

it('com o chat à frente não há selo', async () => {
  unread = 2
  await bar({ chatMode: true })
  expect(host.querySelector('.chat-badge')).toBeNull()
})

it('no shell fica desabilitado e a dica explica por quê, mesmo com o modo de chat gravado', async () => {
  await bar({ agent: 'shell', command: '', chatMode: true })
  const chat = button('Mostrar chat')!
  expect(chat.disabled).toBe(true)
  expect(chat.title).toBe('O chat é só para terminais de agente; este é um shell.')
  expect(state).not.toHaveBeenCalled()
})

it('some quando o terminal está descarregado', async () => {
  await bar({ unloaded: true })
  expect(button('Mostrar chat')).toBeNull()
  expect(button('Reiniciar terminal')).toBeTruthy()
})
