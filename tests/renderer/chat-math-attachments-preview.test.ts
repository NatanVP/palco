// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatView } from '../../src/renderer/src/chat/ChatView'
import { Markdown } from '../../src/renderer/src/chat/Markdown'
import { chatToggle } from '../../src/renderer/src/chat/TerminalFace'
import { normalizeMath, safeHref } from '../../src/renderer/src/chat/math'
import { adoptPreferences } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'
import { parseNodePatch } from '../../src/main/validate'
import type { ChatState } from '../../src/shared/chat'
import type { TerminalNode } from '../../src/shared/model'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); adoptPreferences(defaultPreferences()) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

it('normalizeMath troca \\(..\\) e \\[..\\] por cifrões, sem tocar em código', () => {
  expect(normalizeMath('a \\(x^2\\) b')).toBe('a $x^2$ b')
  expect(normalizeMath('\\[E=mc^2\\]')).toContain('$$\nE=mc^2\n$$')
  expect(normalizeMath('`\\(x\\)` e ```\n\\[y\\]\n```')).toBe('`\\(x\\)` e ```\n\\[y\\]\n```')
})
it('safeHref só aceita http e https', () => {
  expect(safeHref('https://example.com/a')).toBe('https://example.com/a'); expect(safeHref('javascript:alert(1)')).toBeNull(); expect(safeHref('file:///etc/passwd')).toBeNull(); expect(safeHref('data:text/html,x')).toBeNull(); expect(safeHref(undefined)).toBeNull()
})

it('Markdown: tabela GFM, código com Copiar, TeX (KaTeX) e diagrama Mermaid', async () => {
  await act(async () => root.render(createElement(Markdown, { source: '| a | b |\n|---|---|\n| 1 | 2 |\n\n```python\nprint(1)\n```\n\nSoma $$17+25=42$$ e \\(x\\).\n\n```mermaid\ngraph TD; A-->B\n```' })))
  await flush()
  expect(host.querySelector('table td')?.textContent).toBe('1')
  expect(host.querySelector('.chat-code-bar span')?.textContent).toBe('python'); expect(host.textContent).toContain('Copiar Código')
  expect(host.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2)
  expect(host.querySelector('[aria-label="Diagrama"], pre[data-error]')).toBeTruthy()
})
it('Markdown nunca renderiza HTML cru, script, imagem remota nem link perigoso', async () => {
  await act(async () => root.render(createElement(Markdown, { source: '<script>window.x=1</script><img src=x onerror=alert(1)><b>negrito</b>\n\n[mau](javascript:alert(1)) [bom](https://example.com)\n\n![logo](https://evil.test/p.png)' })))
  await flush()
  expect(host.querySelector('script')).toBeNull(); expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('b')).toBeNull()
  expect(host.querySelector('a[href^="javascript"]')).toBeNull(); expect(host.querySelector('a[href="https://example.com/"]')).toBeTruthy()
  expect(host.textContent).toContain('[imagem: logo]')
})

const state = (over: Partial<ChatState> = {}): ChatState => ({ terminalId: 't1', thread: 'blue', entries: [], hasOlder: false, status: 'idle', unreadCount: 0, workingSince: null, filledThreads: [], ...over })
const stubApi = (s: ChatState) => {
  const chat = { state: vi.fn(async () => s), older: vi.fn(async () => []), send: vi.fn(async () => ({ accepted: true as const, entryId: 'e' })), interrupt: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), markRead: vi.fn(async () => {}),
    switchThread: vi.fn(async () => {}), clearThread: vi.fn(async () => {}), clearHistory: vi.fn(async () => {}), deleteEntry: vi.fn(async () => {}), attachment: vi.fn(async () => null), preview: vi.fn(async () => 'saída ao vivo'), onChange: vi.fn(() => () => {}) }
  const terminal = { attach: vi.fn(async () => ({ data: '', seq: 0, gen: 1, cols: 80, rows: 24 })), onData: vi.fn(() => () => {}) }
  Object.assign(window, { palco: { chat, terminal, files: { pick: vi.fn(async () => '/tmp/a.txt') }, shell: { openExternal: vi.fn(async () => {}) } } })
  return chat
}
const mount = async (s: ChatState) => { const chat = stubApi(s); await act(async () => root.render(createElement(ChatView, { terminalId: 't1', name: 'Agente' }))); await flush(); return chat }
const click = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); await flush() }

