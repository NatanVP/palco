// @vitest-environment happy-dom
// Compositor: regressões de edição, layout e envio de mensagens.
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { editorSelection, readEditor, setEditorSelection } from '../src/renderer/src/composer/editor'
import { Composer } from '../src/renderer/src/composer/Composer'
import { composerMode, cycleComposer, dismissComposer, focusComposer, setComposerMode } from '../src/renderer/src/composer/composer-mode'
import { clearDraft } from '../src/renderer/src/composer/composer-drafts'
import { selectionKeyAction } from '../src/renderer/src/canvas/selection/keys'
import { isEditingElsewhere } from '../src/renderer/src/canvas/screen-options'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'
import type { TerminalNode } from '../src/shared/model'

const node: TerminalNode = { id: 'rv', kind: 'terminal', name: 'Revisor', agent: 'claude', command: 'claude', cwd: '/tmp', floorId: null, pos: { x: 0, y: 0 }, size: { w: 600, h: 300 } }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, send: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); clearDraft(node.id)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  send = vi.fn(async () => ({ accepted: true }))
  Object.assign(window, { palco: { chat: { send }, files: { pathOf: () => '' }, workspace: { get: async () => ({ nodes: {}, floors: {} }), onChange: () => () => {} }, workspaces: { sidebar: async () => ({ workspaces: [] }) } } })
  setComposerMode(node.id, 'overlay')
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setComposerMode(node.id, 'off'); vi.unstubAllGlobals() })
const mount = async () => act(async () => root.render(<Composer node={node} />))
const editor = () => host.querySelector<HTMLDivElement>('[data-composer-editor]')!
const type = async (text: string) => act(async () => { const a = editor(); a.focus(); a.replaceChildren(document.createTextNode(text)); setEditorSelection(a, text.length); a.dispatchEvent(new Event('input', { bubbles: true })) })
const key = async (k: string, extra = {}) => act(async () => { editor().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })) })
const clipboard = (kind: 'copy' | 'cut') => { const data: Record<string, string> = {}; const event = new Event(kind, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'clipboardData', { value: { setData: (t: string, v: string) => { data[t] = v }, getData: () => '' } }); return { event, data } }

