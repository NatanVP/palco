// @vitest-environment happy-dom
// o compositor do chat — uma pílula com campo de uma linha que cresce e botões redondos alinhados.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatView } from '../src/renderer/src/chat/ChatView'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, style: HTMLStyleElement
let height: number
const send = vi.fn(async () => ({ accepted: true as const, entryId: 'e' }))
const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight')
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // happy-dom não mede texto: a altura do conteúdo é a que o teste disser.
  height = 20
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => height + 16 })
  adoptPreferences(defaultPreferences()); send.mockClear()
  Object.assign(window, { palco: { chat: { state: async () => ({ terminalId: 't1', thread: 'blue', entries: [], hasOlder: false, status: 'idle', unreadCount: 0, workingSince: null, filledThreads: [] }), older: async () => [], onChange: () => () => {}, send }, files: { pick: async () => null } } })
  style = document.createElement('style'); style.textContent = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8').replace(/^@import.*$/gm, ''); document.head.append(style)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ChatView terminalId="t1" name="Ana" />))
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); style.remove(); vi.unstubAllGlobals()
  if (descriptor) Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', descriptor); else delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
})

const row = () => host.querySelector<HTMLElement>('.chat-input .chat-composer')!
const area = () => row().querySelector('textarea')!
const button = (label: string) => row().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
async function type(value: string, contentHeight = 20) {
  height = contentHeight
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area(), value); area().dispatchEvent(new Event('input', { bubbles: true })) })
}

it('numa só pílula: anexar, campo de uma linha, microfone e enviar com ícone', () => {
  expect([...row().children].map((el) => el.tagName)).toEqual(['BUTTON', 'TEXTAREA', 'BUTTON', 'BUTTON'])
  expect(Number(area().rows)).toBe(1)
  for (const label of ['Anexar arquivo', 'Enviar']) { expect(button(label).querySelector('svg'), label).toBeTruthy(); expect(button(label).textContent).toBe('') }
  expect(button('Enviar').disabled).toBe(true)
})

it('o campo cresce com o texto até o limite, passa a rolar e volta a uma linha depois do envio', async () => {
  await type('uma')
  expect([area().style.height, area().style.overflowY]).toEqual(['36px', 'hidden'])
  await type('a\nb\nc', 60)
  expect(area().style.height).toBe('76px')
  await type('muitas linhas', 900)
  expect([area().style.height, area().style.overflowY]).toEqual(['220px', 'auto'])
  height = 20
  await act(async () => button('Enviar').click())
  expect(send).toHaveBeenCalled()
  expect([area().value, area().style.height]).toEqual(['', '36px'])
})

it('o limite acompanha a fonte do chat', async () => {
  await act(async () => { adoptPreferences({ ...defaultPreferences(), chatFontSize: 26 }) })
  await type('muitas linhas', 900)
  expect(area().style.height).toBe('440px')
})

it('os botões são redondos, do mesmo tamanho e centrados na última linha do campo', () => {
  const [attach, send_] = ['Anexar arquivo', 'Enviar'].map((l) => getComputedStyle(button(l)))
  for (const s of [attach!, send_!]) expect([s.width, s.height, s.borderRadius, s.marginBottom]).toEqual(['28px', '28px', '50%', '4px'])
  const field = getComputedStyle(area())
  // 20 de linha + 8 em cima e embaixo = 36; (36 − 28) / 2 = 4.
  expect([field.minHeight, field.paddingTop, field.paddingBottom, field.lineHeight]).toEqual(['36px', '8px', '8px', '20px'])
  expect(getComputedStyle(row()).alignItems).toBe('flex-end')
})
