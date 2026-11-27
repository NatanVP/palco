// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readEditor, setEditorSelection } from '../../src/renderer/src/composer/editor'
import { Composer } from '../../src/renderer/src/composer/Composer'
import { clearDraft } from '../../src/renderer/src/composer/composer-drafts'
import { composerMode, cycleComposer, setComposerMode } from '../../src/renderer/src/composer/composer-mode'
import { adoptPreferences } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'
import { defaultShortcuts, SHORTCUTS } from '../../src/shared/shortcuts'
import type { TerminalNode } from '../../src/shared/model'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, chat: Record<string, ReturnType<typeof vi.fn>>, write: ReturnType<typeof vi.fn>, add: ReturnType<typeof vi.fn>
const term = (over: Partial<TerminalNode> = {}): TerminalNode => ({ id: 't1', kind: 'terminal', floorId: null, name: 'Agente', agent: 'claude', command: 'claude', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 600, h: 300 }, ...over })
const ws = { id: 'w', nodes: { t1: term(), t2: { ...term({ id: 't2', name: 'Faísca' }) }, n1: { id: 'n1', kind: 'note', name: 'Plano', content: '', floorId: null, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } } }, floors: { f1: { id: 'f1', name: 'ui' } }, activeFloor: null }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); setComposerMode('t1', 'off'); clearDraft('t1'); clearDraft('t2'); adoptPreferences(defaultPreferences())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  chat = { send: vi.fn(async () => ({ accepted: true as const, entryId: 'e' })) }; write = vi.fn(); add = vi.fn(async () => 'n')
  Object.assign(window, { palco: { chat, terminal: { write }, node: { add }, files: { pick: vi.fn(async () => '/tmp/a b.txt'), pathOf: vi.fn(() => '/tmp/a b.txt'), list: vi.fn(async () => [{ name: 'a b.txt', dir: false }]) }, workspace: { get: async () => ws, onChange: () => () => {} }, workspaces: { sidebar: async () => ({ workspaces: [{ id: 'w1', name: 'Palco' }] }) } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const mount = async (node = term()) => { await act(async () => root.render(createElement(Composer, { node }))); await flush() }
const area = () => host.querySelector<HTMLDivElement>('[data-composer-editor]')!
const type = async (v: string, caret = v.length) => { const a = area(); await act(async () => { a.replaceChildren(document.createTextNode(v)); setEditorSelection(a, caret); a.dispatchEvent(new Event('input', { bubbles: true })) }); await flush() }
const key = async (k: string, extra = {}) => { await act(async () => { area().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra })) }); await flush() }

