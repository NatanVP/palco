// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../../src/renderer/src/settings/SettingsDialog'
import { adoptPreferences, getPreferences, suspendShortcuts } from '../../src/renderer/src/settings/preferences'
import { OPTIONS } from '../../src/renderer/src/settings/options'
import { defaultPreferences } from '../../src/shared/preferences'
import { BUILTIN_PRESETS } from '../../src/main/agents/presets'
import type { Preset } from '../../src/shared/model'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, set: ReturnType<typeof vi.fn>, presets: Preset[], memoryAbove: number
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  adoptPreferences(defaultPreferences()); suspendShortcuts(false); memoryAbove = 0
  presets = [{ name: 'Revisor', agent: 'claude', command: 'claude' }]
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  set = vi.fn(async patch => { const next = { ...getPreferences(), ...patch }; adoptPreferences(next); return next })
  const missing = () => BUILTIN_PRESETS.filter(b => !presets.some(p => p.name === b.name)).map(b => ({ ...b }))
  Object.assign(window, { palco: {
    preferences: { get: async () => getPreferences(), set, onChange: () => () => {}, bind: vi.fn(), resetShortcuts: vi.fn() },
    terminal: { countAboveMemory: vi.fn(async () => memoryAbove) },
    presets: {
      list: vi.fn(async () => structuredClone(presets)), roles: async () => [],
      create: vi.fn(async p => { presets.push({ agent: 'claude', command: '', ...p } as Preset); return presets.at(-1)! }),
      set: vi.fn(async (name, patch) => { const p = presets.find(x => x.name === name)!; if (patch.newName) p.name = patch.newName; if (patch.quickStart !== undefined) p.quickStart = patch.quickStart; if (patch.command !== undefined) p.command = patch.command; return p }),
      remove: vi.fn(async name => { presets = presets.filter(p => p.name !== name) }),
      reorder: vi.fn(async names => { presets = names.map((n: string) => presets.find(p => p.name === n)!) }),
      restoreDefaults: vi.fn(async () => { presets = [...missing(), ...presets] }), missingDefaults: vi.fn(async () => missing())
    }
  } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); adoptPreferences(defaultPreferences()); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = async (text: string, within: ParentNode = host) => {
  const b = [...within.querySelectorAll<HTMLButtonElement>('button')].find(x => x.textContent === text)
  expect(b, `botão ${text}`).toBeTruthy(); await act(async () => b!.click()); await flush()
}
const byLabel = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!
const open = async (...path: string[]) => { await act(async () => root.render(createElement(SettingsDialog, { onClose: vi.fn() }))); for (const p of path) await click(p) }

it('Tema: quatro cartões; Escuro e Claro gravam as bases, Sistema volta ao padrão', async () => {
  await open('Terminal', 'Aparência')
  expect([...host.querySelectorAll('[aria-label="Tema"] button')].map(b => b.textContent)).toEqual(['Sistema', 'Escuro', 'Claro', 'Personalizado'])
  expect(byLabel('Tema').querySelector('[aria-pressed="true"]')!.textContent).toBe('Sistema')
  await click('Escuro', byLabel('Tema')); expect(set).toHaveBeenLastCalledWith({ defaultTerminalTheme: 'palco-dark', defaultTerminalDarkThemeId: null })
  await click('Claro', byLabel('Tema')); expect(set).toHaveBeenLastCalledWith({ defaultTerminalTheme: 'palco-light', defaultTerminalDarkThemeId: null })
  expect(byLabel('Tema').querySelector('[aria-pressed="true"]')!.textContent).toBe('Claro')
  await click('Redefinir para Padrão', host.querySelector('[data-option="defaultTerminalTheme"]')!)
  expect(set).toHaveBeenLastCalledWith({ defaultTerminalTheme: 'system', defaultTerminalDarkThemeId: null })
})

it('Tema Personalizado: 17 temas, Concluído só com escolha, Cancelar e Fechar não gravam', async () => {
  await open('Terminal', 'Aparência'); await click('Personalizado', byLabel('Tema'))
  const modal = byLabel('Tema Personalizado')
  expect(modal.querySelectorAll('[data-theme-id]')).toHaveLength(17)
  const done = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Concluído')!
  expect(done.disabled).toBe(true)
  await click('Cancelar', modal); expect(set).not.toHaveBeenCalled(); expect(byLabel('Tema Personalizado')).toBeNull()
  await click('Personalizado', byLabel('Tema')); await click('Fechar', byLabel('Tema Personalizado')); expect(set).not.toHaveBeenCalled()
  await click('Personalizado', byLabel('Tema'))
  await act(async () => byLabel('Tema Personalizado').querySelector<HTMLElement>('[data-theme-id="dracula"]')!.click())
  await click('Concluído', byLabel('Tema Personalizado'))
  expect(set).toHaveBeenLastCalledWith({ defaultTerminalTheme: 'dracula', defaultTerminalDarkThemeId: null })
  expect(byLabel('Tema').querySelector('[aria-pressed="true"]')!.textContent).toBe('Personalizado')
})

it('Seguir aparência do sistema: escolhe um tema claro e um escuro; só conclui com os dois', async () => {
  await open('Terminal', 'Aparência'); await click('Personalizado', byLabel('Tema'))
  const modal = () => byLabel('Tema Personalizado')
  await act(async () => (modal().querySelector('input[aria-label="Seguir aparência do sistema"]') as HTMLInputElement).click())
  const ids = () => [...modal().querySelectorAll('[data-theme-id]')].map(e => e.getAttribute('data-theme-id')!).sort()
  expect(ids()).toEqual(['catppuccin-latte', 'gruvbox-light', 'palco-dark', 'palco-light', 'rose-pine-dawn', 'solarized-light', 'tokyo-night-day'])
  await click('Claro', modal()); await act(async () => modal().querySelector<HTMLElement>('[data-theme-id="gruvbox-light"]')!.click())
  expect([...modal().querySelectorAll('button')].find(b => b.textContent === 'Concluído')!.disabled).toBe(true)
  await click('Escuro', modal()); expect(ids()).toHaveLength(12); expect(ids()).toContain('palco-light')
  await act(async () => modal().querySelector<HTMLElement>('[data-theme-id="gruvbox-dark"]')!.click())
  await click('Concluído', modal())
  expect(set).toHaveBeenLastCalledWith({ defaultTerminalTheme: 'gruvbox-light', defaultTerminalDarkThemeId: 'gruvbox-dark' })
})

it('espaçamento: os dois resets existem; o horizontal devolve a herança do sistema', async () => {
  await open('Terminal', 'Aparência')
  expect(byLabel('Redefinir o espaçamento horizontal para o valor do sistema')).toBeNull()
  await act(async () => adoptPreferences({ ...getPreferences(), terminalPaddingHorizontal: 8, usesSystemHorizontalTerminalPadding: false, terminalPaddingVertical: 6 })); await flush()
  await act(async () => byLabel('Redefinir o espaçamento horizontal para o valor do sistema').click()); await flush()
  expect(set).toHaveBeenLastCalledWith({ terminalPaddingHorizontal: 0, usesSystemHorizontalTerminalPadding: true })
  await act(async () => byLabel('Redefinir o espaçamento vertical para zero').click()); await flush()
  expect(set).toHaveBeenLastCalledWith({ terminalPaddingVertical: 0 })
})

it('fonte: o reset zera só família e tamanho', async () => {
  await open('Terminal', 'Aparência')
  await act(async () => adoptPreferences({ ...getPreferences(), terminalFontSize: 20, terminalCursorBlink: false })); await flush()
  await click('Redefinir para Padrão', host.querySelector('.font-reset')!)
  expect(set).toHaveBeenLastCalledWith({ terminalFontFamily: defaultPreferences().terminalFontFamily, terminalFontSize: 13 })
})

it('limite de memória: ligar e editar valem; baixar o limite com terminais acima pede confirmação', async () => {
  await open('Terminal', 'Avançado')
  expect(OPTIONS.filter(o => o.section === 'Avançado' && o.key !== 'preferredShellPath').every(o => o.ready)).toBe(true)
  await act(async () => adoptPreferences({ ...getPreferences(), memoryLimitEnabled: true, memoryLimitMB: 4096 })); await flush()
  memoryAbove = 2
  const input = byLabel('Limite (MB) (MB)') as HTMLInputElement
  const leave = async () => { input.value = '1024'; await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }); await flush() }
  await leave()
  expect(set).not.toHaveBeenCalled()
  expect(byLabel('Reduzir o limite de memória?').textContent).toContain('2 terminais')
  await click('Cancelar', byLabel('Reduzir o limite de memória?')); expect(set).not.toHaveBeenCalled()
  await leave()
  await click('Reduzir Limite', byLabel('Reduzir o limite de memória?'))
  expect(set).toHaveBeenLastCalledWith({ memoryLimitMB: 1024 })
})