it('mostra a conversa: mensagem do usuário, resposta em markdown e a pergunta com opções', async () => {
  await mount(state({ entries: [
    { id: 'A', ts: 1, role: 'user', kind: 'message', text: 'oi' }, { id: 'B', ts: 2, role: 'agent', kind: 'message', text: '**feito**' },
    { id: 'C', ts: 3, role: 'agent', kind: 'question', text: 'Qual?', question: { prompt: 'Qual?', options: [{ label: 'A', recommended: true }, { label: 'B', detail: 'lento' }] } }] }))
  expect(host.querySelector('.chat-bubble.user')?.textContent).toContain('oi'); expect(host.querySelector('.chat-bubble.agent strong')?.textContent).toBe('feito')
  expect(host.textContent).toContain('A · Recomendado'); expect(host.textContent).toContain('lento')
})
it('estado vazio e as três situações do turno', async () => {
  await mount(state()); expect(host.textContent).toContain('Ainda não há mensagens')
  await act(async () => root.unmount()); root = createRoot(host)
  const c = await mount(state({ status: 'working' })); expect(host.textContent).toContain('Agente está trabalhando…')
  await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Interromper') ?? null); expect(c.interrupt).toHaveBeenCalledWith('t1')
})
it('Nenhuma resposta recebida e Interrompido reconhecem com OK', async () => {
  const c = await mount(state({ status: 'needsAttention' })); expect(host.textContent).toContain('Nenhuma resposta recebida')
  await click([...host.querySelectorAll('.chat-status button')].find(b => b.textContent === 'OK') ?? null); expect(c.acknowledge).toHaveBeenCalledWith('t1')
})
it('enviar: Enter manda, Shift+Enter não; o rascunho fica se a entrega falha', async () => {
  const c = await mount(state())
  const area = host.querySelector<HTMLTextAreaElement>('textarea')!
  const type = async (v: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, v); area.dispatchEvent(new Event('input', { bubbles: true })) })
  await type('faça X')
  await act(async () => { area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })) }); expect(c.send).not.toHaveBeenCalled()
  await act(async () => { area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }); await flush()
  expect(c.send).toHaveBeenCalledWith('t1', { text: 'faça X', attachments: [] }); expect(area.value).toBe('')
  c.send.mockResolvedValueOnce({ accepted: false, cause: 'failed' } as never); await type('de novo')
  await click(host.querySelector('[aria-label="Enviar"]')); expect(host.querySelector('[role="alert"]')?.textContent).toContain('rascunho continua aqui'); expect(area.value).toBe('de novo')
})
it('anexar: o caminho escolhido vai junto e pode ser removido', async () => {
  const c = await mount(state())
  await click(host.querySelector('[aria-label="Anexar arquivo"]')); expect(host.querySelector('.chat-files')?.textContent).toContain('a.txt')
  await click(host.querySelector('[aria-label="Enviar"]')); expect(c.send).toHaveBeenCalledWith('t1', { text: '', attachments: ['/tmp/a.txt'] })
})
it('sete tópicos por cor; trocar chama o main; limpar pede confirmação', async () => {
  const c = await mount(state({ filledThreads: ['pink'] }))
  expect(host.querySelectorAll('[aria-label^="Tópico "]')).toHaveLength(7); expect(host.querySelector('[aria-label="Tópico Azul"]')?.getAttribute('aria-pressed')).toBe('true')
  await click(host.querySelector('[aria-label="Tópico Rosa"]')); expect(c.switchThread).toHaveBeenCalledWith('t1', 'pink')
  await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Limpar Tópico…') ?? null)
  expect(host.querySelector('[aria-label="Limpar Tópico"]')).toBeTruthy(); expect(c.clearThread).not.toHaveBeenCalled()
  await click([...host.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent === 'Limpar') ?? null); expect(c.clearThread).toHaveBeenCalledWith('t1', 'blue')
})
it('mensagem: citar põe no campo; excluir chama o main; respostas não lidas são marcadas como lidas', async () => {
  const c = await mount(state({ unreadCount: 1, entries: [{ id: 'B', ts: 2, role: 'agent', kind: 'message', text: 'linha' }] }))
  expect(c.markRead).toHaveBeenCalledWith('t1')
  await click(host.querySelector('[aria-label="Citar"]')); expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('> linha\n\n')
  await click(host.querySelector('[aria-label="Excluir Mensagem"]')); expect(c.deleteEntry).toHaveBeenCalledWith('t1', 'blue', 'B')
})
it('clicar numa opção cita a pergunta e a escolha no campo, sem enviar', async () => {
  const c = await mount(state({ entries: [{ id: 'C', ts: 3, role: 'agent', kind: 'question', text: 'Qual?', question: { prompt: 'Qual?', options: [{ label: 'A' }, { label: 'B' }] } }] }))
  await click([...host.querySelectorAll('.chat-options button')][1] ?? null)
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('> Qual?\n> B\n\n'); expect(c.send).not.toHaveBeenCalled()
})
it('fonte e tamanho do chat vêm das preferências (vazio = fonte do sistema)', async () => {
  adoptPreferences({ ...defaultPreferences(), chatFontFamily: 'Georgia', chatFontSize: 17 }); await mount(state())
  expect(host.querySelector<HTMLElement>('.chat-face')!.style.fontFamily).toContain('Georgia'); expect(host.querySelector<HTMLElement>('.chat-face')!.style.fontSize).toBe('17px')
})

