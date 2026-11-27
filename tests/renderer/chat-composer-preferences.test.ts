// @vitest-environment happy-dom
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PresetStore } from '../../src/main/agents/presets'
import { RoleStore } from '../../src/main/agents/roles'
import { emptyForm, quickTileForm, toNewNode } from '../../src/renderer/src/dialogs/new-terminal'
import { OPTIONS } from '../../src/renderer/src/settings/options'
import { SettingsDialog } from '../../src/renderer/src/settings/SettingsDialog'
import { adoptPreferences, getPreferences, suspendShortcuts } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, set: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); suspendShortcuts(false)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  set = vi.fn(async patch => { const next = { ...getPreferences(), ...patch }; adoptPreferences(next); return next })
  Object.assign(window, { palco: { preferences: { get: async () => getPreferences(), set, onChange: () => () => {}, bind: vi.fn(), resetShortcuts: vi.fn() }, presets: { list: async () => [], roles: async () => [], missingDefaults: async () => [] }, terminal: { countAboveMemory: async () => 0 } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = async (text: string) => { const b = [...host.querySelectorAll<HTMLButtonElement>('button')].find(x => x.textContent === text); expect(b, text).toBeTruthy(); await act(async () => b!.click()); await flush() }

it('as opções de Chat e de Compositor estão ativas', () => {
  for (const k of ['chatFontFamily', 'chatFontSize', 'promptComposerFontSize']) expect(OPTIONS.find(o => o.key === k)?.ready, k).toBe(true)
})
it('Chat: o reset zera família e tamanho juntos; o Compositor volta ao padrão (null)', async () => {
  adoptPreferences({ ...defaultPreferences(), chatFontFamily: 'Georgia', chatFontSize: 20, promptComposerFontSize: 18 })
  await act(async () => root.render(createElement(SettingsDialog, { onClose: vi.fn() }))); await click('Terminal'); await click('Aparência'); await click('Chat')
  await act(async () => host.querySelector<HTMLButtonElement>('[data-option="chatFontSize"] .settings-reset')!.click()); await flush()
  expect(set).toHaveBeenLastCalledWith({ chatFontFamily: '', chatFontSize: 13 })
  await click('Compositor de Prompts')
  await act(async () => host.querySelector<HTMLButtonElement>('[data-option="promptComposerFontSize"] .settings-reset')!.click()); await flush()
  expect(set).toHaveBeenLastCalledWith({ promptComposerFontSize: null })
})

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
it('preset com "Iniciar no Modo de Chat": grava, edita e faz o terminal nascer na face de chat (só agente)', () => {
  const d = mkdtempSync(join(tmpdir(), 'palco-chatpre-')); dirs.push(d)
  const s = new PresetStore(join(d, 'presets.json'), new RoleStore(join(d, 'roles')))
  const p = s.create({ name: 'Revisor', command: 'claude', startInChat: true }); expect(p.startInChat).toBe(true)
  expect(new PresetStore(join(d, 'presets.json'), new RoleStore(join(d, 'roles'))).list()[0]?.startInChat).toBe(true)
  expect(s.set('Revisor', { startInChat: false }).startInChat).toBe(false)
  const form = quickTileForm({ id: 'x', name: 'Revisor', command: 'claude', icon: 'sparkles', preset: { ...p, startInChat: true } }, [])
  expect(form.startInChat).toBe(true)
  const frame = { pos: { x: 0, y: 0 }, size: { w: 500, h: 300 } }
  expect(toNewNode({ ...emptyForm(), command: 'claude', startInChat: true }, frame, null, [])).toMatchObject({ chatMode: true })
  expect(toNewNode({ ...emptyForm(), command: '', startInChat: true }, frame, null, [])).not.toHaveProperty('chatMode')
  expect(toNewNode({ ...emptyForm(), command: 'claude' }, frame, null, [])).not.toHaveProperty('chatMode')
})

it('Estilo da face: o seletor aparece quando a família tem mais de uma face e grava o postscriptName; "Padrão" volta à família', async () => {
  const faces = [{ family: 'Fira Code', fullName: 'Fira Code Regular', postscriptName: 'FiraCode-Regular', style: 'Regular' }, { family: 'Fira Code', fullName: 'Fira Code Bold', postscriptName: 'FiraCode-Bold', style: 'Bold' }]
  Object.assign(window, { queryLocalFonts: async () => faces })
  const mod = await import('../../src/renderer/src/settings/controls/local-fonts'); void mod
  adoptPreferences({ ...defaultPreferences(), terminalFontFamily: 'Fira Code' })
  await act(async () => root.render(createElement(SettingsDialog, { onClose: vi.fn() }))); await click('Terminal'); await click('Aparência'); await flush()
  const sel = host.querySelector<HTMLSelectElement>('select[aria-label="Estilo — Família da fonte"]'); expect(sel).toBeTruthy()
  expect([...sel!.options].map(o => o.textContent)).toEqual(['Padrão', 'Regular', 'Bold'])
  await act(async () => { sel!.value = 'FiraCode-Bold'; sel!.dispatchEvent(new Event('change', { bubbles: true })) }); await flush(); expect(set).toHaveBeenLastCalledWith({ terminalFontFamily: 'FiraCode-Bold' })
  const again = host.querySelector<HTMLSelectElement>('select[aria-label="Estilo — Família da fonte"]')!; expect(again.value).toBe('FiraCode-Bold')
  await act(async () => { again.value = ''; again.dispatchEvent(new Event('change', { bubbles: true })) }); await flush(); expect(set).toHaveBeenLastCalledWith({ terminalFontFamily: 'Fira Code' })
})

it('preset: a aba Aparência (ícone, cor, tema com par, fontes) vai no create; vazio herda', async () => {
  const create = vi.fn(async (p: unknown) => p); Object.assign((window as never as { palco: { presets: object } }).palco.presets, { create, set: vi.fn(), remove: vi.fn(), reorder: vi.fn(), restoreDefaults: vi.fn() })
  await act(async () => root.render(createElement(SettingsDialog, { onClose: vi.fn() }))); await click('Terminal'); await click('Início Rápido'); await click('Adicionar Preset'); await flush()
  const type = async (label: string, v: string) => { const el = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }); await flush() }
  const press = async (selector: string) => { await act(async () => host.querySelector<HTMLElement>(selector)!.click()); await flush() }
  const inForm = async (text: string) => { await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.preset-editor button')].find(b => b.textContent === text)!.click()); await flush() }
  await type('Nome do Preset', 'Revisor'); await type('Comando', 'claude'); await inForm('Aparência')
  await press('.preset-icon-grid button[aria-label="flag"]'); await press('.preset-colors button[aria-label="Verde"]')
  // tema com par claro/escuro, pelo cartão Personalizado
  await inForm('Personalizado'); await press('[aria-label="Seguir aparência do sistema"]')
  await press('[data-theme-id="gruvbox-light"]'); await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.theme-modal .settings-segmented button')].find(b => b.textContent === 'Escuro')!.click()); await flush(); await press('.theme-modal [data-theme-id="gruvbox-dark"]'); await inForm('Concluído')
  await type('Fonte do terminal', 'Fira Code'); await type('Tamanho do terminal', '15')
  await inForm('Chat'); await type('Tamanho do chat', '16')
  await inForm('Salvar')
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Revisor', appearance: { icon: 'flag', color: '#34C759', themeId: 'gruvbox-light', darkThemeId: 'gruvbox-dark', fontFamily: 'Fira Code', fontSize: 15, chatFontSize: 16 } }))
})