it('Shell só aparece como opção do Windows: desabilitado com o motivo no Linux', async () => {
  await open('Terminal', 'Avançado')
  expect(host.querySelector('[data-option="preferredShellPath"] small')!.textContent).toMatch(/Windows/)
})

it('Início Rápido: lista, liga/desliga, reordena, exclui com confirmação e restaura os embutidos', async () => {
  await open('Terminal', 'Início Rápido')
  expect(host.textContent).toContain('Até 10 presets ativos aparecem ao criar um terminal.')
  const rows = () => [...host.querySelectorAll('[data-preset]')].map(r => r.getAttribute('data-preset'))
  expect(rows()).toEqual([...BUILTIN_PRESETS.map(b => b.name), 'Revisor'])
  await act(async () => byLabel('Alternar Revisor como preset ativo').click()); await flush()
  expect(window.palco.presets.set).toHaveBeenCalledWith('Revisor', { quickStart: false })
  await act(async () => byLabel('Mover Revisor para cima').click()); await flush()
  expect(rows().slice(-2)).toEqual(['Revisor', 'Shell'])
  await act(async () => byLabel('Excluir Revisor').click()); await flush()
  await click('Excluir', byLabel('Excluir preset?')); expect(window.palco.presets.remove).toHaveBeenCalledWith('Revisor')
  expect(rows()).not.toContain('Revisor')
})

it('Início Rápido: Adicionar Preset abre o formulário e cria; o limite de 10 desabilita ligar o 11º', async () => {
  await open('Terminal', 'Início Rápido')
  await click('Adicionar Preset')
  const form = byLabel('Novo Preset')
  const name = form.querySelector<HTMLInputElement>('input[aria-label="Nome do Preset"]')!, cmd = form.querySelector<HTMLInputElement>('input[aria-label="Comando"]')!
  const type = async (el: HTMLInputElement, v: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await type(name, 'Aider'); await type(cmd, 'aider'); await click('Salvar', form)
  expect(window.palco.presets.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Aider', command: 'aider' }))
  expect(host.querySelector('[data-preset="Aider"]')).toBeTruthy()
})