const term = (over: Partial<TerminalNode> = {}): TerminalNode => ({ id: 't1', kind: 'terminal', floorId: null, name: 'A', agent: 'claude', command: 'claude', cwd: '/', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 }, ...over })
it('o botão alterna as faces: só agente tem chat, e o patch é chatMode', () => {
  const patch = vi.fn(async () => {}); Object.assign(window, { palco: { node: { patch } } })
  expect(chatToggle(term({ agent: 'shell' })).visible).toBe(false)
  const t = chatToggle(term()); expect(t).toMatchObject({ visible: true, chat: false, label: 'Mostrar chat' }); t.run(); expect(patch).toHaveBeenCalledWith('t1', { chatMode: true })
  expect(chatToggle(term({ chatMode: true })).label).toBe('Mostrar terminal')
})
it('o main valida chatMode e chatShowsShell: booleano, só terminal', () => {
  expect(parseNodePatch({ chatMode: true, chatShowsShell: false }, 'terminal')).toEqual({ chatMode: true, chatShowsShell: false })
  expect(() => parseNodePatch({ chatMode: 'sim' }, 'terminal')).toThrow(); expect(() => parseNodePatch({ chatMode: true }, 'note')).toThrow()
})

it('prévia ao vivo do terminal só durante o turno e só se ligada; o botão liga e desliga por terminal', async () => {
  const c = await mount(state({ status: 'working' })); await flush()
  // A prévia é o próprio terminal (ver tests/chat-terminal-preview): liga-se ao processo dele.
  expect(host.querySelector('.chat-preview .xterm')).toBeTruthy(); expect((window as never as { palco: { terminal: { attach: unknown } } }).palco.terminal.attach).toHaveBeenCalledWith('t1')
  const patch = vi.fn(async () => {}); Object.assign((window as never as { palco: { node: unknown } }).palco, { node: { patch } })
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Ocultar prévia do terminal')!.click() }); expect(patch).toHaveBeenCalledWith('t1', { chatShowsShell: false })
  await act(async () => root.unmount()); root = createRoot(host)
  await act(async () => root.render(createElement(ChatView, { terminalId: 't1', name: 'Agente', showsShell: false }))); await flush()
  expect(host.querySelector('.chat-preview')).toBeNull(); expect(host.textContent).toContain('Mostrar prévia do terminal')
})
