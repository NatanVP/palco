// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { defaultShortcuts, matchShortcut, rebindShortcut, type KeyInput } from '../src/shared/shortcuts'
import { defaultPreferences, validatePreferences } from '../src/shared/preferences'
import { ShortcutSettings } from '../src/renderer/src/settings/ShortcutSettings'
import { adoptPreferences, getPreferences, suspendShortcuts } from '../src/renderer/src/settings/preferences'
import { Canvas } from '../src/renderer/src/canvas/Canvas'
import type { Workspace } from '../src/shared/model'
vi.mock('../src/renderer/src/nodes/TerminalView', () => ({ TerminalView: () => null }))
const key = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); suspendShortcuts(false) })
afterEach(() => { vi.unstubAllGlobals(); adoptPreferences(defaultPreferences()); suspendShortcuts(false) })
it('Ctrl sozinho é o padrão; Ctrl+C e Ctrl+Shift+P continuam ações independentes', () => {
  const map = defaultShortcuts()
  expect(matchShortcut('panHold', key('Control', { ctrlKey: true }), map)).toBe(true)
  expect(matchShortcut('panHold', key('c', { ctrlKey: true }), map)).toBe(false)
  expect(matchShortcut('copy', key('c', { ctrlKey: true }), map)).toBe(true)
  expect(matchShortcut('prompter', key('P', { ctrlKey: true, shiftKey: true }), map)).toBe(true)
})
it.each(['ctrl', 'alt', 'shift'] as const)('regrava modificador %s sem apagar atalhos ou consumidores de Ctrl+clique', flag => {
  const map = defaultShortcuts(), binding = { key: '', [flag]: true }
  const result = rebindShortcut(map, 'panHold', binding)
  expect(result.conflicts).toEqual([])
  expect(result.shortcuts.tile).toEqual(map.tile); expect(result.shortcuts.copy).toEqual(map.copy)
  expect(validatePreferences({ shortcuts: { panHold: [binding] } }).shortcuts.panHold).toEqual([binding])
})
it('grava uma modificadora ao soltá-la, e permite voltar a Space', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const bind = vi.fn(async (id, binding) => { const p = getPreferences(), result = rebindShortcut(p.shortcuts, id, binding); return { preferences: { ...p, shortcuts: result.shortcuts }, conflicts: result.conflicts } })
  Object.assign(window, { palco: { preferences: { bind } } })
  try {
    await act(async () => root.render(createElement(ShortcutSettings)))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Gravar Segurar pan"]')!.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true })))
    expect(bind).not.toHaveBeenCalled()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true })))
    expect(bind).toHaveBeenLastCalledWith('panHold', { key: '', alt: true })
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Gravar Segurar pan"]')!.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })))
    expect(bind).toHaveBeenLastCalledWith('panHold', { key: ' ', code: 'Space' })
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('Ctrl+arrasto no fundo move câmera; soltar Ctrl volta ao laço; Ctrl+clique no card não inicia pan', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const camera = { offset: { x: 0, y: 0 }, zoom: 1 }, onCamera = vi.fn()
  const ws: Workspace = { id: 'w', name: 'W', nodes: { n: { id: 'n', kind: 'note', name: 'N', content: '', floorId: null, pos: { x: 400, y: 400 }, size: { w: 100, h: 100 } } }, connections: [], floors: {}, activeFloor: null, camera }
  Object.assign(window, { palco: {} })
  try {
    await act(async () => root.render(createElement(Canvas, { ws, camera, onCamera, linkFrom: null, onLink: vi.fn(), selectedConn: null, onSelectConn: vi.fn(), selection: new Set<string>(), onToggleSelect: vi.fn(), onGoToFloor: vi.fn() })))
    const canvas = host.querySelector<HTMLElement>('.canvas')!
    canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn(); canvas.hasPointerCapture = () => true
    const pointer = async (el: Element, type: string, ctrlKey: boolean, x: number) => act(async () => { el.dispatchEvent(new PointerEvent(type, { button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, clientX: x, clientY: x, ctrlKey, bubbles: true })) })
    await pointer(canvas, 'pointerdown', true, 10); await pointer(canvas, 'pointermove', true, 50)
    expect(onCamera).toHaveBeenCalledWith({ zoom: 1, offset: { x: 40, y: 40 } })
    await pointer(canvas, 'pointerup', false, 50); onCamera.mockClear()
    await pointer(canvas, 'pointerdown', false, 10); await pointer(canvas, 'pointermove', false, 50)
    expect(onCamera).not.toHaveBeenCalled(); await pointer(canvas, 'pointerup', false, 50)
    await pointer(host.querySelector('[data-node-id="n"]')!, 'pointerdown', true, 450)
    await pointer(canvas, 'pointermove', true, 480); expect(onCamera).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('tecla comum de pan resolve conflito com outra ação no mesmo escopo', () => {
  const r = rebindShortcut(defaultShortcuts(), 'panHold', { key: 'h' })
  expect(r.conflicts).toContain('panToggle'); expect(r.shortcuts.panToggle).toEqual([])
})
