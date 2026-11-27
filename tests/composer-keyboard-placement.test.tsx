// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { readEditor, setEditorSelection } from '../src/renderer/src/composer/editor'
import { Composer } from '../src/renderer/src/composer/Composer'
import { clearDraft } from '../src/renderer/src/composer/composer-drafts'
import { composerMode, setComposerMode } from '../src/renderer/src/composer/composer-mode'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'
import type { TerminalNode } from '../src/shared/model'
const node: TerminalNode = { id: 'f11', kind: 'terminal', name: 'Revisor', agent: 'claude', command: 'claude', cwd: '/tmp', floorId: null, pos: { x: 0, y: 0 }, size: { w: 600, h: 300 } }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, send: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); clearDraft(node.id)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  send = vi.fn(async () => ({ accepted: true }))
  Object.assign(window, { palco: { chat: { send }, files: { pick: async () => null }, workspace: { get: async () => ({ nodes: {}, floors: {} }), onChange: () => () => {} }, workspaces: { sidebar: async () => ({ workspaces: [] }) } } })
  setComposerMode(node.id, 'overlay')
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setComposerMode(node.id, 'off'); vi.unstubAllGlobals() })
const mount = async () => act(async () => root.render(<Composer node={node} />))
const type = async (text: string) => act(async () => { const a = host.querySelector<HTMLDivElement>('[data-composer-editor]')!; a.replaceChildren(document.createTextNode(text)); setEditorSelection(a, text.length); a.dispatchEvent(new Event('input', { bubbles: true })) })
const key = async (key: string, extra = {}) => act(async () => { host.querySelector<HTMLDivElement>('[data-composer-editor]')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })) })
it('HUD tem controles apenas com ícones e editor combobox acessível', async () => {
  await mount()
  expect(host.querySelector('[aria-label="Enviar"]')!.textContent).toBe('')
  expect(host.querySelector('[aria-label="Enviar"] svg')).toBeTruthy()
  expect(host.querySelector<HTMLDivElement>('[data-composer-editor]')!.getAttribute('role')).toBe('combobox')
  expect(host.querySelector<HTMLDivElement>('[data-composer-editor]')!.getAttribute('aria-expanded')).toBe('false')
})
it('Alt+Enter não envia e Escape dispensa primeiro as sugestões', async () => {
  await mount(); await type('oi'); await key('Enter', { altKey: true }); expect(send).not.toHaveBeenCalled()
  await type('@'); expect(host.querySelector('[role="listbox"]')).toBeTruthy()
  await key('Escape'); expect(host.querySelector('.composer')).toBeTruthy(); expect(host.querySelector('[role="listbox"]')).toBeNull()
})
it('fechar e reabrir conserva o rascunho e anexos', async () => {
  await mount(); await type('rascunho preservado'); await key('Escape')
  await act(async () => setComposerMode(node.id, 'overlay'))
  expect(readEditor(host.querySelector<HTMLDivElement>('[data-composer-editor]')!)).toBe('rascunho preservado')
})
it('não duplica envio pendente e preserva texto quando a API rejeita', async () => {
  let reject!: (error: Error) => void
  send.mockImplementation(() => new Promise((_resolve, no) => { reject = no }))
  await mount(); await type('uma vez'); await key('Enter'); await key('Enter')
  expect(send).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('offline')))
  expect(readEditor(host.querySelector<HTMLDivElement>('[data-composer-editor]')!)).toBe('uma vez'); expect(host.querySelector('[role="alert"]')).toBeTruthy()
})

import { hudGeometry } from '../src/renderer/src/composer/hud-geometry'
it('o zoom do canvas não reduz controles nem muda os 30/12 px de afastamento', () => {
  expect(hudGeometry({ width: 300 }, 600, 'overlay')).toMatchObject({ width: 276, bottom: 60, transform: 'translateX(-50%) scale(2)' })
  expect(hudGeometry({ width: 1200 }, 600, 'below')).toMatchObject({ width: 560, top: 'calc(100% + 6px)', transform: 'translateX(-50%) scale(0.5)' })
})
it('usa editor rico e pílula de texto que expande ao clicar', async () => {
  await mount()
  const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')
  expect(editor).toBeTruthy()
  const big = 'a\nb\nc\nd\ne\nf'
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => big } }); editor!.dispatchEvent(event)
  })
  expect(host.querySelector('[data-composer-pill]')).toBeTruthy()
  await act(async () => (host.querySelector('[data-composer-pill]') as HTMLElement).click())
  expect(editor!.textContent).toBe(big)
})
it('permite selecionar múltiplos anexos também para shell', async () => {
  await act(async () => root.render(<Composer node={{ ...node, agent: 'shell' }} />))
  expect(host.querySelector<HTMLInputElement>('input[type="file"][multiple]')).toBeTruthy()
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Anexar arquivo"]')!.disabled).toBe(false)
})

import { focusComposer } from '../src/renderer/src/composer/composer-mode'
it('o modo acompanha o terminal focado e deixa somente uma HUD aberta', () => {
  setComposerMode(node.id, 'below'); focusComposer('outro')
  expect(composerMode(node.id)).toBe('off'); expect(composerMode('outro')).toBe('below')
  setComposerMode('outro', 'off')
})
it('anexos aparecem como pílulas dentro do editor e seguem com a entrega', async () => {
  Object.assign(window.palco.files, { pathOf: (file: File) => `/tmp/${file.name}` })
  await mount()
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(host.querySelectorAll('[data-composer-editor] [data-composer-attachment]')).toHaveLength(2)
  await key('Enter')
  expect(send).toHaveBeenCalledWith(node.id, { text: '', attachments: ['/tmp/a.txt', '/tmp/b.txt'] })
})
it('@Arquivos navega as pastas no menu antes de inserir um caminho', async () => {
  Object.assign(window.palco.files, { list: vi.fn(async () => [{ name: 'pasta', dir: true }, { name: 'a.txt', dir: false }]) })
  await mount(); await type('@arq'); await key('Enter')
  expect(window.palco.files.list).toHaveBeenCalledWith('/tmp')
  expect(host.querySelector('[data-composer-files-menu]')).toBeTruthy()
})
