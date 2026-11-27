// @vitest-environment happy-dom
// alternar terminal/chat aparece em Configurações › Atalhos, regrava, e a combinação nova vale onde se usa.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasCommands } from '../src/renderer/src/canvas/commands/useCommands'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { ShortcutSettings } from '../src/renderer/src/settings/ShortcutSettings'
import { isGlobalShortcut, typingKeepsKey } from '../src/renderer/src/shortcuts'
import { defaultPreferences } from '../src/shared/preferences'
import { rebindShortcut, type KeyBinding, type ShortcutId } from '../src/shared/shortcuts'
import { mountApp, emptyWorkspace } from './helpers/app-harness'
import type { TerminalNode, Workspace } from '../src/shared/model'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); adoptPreferences(defaultPreferences()); vi.unstubAllGlobals() })

const withChat = (binding: KeyBinding) => ({ ...defaultPreferences(), shortcuts: rebindShortcut(defaultPreferences().shortcuts, 'chatSwap', binding).shortcuts })
const key = (k: string, extra: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })
const click = (el: Element) => act(async () => { (el as HTMLElement).click() })

describe('Configurações › Atalhos', () => {
  it('lista "Alternar entre chat e terminal" com a combinação atual e grava outra', async () => {
    const bind = vi.fn(async (id: ShortcutId, binding: KeyBinding | null) => ({ preferences: withChat(binding!), conflicts: [] as ShortcutId[], id }))
    Object.assign(window, { palco: { preferences: { bind } } })
    await act(async () => root.render(createElement(ShortcutSettings)))
    const row = () => [...host.querySelectorAll('tr')].find((tr) => tr.textContent!.includes('Alternar entre chat e terminal'))!
    expect(row().textContent).toMatch(/Ctrl\+Shift\+j/i)
    await click(row().querySelector('[aria-label="Gravar Alternar entre chat e terminal"]')!)
    const pressed = key('c', { ctrlKey: true, altKey: true })
    // O happy-dom diz que Ctrl+Alt é AltGraph; num teclado de verdade não é.
    Object.defineProperty(pressed, 'getModifierState', { value: () => false })
    await act(async () => { window.dispatchEvent(pressed) })
    expect(bind).toHaveBeenCalledWith('chatSwap', { key: 'c', mod: true, alt: true })
    expect(row().textContent).toContain('Ctrl/Cmd+Alt+c')
  })
})

const agent = (id: string): TerminalNode => ({ id, kind: 'terminal', name: id, agent: 'claude', command: 'claude', cwd: '/tmp', floorId: null, chatMode: true, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })

describe('o atalho no uso', () => {
  it('age no chat que tem o foco, mesmo com outro elemento selecionado', async () => {
    const patch = vi.fn(async () => {})
    Object.assign(window, { palco: { node: { patch } } })
    const ws = { id: 'w', name: 'W', nodes: { a: agent('a'), b: agent('b') }, connections: [], floors: {}, activeFloor: null, camera: { zoom: 1, offset: { x: 0, y: 0 } } } as Workspace
    const field = document.createElement('textarea'), card = document.createElement('div')
    card.dataset.nodeId = 'b'; card.append(field); host.append(card)
    let run!: ReturnType<typeof useCanvasCommands>
    const mountPoint = document.createElement('div'); host.append(mountPoint)
    const probe = createRoot(mountPoint)
    function Probe() { run = useCanvasCommands({ ws: { current: ws }, selection: new Set(['a']), notify: vi.fn() } as never); return null }
    await act(async () => probe.render(createElement(Probe)))
    field.focus()
    run({ kind: 'chatSwap' })
    expect(patch).toHaveBeenCalledWith('b', { chatMode: false })
    // Sem foco em nenhum elemento, vale o selecionado.
    field.blur(); patch.mockClear(); run({ kind: 'chatSwap' })
    expect(patch).toHaveBeenCalledWith('a', { chatMode: false })
    await act(async () => probe.unmount())
  })

  it('quem digita fica com a tecla quando a combinação é só um caractere', () => {
    const area = document.createElement('textarea')
    const typed = { key: 'c', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: area }
    expect(typingKeepsKey(typed)).toBe(true)
    expect(typingKeepsKey({ ...typed, ctrlKey: true })).toBe(false)
    expect(typingKeepsKey({ ...typed, key: 'F2' })).toBe(false)
    expect(typingKeepsKey({ ...typed, target: document.body })).toBe(false)
    adoptPreferences(withChat({ key: 'c' }))
    // No terminal: a letra vai para o processo; a combinação com modificador continua do app.
    const xterm = document.createElement('div'); xterm.className = 'xterm'; const inside = document.createElement('textarea'); xterm.append(inside)
    expect(isGlobalShortcut({ ...typed, target: inside })).toBe(false)
    adoptPreferences(withChat({ key: 'c', mod: true, alt: true }))
    expect(isGlobalShortcut({ ...typed, ctrlKey: true, altKey: true, target: inside })).toBe(true)
  })

  it('no app: a combinação regravada alterna a partir do campo do chat; a letra simples não rouba a digitação; o botão do cabeçalho mostra a atual', async () => {
    const patch = vi.fn(async () => {})
    let preferences = withChat({ key: 'c' })
    const app = await mountApp({ workspace: emptyWorkspace({ nodes: { a: agent('a') } }), api: { 'node.patch': patch as never, 'preferences.get': async () => preferences, 'terminal.attach': async () => ({ data: '', seq: 0, gen: 1 }), 'chat.state': async () => ({ terminalId: 'a', thread: 'blue', entries: [], hasOlder: false, status: 'idle', unreadCount: 0, workingSince: null, filledThreads: [] }), 'workspaces.loadIcon': async () => null, 'rail.attention': async () => ({}) } })
    try {
      await act(async () => adoptPreferences(preferences))
      const field = app.host.querySelector<HTMLTextAreaElement>('.chat-composer textarea')!
      field.focus()
      await act(async () => { field.dispatchEvent(key('c')) })
      expect(patch).not.toHaveBeenCalled()
      preferences = withChat({ key: 'c', mod: true, alt: true })
      await act(async () => adoptPreferences(preferences))
      await act(async () => { field.dispatchEvent(key('j', { ctrlKey: true, shiftKey: true })) })
      expect(patch).not.toHaveBeenCalled()
      await act(async () => { field.dispatchEvent(key('c', { ctrlKey: true, altKey: true })) })
      expect(patch).toHaveBeenCalledWith('a', { chatMode: false })
      const header = app.host.querySelector<HTMLButtonElement>('.chat-toggle')!
      expect(header.title).toBe('Mostrar terminal (Ctrl/Cmd+Alt+c)')
      expect(header.getAttribute('aria-keyshortcuts')).toBe('Control+Alt+c')
    } finally { await app.unmount() }
  })
})
