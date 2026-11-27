// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// Estes testes exercitam controles; a geometria dos anéis é coberta em tests/usage.
vi.mock('../src/renderer/src/usage/UsagePanel',()=>({UsageRings:()=>null}))
import { SettingsDialog } from '../src/renderer/src/settings/SettingsDialog'
import { SETTINGS_TABS } from '../src/renderer/src/settings/catalog'
import { Toggle } from '../src/renderer/src/settings/controls/Toggle'
import { OPTIONS } from '../src/renderer/src/settings/options'
import { adoptPreferences, getPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'
import { CATALOGS } from '../src/shared/i18n/runtime'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, set: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  set = vi.fn(async (patch) => { const next = { ...getPreferences(), ...patch }; adoptPreferences(next); return next })
  const provider = { id: 'claude', name: 'Claude Code', state: 'bundled', enabled: true, color: '#d97757', spec: {} }
  Object.assign(window, { palco: {
    preferences: { get: async () => getPreferences(), set, onChange: () => () => {} },
    about: { info: async () => ({ version: '0.1.0', contact: null, onboardingCompleted: true }) }, gitHosts: { state: async () => ({ directory: '/tmp/p', providers: [], missing: [] }) },
    dataSettings: { state: async () => ({ root: '/tmp/r', snapshots: [], backupIntervalMinutes: 60 }) }, accountSettings: { list: async () => [], terminals: async () => [], secureStorage: async () => true },
    providers: { list: async () => [provider] }, workspaces: { sidebar: async () => ({ workspaces: [] }), onSidebar: () => () => {} },
    roles: { list: async () => [{ name: 'Revisor', displayName: 'Revisor', instructions: 'x' }] }, prompts: { list: async () => ({ items: [], problems: [] }) },
    skills: { list: async () => [{ id: 'claude', name: 'Claude', path: '/tmp/skills', enabled: true, builtin: 'claude' }] },
    presets: { list: async () => [], roles: async () => [] }, accounts: { list: async () => [] }, usage: { get: async()=>[], onChange:()=>()=>{}, refresh: async () => [] }, environments: { status: async () => null }
  } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const click = async (el: Element | undefined | null) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()) }
const button = (text: string, within: ParentNode = host) => [...within.querySelectorAll('button')].find((b) => b.textContent === text)
const open = async () => { await act(async () => root.render(<SettingsDialog onClose={() => {}} />)) }
const go = async (tab: string, section?: string) => { await click(button(tab, host.querySelector('.settings-tabs')!)); if (section) await click(button(section, host.querySelector('.settings-subtabs')!)) }
const titles = () => [...host.querySelectorAll('.settings-section-title')].map((e) => e.textContent)
const row = (key: string) => host.querySelector<HTMLElement>(`[data-option="${key}"]`)!

it('Toggle é uma chave deslizante: caixa nativa com papel de switch, que muda e desabilita', async () => {
  const change = vi.fn()
  await act(async () => root.render(<><Toggle label="a" checked={false} onChange={change} /><Toggle label="b" checked disabled onChange={change} /></>))
  const [a, b] = [...host.querySelectorAll<HTMLInputElement>('input')]
  expect([a!.type, a!.getAttribute('role'), a!.className, a!.getAttribute('aria-label')]).toEqual(['checkbox', 'switch', 's-toggle', 'a'])
  await click(a); expect(change).toHaveBeenCalledWith(true); expect(b!.disabled).toBe(true); expect(b!.checked).toBe(true)
})
it('nenhuma aba mostra caixa de marcar crua: ou é chave, ou é o marcador redondo de seleção', async () => {
  await open(); const raw: string[] = []; let toggles = 0
  for (const tab of SETTINGS_TABS) for (const section of tab.sections.length ? tab.sections : ['']) {
    await go(tab.label, section || undefined)
    for (const box of host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
      if (box.classList.contains('s-toggle')) toggles++; else if (!box.classList.contains('s-check')) raw.push(`${tab.id}/${section}: ${box.getAttribute('aria-label')}`)
    }
  }
  expect(raw).toEqual([]); expect(toggles).toBeGreaterThan(20)
})
it('Geral › Sistema: seções com título, divisórias entre elas, e as opções no grupo do palco', async () => {
  await open()
  expect(titles()).toEqual(['Idioma', 'Aparência', 'Energia', 'Encerramento do app'])
  expect(host.querySelectorAll('hr.settings-divider')).toHaveLength(3)
  const keys = [...host.querySelectorAll('.settings-section')].map((s) => [...s.querySelectorAll('[data-option]')].map((o) => o.getAttribute('data-option')))
  expect(keys).toEqual([['appLanguage'], ['appearance', 'pointerCursors'], ['sleepPrevention'], ['confirmBeforeQuitting', 'resumeSessionsOnRelaunch', 'closeToTray']])
  expect(row('appLanguage').querySelector('.settings-hint')).toBeNull()
  for (const key of ['appearance', 'pointerCursors', 'sleepPrevention', 'confirmBeforeQuitting', 'closeToTray']) expect(row(key).querySelector('.settings-hint')?.textContent?.length ?? 0, key).toBeGreaterThan(20)
})
it('o ícone (i) abre a dica sem repetir a descrição abaixo da opção', async () => {
  await open()
  const r = row('resumeSessionsOnRelaunch'), info = r.querySelector<HTMLButtonElement>('.settings-info-button')!
  expect(info.querySelector('svg.lucide-info')).toBeTruthy(); expect(r.querySelector('.settings-hint')).toBeNull(); expect(r.querySelector('[role=tooltip]')).toBeNull()
  await click(info); expect(r.querySelector('[role=tooltip]')!.textContent!.length).toBeGreaterThan(20); expect(info.getAttribute('aria-expanded')).toBe('true')
  await act(async () => info.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(r.querySelector('[role=tooltip]')).toBeNull()
  await go('Geral', 'Tela')
  for (const key of ['cameraMovement', 'focusNodeOnHover', 'rightDragPansCanvas', 'alwaysCopyAttachments']) expect(row(key).querySelector('.settings-info-button'), key).toBeTruthy()
  expect(titles()).toEqual(['Aparência', 'Navegação', 'Anexos'])
})
it('Notificações, Terminal e as demais abas também vêm em seções com título', async () => {
  await open()
  await go('Geral', 'Notificações'); expect(titles()).toEqual(['Selos', 'Notificações do sistema'])
  await go('Geral', 'Ambientes'); expect(titles()).toEqual(['Ambientes'])
  await go('Terminal', 'Aparência'); expect(titles()).toEqual(['Tema', 'Fonte', 'Espaçamento', 'Cursor'])
  await go('Terminal', 'Avançado'); expect(titles()).toEqual(['Sessão', 'Desempenho', 'Entrada'])
  for (const [tab, section] of [['Geral', 'Git'], ['Agentes', 'Contas'], ['Agentes', 'Uso'], ['Atalhos'], ['Dados', 'Armazenamento'], ['Dados', 'Backups'], ['Dados', 'Armazenamento dos Portais'], ['Sobre']] as Array<[string, string?]>) {
    await go(tab, section); expect(titles().length, `${tab}/${section ?? ''}`).toBeGreaterThan(0)
  }
})
it('números usam o contador − valor + e o + grava o passo da opção; o reset vira ícone', async () => {
  await open(); await go('Terminal', 'Aparência')
  const r = row('terminalPaddingVertical'), stepper = r.querySelector('.settings-stepper')!
  expect(stepper).toBeTruthy(); expect(r.querySelector('.settings-reset')).toBeNull()
  await click(stepper.querySelectorAll('button')[1]); expect(set).toHaveBeenLastCalledWith({ terminalPaddingVertical: 2 })
  const reset = row('terminalPaddingVertical').querySelector('.settings-reset')!
  expect(reset.querySelector('svg.lucide-rotate-ccw')).toBeTruthy(); expect(reset.getAttribute('aria-label')).toBeTruthy()
  expect(row('terminalPaddingVertical').querySelectorAll('.settings-stepper button')[0]!.hasAttribute('disabled')).toBe(false)
})
it('toda opção de Geral e Terminal está num grupo e toda descrição existe em inglês', () => {
  const loose = OPTIONS.filter((o) => (o.tab === 'general' || o.tab === 'terminal') && !o.face && !o.group).map((o) => o.key)
  expect(loose).toEqual([])
  const keys = Object.keys(CATALOGS['pt-BR']).filter((k) => k.startsWith('settings.hints.') || k.startsWith('settings.groups.'))
  expect(keys.length).toBeGreaterThan(30); expect(keys.filter((k) => !CATALOGS.en[k])).toEqual([])
})
it('estilo: chave 38×22 azul quando ligada, select sem a seta do sistema e com chevron, título em caixa alta', () => {
  const css = readFileSync('src/renderer/src/settings/settings.css', 'utf8').replace(/\s+/g, ' ')
  expect(css).toMatch(/\.s-toggle \{[^}]*appearance: none[^}]*width: 38px[^}]*height: 22px/)
  expect(css).toMatch(/\.s-toggle:checked \{[^}]*background: var\(--s-primary\)/)
  expect(css).toMatch(/select \{[^}]*appearance: none[^}]*url\("data:image\/svg\+xml/)
  expect(css).toMatch(/\.settings-section-title[^{]*\{[^}]*text-transform: uppercase/)
})
