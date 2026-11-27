// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../../src/renderer/src/settings/SettingsDialog'
import { SETTINGS_TABS } from '../../src/renderer/src/settings/catalog'
import { OPTIONS } from '../../src/renderer/src/settings/options'
import { adoptPreferences, getPreferences, suspendShortcuts } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'
import type { PalcoApi } from '../../src/shared/api'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, api: PalcoApi['preferences']
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  adoptPreferences(defaultPreferences()); suspendShortcuts(false)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api = { get: vi.fn(async () => getPreferences()), set: vi.fn(async patch => { const next = { ...getPreferences(), ...patch }; adoptPreferences(next); return next }), onChange: vi.fn(() => () => {}), bind: vi.fn(), resetShortcuts: vi.fn() } as never
  Object.assign(window, { palco: { about: { info: async () => ({ version: '0.1.0', contact: null, onboardingCompleted: true }) }, gitHosts: { state: async () => ({ directory: '/tmp/providers', providers: [], missing: [] }) }, dataSettings: { state: async () => ({ root: '/tmp/fixture', snapshots: [], backupIntervalMinutes: 60 }) }, accountSettings: { list: async () => [], terminals: async () => [], secureStorage: async () => false }, providers: { list: async () => [] }, workspaces: { sidebar: async () => ({ workspaces: [] }), onSidebar: () => () => {} }, roles: { list: async () => [] }, prompts: { list: async () => ({ items: [], problems: [] }) }, skills: { list: async () => [] }, preferences: api, presets: { list: async () => [{ name: 'Revisor', agent: 'claude' }], roles: async () => [{ name: 'Tech Lead' }] }, accounts: { list: async () => [] }, usage: { get: async()=>[], onChange:()=>()=>{}, refresh: async () => [] } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); adoptPreferences(defaultPreferences()); vi.unstubAllGlobals() })
const click = async (text: string, within: ParentNode = host) => {
  const b = [...within.querySelectorAll<HTMLButtonElement>('button')].find(x => x.textContent === text)
  expect(b, `botão ${text}`).toBeTruthy(); await act(async () => b!.click())
}
const open = async () => { await act(async () => root.render(createElement(SettingsDialog, { onClose: vi.fn() }))) }

it('toda aba e toda sub-aba abre e mostra o título e as opções do inventário', async () => {
  await open()
  for (const tab of SETTINGS_TABS) {
    await click(tab.label)
    const subs = tab.sections.length ? [...tab.sections] : ['']
    for (const section of subs) {
      if (section) await click(section)
      if (tab.id === 'shortcuts') { expect(host.querySelector('.shortcut-table'), 'tabela de atalhos').toBeTruthy(); continue }
      const mine = OPTIONS.filter(o => o.tab === tab.id && o.section === section && !o.face)
      for (const o of mine) { if (o.key === 'usageEnabled') { expect(host.querySelector('[aria-label="Ativar Uso dos Agentes"]')).toBeTruthy(); continue } expect(host.querySelector(`[data-option="${o.key}"]`), `${tab.label}/${section}: ${o.label}`).toBeTruthy() }
      expect(host.querySelector('.settings-content')!.textContent!.length, `${tab.label}/${section} vazia`).toBeGreaterThan(10)
    }
  }
})

it('opção sem efeito vem desabilitada com o motivo; opção pronta é editável', async () => {
  await open(); await click('Tela')
  await click('Ambientes')
  expect(host.querySelector<HTMLInputElement>('[aria-label="WSL"]')!.disabled).toBe(true)
  expect(host.querySelector('[data-option="wslEnabled"] small')!.textContent).toMatch(/só existe no Windows/)
  await click('Tela')
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Estilo das conexões"]')!.disabled).toBe(false)
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Fundo"]')!.disabled).toBe(false)
  const transparent = [...host.querySelectorAll<HTMLOptionElement>('[aria-label="Fundo"] option')].find(o => o.value === 'transparent')!
  expect(transparent.disabled).toBe(true)
})

it('Redefinir (ícone) só existe em Terminal › Aparência; aparece quando o valor difere e regrava o padrão', async () => {
  await open(); await click('Sistema')
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Cursor de mão ao passar o mouse"]')!.click())
  expect(api.set).toHaveBeenCalledWith({ pointerCursors: true })
  expect(host.querySelector('[data-option="pointerCursors"] .settings-reset')).toBeNull() // em Geral o palco não tem reset
  await click('Terminal'); await click('Aparência')
  expect(host.querySelector('[data-option="terminalCursorBlink"] .settings-reset')).toBeNull()
  const blink = host.querySelector<HTMLInputElement>('[data-option="terminalCursorBlink"] input')!, before = blink.checked
  await act(async () => blink.click())
  const reset = host.querySelector<HTMLButtonElement>('[data-option="terminalCursorBlink"] .settings-reset')!
  expect(reset.textContent).toBe('Redefinir para Padrão')
  await act(async () => reset.click())
  expect(api.set).toHaveBeenLastCalledWith({ terminalCursorBlink: before })
})

it('Tela › Personalizar... abre os Padrões de Novos Itens com Notas, Terminais, Portais e Editor de Arquivos', async () => {
  await open(); await click('Tela'); await click('Personalizar...')
  expect([...host.querySelectorAll('[aria-label="Tipos de item"] button')].map(b => b.textContent)).toEqual(['Notas', 'Terminais', 'Portais', 'Editor de Arquivos'])
  expect(host.querySelector('[data-option="defaultNoteColor"]')).toBeTruthy()
  await click('Editor de Arquivos'); expect(host.querySelector('[data-option="fileEditorTabWidth"]')).toBeTruthy()
  await click('‹ Tela'); expect(host.querySelector('[data-option="ropeRouting"]')).toBeTruthy()
})

it('Terminal › Aparência tem as faces Terminal, Chat e Compositor de Prompts', async () => {
  await open(); await click('Terminal'); await click('Aparência')
  expect([...host.querySelectorAll('[aria-label="Aparência"].settings-faces button')].map(b => b.textContent)).toEqual(['Terminal', 'Chat', 'Compositor de Prompts'])
  expect(host.querySelector('[data-option="terminalFontFamily"]')).toBeTruthy()
  await click('Chat'); expect(host.querySelector('[data-option="chatFontSize"]')).toBeTruthy()
  await click('Compositor de Prompts'); expect(host.querySelector('[data-option="promptComposerFontSize"]')).toBeTruthy()
})

it('Wire mostra as cinco sub-abas, desabilitadas com o motivo', async () => {
  await open(); await click('Wire')
  expect([...host.querySelectorAll('.settings-subtabs button')].map(b => b.textContent)).toEqual(['Pareamento', 'Manual', 'Rede', 'Dispositivos', 'Perfil'])
  expect(host.textContent).toContain('Acesso remoto ainda indisponível')
  expect([...host.querySelectorAll<HTMLButtonElement>('.settings-option button')].every(b => b.disabled)).toBe(true)
})