it("a seleção feita pelo usuário sobrevive ao onSelect (não é recolhida a cada mudança)", async () => {
  await mount(); await type('um dois tres')
  // o React emite onSelect em keyup/mouseup quando a seleção muda; antes, o efeito repunha um cursor vazio no início dela
  for (const [from, to] of [[8, 12], [3, 12], [0, 12]] as const) {
    await act(async () => { editor().dispatchEvent(new FocusEvent('focusin', { bubbles: true })); setEditorSelection(editor(), from, to); editor().dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })); document.dispatchEvent(new Event('selectionchange')) })
    expect(editorSelection(editor()), `seleção ${from}-${to}`).toEqual({ start: from, end: to })
  }
})
it("copiar ou recortar sem seleção não mexe na área de transferência", async () => {
  await mount(); await type('texto')
  for (const kind of ['copy', 'cut'] as const) {
    const { event, data } = clipboard(kind)
    await act(async () => { setEditorSelection(editor(), 2); editor().dispatchEvent(event) })
    expect([kind, event.defaultPrevented, data]).toEqual([kind, false, {}])
  }
  const { event, data } = clipboard('copy')
  await act(async () => { setEditorSelection(editor(), 0, 3); editor().dispatchEvent(event) })
  expect(data['text/plain']).toBe('tex'); expect(readEditor(editor())).toBe('texto')
})
it("durante o envio o editor segue focado e editável para o teclado (Delete não chega ao canvas); o texto não muda", async () => {
  let done!: (v: unknown) => void; send.mockImplementation(() => new Promise((ok) => { done = ok }))
  await mount(); await type('envie')
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')!
  await act(async () => { button.focus(); button.click() }) // envio pelo botão: ele fica desabilitado com o foco
  expect(editor().getAttribute('contenteditable')).toBe('true'); expect(editor().getAttribute('aria-readonly')).toBe('true'); expect(document.activeElement).toBe(editor())
  const del = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
  let action: unknown = 'não chamado'
  const spy = (e: Event) => { action = selectionKeyAction(e as KeyboardEvent, { hasSelection: true }) }
  window.addEventListener('keydown', spy); await act(async () => { editor().dispatchEvent(del) }); window.removeEventListener('keydown', spy)
  expect(action).toBeNull()
  const typed = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'x' })
  await act(async () => { editor().dispatchEvent(typed) }); expect(typed.defaultPrevented).toBe(true)
  await act(async () => done({ accepted: true }))
  expect(editor().getAttribute('aria-readonly')).toBeNull(); expect(document.activeElement).toBe(editor())
})
it("Shift+Enter no fim abre a linha: sentinela depois da quebra, cursor na linha nova, e o que se digita vai para ela", async () => {
  await mount(); await type('abc'); await key('Enter', { shiftKey: true })
  expect(readEditor(editor())).toBe('abc\n'); expect(editor().lastChild?.nodeName).toBe('BR'); expect(editorSelection(editor())).toEqual({ start: 4, end: 4 })
  await act(async () => { const r = document.getSelection()!.getRangeAt(0); r.insertNode(document.createTextNode('x')); editor().dispatchEvent(new Event('input', { bubbles: true })) })
  expect(readEditor(editor())).toBe('abc\nx'); await key('Enter'); expect(send).toHaveBeenCalledWith(node.id, { text: 'abc\nx', attachments: [] })
})
it("o <br> de apoio que o Chromium deixa num editor vazio não vira texto", () => {
  const el = document.createElement('div'); el.append(document.createElement('br')); expect(readEditor(el)).toBe('')
})
it("depois do Esc, sair para o fundo e voltar ao mesmo terminal reabre", () => {
  setComposerMode(node.id, 'off'); focusComposer(node.id); cycleComposer(node.id, true); expect(composerMode(node.id)).toBe('overlay')
  dismissComposer(node.id); focusComposer(node.id); expect(composerMode(node.id)).toBe('off') // o foco que volta ao terminal logo após o Esc não reabre
  focusComposer(null); focusComposer(node.id); expect(composerMode(node.id)).toBe('overlay')
})
it("focar ao passar o cursor não tira o foco de um campo ou editor que está em uso em outro card", () => {
  const a = document.createElement('div'), b = document.createElement('div'), ed = document.createElement('div'), pill = document.createElement('span'), input = document.createElement('input'), term = document.createElement('div'), area = document.createElement('textarea')
  ed.setAttribute('contenteditable', 'true'); pill.tabIndex = 0; ed.append(pill); term.className = 'xterm'; term.append(area); a.append(ed, input, term); document.body.append(a, b)
  for (const active of [ed, pill, input]) expect(isEditingElsewhere(active, b), active.tagName).toBe(true)
  expect(isEditingElsewhere(ed, a)).toBe(false); expect(isEditingElsewhere(area, b)).toBe(false); expect(isEditingElsewhere(document.body, b)).toBe(false)
  a.remove(); b.remove()
})
it('Enviar habilitado tem o fundo primário: a regra dele precisa ganhar da regra genérica dos botões da linha', () => {
  const css = readFileSync('src/renderer/src/composer/composer.css', 'utf8')
  // especificidade (classes/atributos/pseudo-classes, elementos) de um seletor simples
  const weight = (s: string): number => (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g)?.length ?? 0) * 100 + (s.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, '').match(/\b[a-z]+\b/g)?.length ?? 0)
  const selector = (rule: RegExp): string => css.match(rule)![1]!.trim()
  const generic = selector(/^(\.composer \.composer-row > button\[type="button"\]) \{[^}]*background: transparent/m)
  const enabled = selector(/^([^\n{]*\.composer-send) \{[^}]*background: var\(--composer-primary\)/m)
  const disabled = selector(/^([^\n{]*\.composer-send:disabled) \{/m)
  expect(weight(enabled)).toBeGreaterThan(weight(generic)); expect(weight(disabled)).toBeGreaterThan(weight(enabled))
})