it('Ctrl+Shift+P agora é o Compositor de Prompts (a busca de ações é a Batuta)', () => {
  expect(SHORTCUTS.find(s => s.id === 'prompter')?.label).toBe('Compositor de Prompts'); expect(defaultShortcuts().prompter).toEqual([{ key: 'p', mod: true, shift: true }])
  expect(SHORTCUTS.find(s => s.id === 'filter')?.label).toBe('Batuta Search')
})
it('o estado gira e persiste a posição global', () => {
  expect(composerMode('t1')).toBe('off'); expect(cycleComposer('t1')).toBe('overlay'); expect(cycleComposer('t1')).toBe('below'); expect(JSON.parse(localStorage.getItem('palco.composer.modes')!)).toEqual({ t1: 'below' }); expect(cycleComposer('t1')).toBe('off')
})
it('escondido não renderiza; sobreposto e abaixo trazem a classe da posição e o foco no campo', async () => {
  await mount(); expect(host.querySelector('.composer')).toBeNull()
  setComposerMode('t1', 'overlay'); await mount(); expect(host.querySelector('.composer.overlay')).toBeTruthy(); expect(document.activeElement).toBe(area())
  setComposerMode('t1', 'below'); await act(async () => root.unmount()); root = createRoot(host); await mount(); expect(host.querySelector('.composer.below')).toBeTruthy()
})
it('mostra o nome do terminal no placeholder e as medidas da fonte escolhida', async () => {
  adoptPreferences({ ...defaultPreferences(), promptComposerFontSize: 20 }); setComposerMode('t1', 'overlay'); await mount()
  expect(area().dataset.placeholder!).toContain('Mensagem para Agente'); expect(area().dataset.placeholder!).toContain('Esc para fechar'); expect(area().style.fontSize).toBe('20px'); expect(area().style.lineHeight).toBe('31px')
})
it('Enter envia pelo chat do agente; Shift+Enter não; Esc fecha', async () => {
  setComposerMode('t1', 'overlay'); await mount(); await type('rode os testes')
  await key('Enter', { shiftKey: true }); expect(chat.send).not.toHaveBeenCalled()
  await key('Enter'); expect(chat.send).toHaveBeenCalledWith('t1', { text: 'rode os testes', attachments: [] }); expect(readEditor(area())).toBe('')
  await key('Escape'); expect(composerMode('t1')).toBe('off')
})
it('em terminal shell o texto é digitado no terminal e aceita anexo', async () => {
  setComposerMode('t1', 'overlay'); await mount(term({ agent: 'shell' })); await type('ls -la'); await key('Enter')
  expect(write).toHaveBeenCalledWith('t1', 'ls -la\r'); expect(chat.send).not.toHaveBeenCalled(); expect(host.querySelector<HTMLButtonElement>('[aria-label="Anexar arquivo"]')!.disabled).toBe(false)
})
it('falha na entrega mantém o rascunho e avisa', async () => {
  chat.send!.mockResolvedValueOnce({ accepted: false, cause: 'notRunning' }); setComposerMode('t1', 'overlay'); await mount(); await type('oi'); await key('Enter')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('não está em execução'); expect(readEditor(area())).toBe('oi')
})
it('@ abre as menções por seção, sem o próprio terminal; Enter insere; "@Prompts" vem desabilitado', async () => {
  setComposerMode('t1', 'overlay'); await mount(); await type('veja @')
  const menu = host.querySelector('[aria-label="Sugestões de menções"]')!
  expect([...menu.querySelectorAll('.composer-section')].map(s => s.textContent)).toEqual(['Terminais', 'Notas', 'Andares', 'Espaços de Trabalho', 'Ações', 'Arquivos', 'Prompts'])
  expect(menu.textContent).not.toContain('Agente'); expect(menu.textContent).toContain('Faísca')
  expect(menu.querySelector('.composer-item.disabled')?.getAttribute('title')).toMatch(/gerenciador de prompts/)
  await key('Enter'); expect(readEditor(area())).toBe('veja @Faísca ')
})
it('filtrar a menção e escolher por seta; Esc dentro do menu fecha o compositor', async () => {
  setComposerMode('t1', 'overlay'); await mount(); await type('@pla')
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1); await key('Enter'); expect(readEditor(area())).toBe('@Plano ')
})
it('Arquivo… insere o caminho escolhido (com aspas se tiver espaço); Nova Nota cria uma nota ao lado', async () => {
  setComposerMode('t1', 'overlay'); await mount(); await type('@arq'); await key('Enter'); await key('Enter'); expect(readEditor(area())).toBe("'/tmp/a b.txt' ")
  await type('@nova'); await key('Enter'); expect(add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note', pos: { x: 640, y: 0 } }))
})
it('texto grande colado vira pílula e é expandido ao enviar', async () => {
  setComposerMode('t1', 'overlay'); await mount()
  const big = 'a\nb\nc\nd\ne\nf'
  await act(async () => { const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown }; ev.clipboardData = { getData: () => big }; area().dispatchEvent(ev) }); await flush()
  expect(readEditor(area())).toBe('[Texto colado #1 · 6 linhas]'); await key('Enter'); expect(chat.send).toHaveBeenCalledWith('t1', { text: big, attachments: [] })
})
it('anexar manda o caminho junto da mensagem', async () => {
  setComposerMode('t1', 'overlay'); await mount(); await act(async () => { const input = host.querySelector<HTMLInputElement>('input[type="file"]')!; Object.defineProperty(input, 'files', { configurable: true, value: [new File(['a'], 'a b.txt')] }); input.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
  expect(host.querySelector('[data-composer-attachment]')?.textContent).toContain('a b.txt'); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')!.click()); await flush()
  expect(chat.send).toHaveBeenCalledWith('t1', { text: '', attachments: ['/tmp/a b.txt'] })
})

import { promptRows } from '../../src/renderer/src/composer/mentions'
it('promptRows filtra por nome e descrição e põe os do espaço atual antes dos globais', () => {
  const l = [{ name: 'Revisar PR', description: 'checklist', workspaceId: null }, { name: 'Resumo', description: 'do dia', workspaceId: 'w' }, { name: 'Testes', description: 'revisar cobertura', workspaceId: 'w' }]
  expect(promptRows(l, '', 'w').map(p => p.name)).toEqual(['Resumo', 'Testes', 'Revisar PR']); expect(promptRows(l, 'revis', 'w').map(p => p.name)).toEqual(['Testes', 'Revisar PR']); expect(promptRows(l, 'ZZ', 'w')).toEqual([])
})
it('@Prompts com o gerenciador: abre o submenu, filtra, insere o texto do prompt e volta; "Voltar" retorna às menções', async () => {
  const list = vi.fn(async () => ({ items: [{ id: 'p1', name: 'Revisar PR', description: 'checklist', workspaceId: null }, { id: 'p2', name: 'Resumo', description: '', workspaceId: null }], problems: [{ id: 'x', reason: 'vazio' }] }))
  const read = vi.fn(async (id: string) => ({ id, name: 'n', description: '', workspaceId: null, body: id === 'p1' ? 'Revise o PR:\n- testes\n- lint' : 'x' }))
  Object.assign((window as never as { palco: object }).palco, { prompts: { list, read } })
  setComposerMode('t1', 'overlay'); await mount(); await type('veja @prom')
  expect(host.querySelector('.composer-item.disabled')).toBeNull(); await key('Enter'); await flush()
  expect(list).toHaveBeenCalledWith('w'); const menu = host.querySelector('[aria-label="Prompts salvos"]')!; expect([...menu.querySelectorAll('[role="option"]')].map(o => o.textContent)).toEqual(['Revisar PRchecklist', 'Resumo'])
  expect(menu.textContent).toContain('Alguns prompts não puderam ser carregados'); expect(readEditor(area())).toBe('veja @')
  await type('veja @rev'); expect(host.querySelectorAll('[aria-label="Prompts salvos"] [role="option"]')).toHaveLength(1)
  await key('Enter'); await flush(); expect(read).toHaveBeenCalledWith('p1'); expect(readEditor(area())).toBe('veja Revise o PR:\n- testes\n- lint ')
  await type('@prom'); await key('Enter'); await flush(); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Prompts. Voltar às menções"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))); await flush()
  expect(host.querySelector('[aria-label="Sugestões de menções"]')).toBeTruthy()
})
