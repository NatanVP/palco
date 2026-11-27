// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../../src/renderer/src/settings/SettingsDialog'
import { ShortcutSettings } from '../../src/renderer/src/settings/ShortcutSettings'
import { adoptPreferences, connectPreferences, getPreferences, matchesShortcut, suspendShortcuts } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'
import { rebindShortcut } from '../../src/shared/shortcuts'
import { drawKeyAction } from '../../src/renderer/src/canvas/draw/keys'
import { installHistoryKeys } from '../../src/renderer/src/canvas/history-keys'
import type { PalcoApi } from '../../src/shared/api'
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, api: PalcoApi['preferences']
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  adoptPreferences(defaultPreferences()); suspendShortcuts(false)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api = {
    get: vi.fn(async () => getPreferences()), set: vi.fn(async patch => ({ ...getPreferences(), ...patch })), onChange: vi.fn(() => () => {}),
    bind: vi.fn(async (id, binding) => { const result = rebindShortcut(getPreferences().shortcuts, id, binding); return { preferences: { ...getPreferences(), shortcuts: result.shortcuts }, conflicts: result.conflicts } }),
    resetShortcuts: vi.fn(async () => defaultPreferences())
  }
  Object.assign(window, { palco: { about: { info: async () => ({ version: '0.1.0', contact: null, onboardingCompleted: true }) }, gitHosts: { state: async () => ({ directory: '/tmp/providers', providers: [], missing: [] }) }, dataSettings: { state: async () => ({ root: '/tmp/fixture', snapshots: [], backupIntervalMinutes: 60 }) }, accountSettings: { list: async () => [], terminals: async () => [], secureStorage: async () => false }, providers: { list: async () => [] }, workspaces: { sidebar: async () => ({ workspaces: [] }), onSidebar: () => () => {} }, roles: { list: async () => [] }, prompts: { list: async () => ({ items: [], problems: [] }) }, skills: { list: async () => [] }, preferences: api, presets: { list: async () => [], roles: async () => [] }, accounts: { list: async () => [] } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); adoptPreferences(defaultPreferences()); suspendShortcuts(false); vi.unstubAllGlobals() })
const clickText = async (text: string) => { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!; expect(button).toBeTruthy(); await act(async () => button.click()) }
it('abas/sub-abas úteis, motivo de indisponibilidade, gravação real e foco modal', async () => {
  const close = vi.fn(); await act(async () => root.render(createElement(SettingsDialog, { onClose: close })))
  expect([...host.querySelectorAll('[role=tab]')].map(e => e.textContent)).toEqual(['Geral', 'Terminal', 'Agentes', 'Atalhos', 'Wire', 'Dados', 'Sobre'])
  const appearance = host.querySelector<HTMLSelectElement>('[aria-label="Aparência"]')!
  await act(async () => { appearance.value = 'light'; appearance.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(api.set).toHaveBeenCalledWith({ appearance: 'light' })
  await clickText('Ambientes'); const disabled = host.querySelector<HTMLInputElement>('input:disabled')!
  expect(disabled.getAttribute('aria-describedby')).toBeTruthy(); expect(host.textContent).toContain('WSL só existe no Windows')
  for (const tab of ['Terminal', 'Agentes', 'Wire', 'Dados', 'Sobre']) await clickText(tab)
  expect(host.textContent).toContain('Agradecimentos')
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(close).toHaveBeenCalledOnce()
})
it('recorder bloqueia atalhos, grava conflito, limpa e restaura padrão; Escape cancela', async () => {
  await act(async () => root.render(createElement(ShortcutSettings)))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Gravar Desfazer"]')!.click())
  expect(matchesShortcut('connect', new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))).toBe(false)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true, cancelable: true })))
  expect(api.bind).toHaveBeenCalledWith('undo', { key: 'l', mod: true }); expect(host.textContent).toContain('Conflito:')
  expect(getPreferences().shortcuts.connect).toEqual([])
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Limpar Desfazer"]')!.click())
  expect(getPreferences().shortcuts.undo).toEqual([])
  await clickText('Restaurar padrão'); expect(getPreferences().shortcuts.undo).toEqual(defaultPreferences().shortcuts.undo)
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Gravar Desfazer"]')!.click())
  const before = vi.mocked(api.bind).mock.calls.length
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(vi.mocked(api.bind).mock.calls).toHaveLength(before)
})
it('desenho e histórico leem remapeamentos vivos, preservando seus guards de foco', async () => {
  const p = defaultPreferences(); p.shortcuts.drawRectangle = [{ key: 'r', mod: true }]; p.shortcuts.undo = [{ key: 'u', alt: true }]; adoptPreferences(p)
  const state = { drawing: false, gesture: false, hasSelection: false }
  expect(drawKeyAction(new KeyboardEvent('keydown', { key: 'b' }), state)).toBeNull()
  expect(drawKeyAction(Object.assign(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }), {}), state)).toEqual({ kind: 'arm-rect' })
  host.tabIndex = 0; host.focus(); const undo = vi.fn(async () => true)
  const off = installHistoryKeys(host, 'w', { undo, redo: vi.fn() }, vi.fn(), vi.fn())
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); expect(undo).not.toHaveBeenCalled()
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', altKey: true, bubbles: true })); expect(undo).toHaveBeenCalledWith('w'); off()
})
it('uma leitura inicial atrasada não sobrescreve evento mais novo', async () => {
  let resolve!: (p: ReturnType<typeof defaultPreferences>) => void, changed!: (p: ReturnType<typeof defaultPreferences>) => void
  api.get = () => new Promise(r => { resolve = r }); api.onChange = cb => { changed = cb; return () => {} }
  const off = connectPreferences(), newer = { ...defaultPreferences(), appearance: 'light' as const }
  changed(newer); resolve(defaultPreferences()); await Promise.resolve(); expect(getPreferences().appearance).toBe('light'); off()
})

it('Escape no recorder não fecha Configurações e modificador só grava ao soltar', async () => {
  const close = vi.fn(); await act(async () => root.render(createElement(SettingsDialog, { onClose: close })))
  await clickText('Atalhos')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Gravar Desfazer"]')!.click())
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(close).not.toHaveBeenCalled(); expect(api.bind).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Gravar Zoom com a roda"]')!.click())
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true })))
  expect(api.bind).not.toHaveBeenCalled()
  await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true })))
  expect(api.bind).toHaveBeenCalledWith('zoomWheel', { key: '', alt: true })
})
