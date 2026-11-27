// @vitest-environment happy-dom
// a barra de tópicos do chat em pouca largura — bolinhas que não encolhem e as ações num menu "…".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatView } from '../src/renderer/src/chat/ChatView'

const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8').replace(/^@import.*$/gm, '')
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, style: HTMLStyleElement
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.assign(window, { palco: { chat: { state: async () => ({ terminalId: 't1', thread: 'blue', entries: [], hasOlder: false, status: 'idle', unreadCount: 0, workingSince: null, filledThreads: [] }), older: async () => [], onChange: () => () => {}, clearThread: vi.fn(), clearHistory: vi.fn() } } })
  style = document.createElement('style'); style.textContent = css; document.head.append(style)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ChatView terminalId="t1" name="Bia" />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); style.remove(); vi.unstubAllGlobals() })

const bar = () => host.querySelector<HTMLElement>('.chat-threads')!
const click = (el: Element) => act(async () => { (el as HTMLElement).click() })
const more = () => bar().querySelector<HTMLButtonElement>('button[aria-label="Ações do chat"]')!
const items = () => [...host.querySelectorAll('.chat-menu [role=menuitem]')] as HTMLElement[]

it('as bolinhas nunca encolhem e os links não quebram linha', () => {
  for (const dot of bar().querySelectorAll('.chat-dot')) { const s = getComputedStyle(dot); expect([s.flexShrink, s.width, s.height]).toEqual(['0', '12px', '12px']) }
  expect(bar().querySelectorAll('.chat-dot')).toHaveLength(7)
  for (const link of bar().querySelectorAll('.chat-link')) expect(getComputedStyle(link).whiteSpace).toBe('nowrap')
})

it('abaixo de 400 px os links dão lugar ao botão "…" (consulta pela largura da própria barra)', () => {
  expect(getComputedStyle(more().closest('.chat-more')!).display).toBe('none')
  expect(/\.chat-threads \{[^}]*container-type: inline-size/.test(css)).toBe(true)
  const narrow = /@container \(max-width: 400px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  expect(narrow).toMatch(/\.chat-threads > \.chat-link \{ display: none; \}/)
  expect(narrow).toMatch(/\.chat-more \{ display: block; \}/)
})

it('o menu tem as duas ações, cada uma pedindo a mesma confirmação; Esc e clique fora fecham', async () => {
  expect(items()).toHaveLength(0)
  await click(more())
  expect(items().map((i) => i.textContent)).toEqual(['Limpar Tópico…', 'Limpar Histórico do Chat…'])
  await click(items()[0]!)
  expect([items().length, host.querySelector('[role=alertdialog]')!.getAttribute('aria-label')]).toEqual([0, 'Limpar Tópico'])
  await click([...host.querySelectorAll('[role=alertdialog] button')].find((b) => b.textContent === 'Cancelar')!)
  await click(more()); await click(items()[1]!)
  expect(host.querySelector('[role=alertdialog]')!.getAttribute('aria-label')).toBe('Limpar Histórico do Chat')
  await click([...host.querySelectorAll('[role=alertdialog] button')].find((b) => b.textContent === 'Cancelar')!)
  await click(more()); await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  expect(items()).toHaveLength(0)
  await click(more()); await click(host.querySelector('.chat-menu-back')!)
  expect(items()).toHaveLength(0)
  // Fora do chat (no canvas) também.
  await click(more()); await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
  expect(items()).toHaveLength(0)
})
