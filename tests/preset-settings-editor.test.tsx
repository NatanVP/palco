// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/src/settings/SettingsDialog'
import { adoptPreferences, getPreferences, suspendShortcuts } from '../src/renderer/src/settings/preferences'
import { quickStartTiles, quickTileForm, emptyForm, toNewNode } from '../src/renderer/src/dialogs/new-terminal'
import { PICKER_ICONS } from '../src/renderer/src/settings/tabs/preset-editor'
import { lucideIcon } from '../src/renderer/src/nodes/terminal-icons'
import { AgentCatalog, BUILTIN_PRESETS, PresetStore } from '../src/main/agents/presets'
import { RoleStore } from '../src/main/agents/roles'
import { presetIcon } from '../src/shared/presets'
import { defaultPreferences } from '../src/shared/preferences'
import type { Preset } from '../src/shared/model'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, presets: Preset[], api: Record<string, ReturnType<typeof vi.fn>>
const close = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); suspendShortcuts(false); close.mockClear()
  presets = BUILTIN_PRESETS.map((p) => ({ ...p }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api = {
    list: vi.fn(async () => structuredClone(presets)), roles: vi.fn(async () => []),
    create: vi.fn(async (p) => { presets.push({ agent: 'other', command: '', ...p } as Preset); return presets.at(-1)! }),
    set: vi.fn(async (name, patch) => { const p = presets.find((x) => x.name === name)!; const { newName, ...rest } = patch; Object.assign(p, rest); if (newName) p.name = newName; return p }),
    remove: vi.fn(async (name) => { presets = presets.filter((p) => p.name !== name) }),
    reorder: vi.fn(async (names: string[]) => { presets = names.map((n: string) => presets.find((p) => p.name === n)!) }),
    restoreDefaults: vi.fn(async () => {}), resetDefaults: vi.fn(async () => { presets = BUILTIN_PRESETS.map((p) => ({ ...p })) }), missingDefaults: vi.fn(async () => [])
  }
  Object.assign(window, { palco: { preferences: { get: async () => getPreferences(), set: vi.fn(), onChange: () => () => {} }, presets: api } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); await flush() }
const q = <T extends Element = HTMLElement>(s: string): T => host.querySelector(s) as unknown as T
const label = (text: string) => q(`[aria-label="${text}"]`)
const byText = (text: string, within: ParentNode = host) => [...within.querySelectorAll('button')].find((b) => b.textContent === text)
const type = async (el: HTMLInputElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
const open = async () => { await act(async () => root.render(<SettingsDialog onClose={close} at={{ tab: 'terminal', section: 'Início Rápido' }} />)); await flush() }

it('ícones padrão são os do palco e todos os da grade existem no lucide', () => {
  expect(BUILTIN_PRESETS.map((p) => presetIcon(p))).toEqual(['badge-check', 'brain', 'sparkle', 'rectangle-vertical', 'terminal'])
  expect(presetIcon({ name: 'Meu', agent: 'other' })).toBe('terminal'); expect(presetIcon({ name: 'x', agent: 'claude', appearance: { icon: 'rocket' } })).toBe('rocket')
  expect(PICKER_ICONS).toHaveLength(40); expect(PICKER_ICONS.filter((n) => !lucideIcon(n))).toEqual([])
})
it('lista num cartão: marcador de ativo, ícone, nome e comando; ações só em ícone; rodapé com Adicionar e Redefinir', async () => {
  await open()
  expect(q('.settings-section-title').textContent).toBe('Presets de Início Rápido')
  const rows = [...host.querySelectorAll('.preset-card > li')]
  expect(rows.map((r) => r.getAttribute('data-preset'))).toEqual(['Claude Code', 'Codex', 'Antigravity', 'OpenCode', 'Shell'])
  const first = rows[0]!
  const mark = first.querySelector('[role=checkbox]')!; expect(mark.getAttribute('aria-checked')).toBe('true'); expect(mark.querySelector('svg.lucide-circle-check')).toBeTruthy()
  expect(first.querySelector('.preset-icon svg.lucide-badge-check')).toBeTruthy()
  expect(first.querySelector('.preset-name')!.textContent).toBe('Claude Code'); expect(first.querySelector('.preset-command')!.textContent).toBe('claude')
  expect(rows[4]!.querySelector('.preset-command')).toBeNull()
  const actions = [...first.querySelectorAll('.preset-actions button')]
  expect(actions.map((b) => b.textContent)).toEqual(['', '', '', ''])
  expect(actions.map((b) => b.querySelector('svg')!.getAttribute('class')!.match(/lucide-(chevron-up|chevron-down|square-pen|trash-2)/)![1])).toEqual(['chevron-up', 'chevron-down', 'square-pen', 'trash-2'])
  expect((actions[0] as HTMLButtonElement).disabled).toBe(true)
  await click(mark); expect(api.set).toHaveBeenLastCalledWith('Claude Code', { quickStart: false })
  expect(label('Alternar Claude Code como preset ativo').querySelector('svg.lucide-circle')).toBeTruthy()
  await click(label('Mover Codex para cima')); expect(api.reorder).toHaveBeenLastCalledWith(['Codex', 'Claude Code', 'Antigravity', 'OpenCode', 'Shell'])
  expect(byText('Adicionar Preset')!.closest('.preset-footer')).toBeTruthy(); expect(byText('Redefinir para Padrão')!.closest('.preset-footer')).toBeTruthy()
})
it('Redefinir para Padrão pede confirmação e só então volta à lista integrada', async () => {
  presets.push({ name: 'Meu', agent: 'other', command: 'aider' }); await open()
  await click(byText('Redefinir para Padrão')); expect(api.resetDefaults).not.toHaveBeenCalled()
  await click(byText('Redefinir', q('[role=alertdialog]'))); expect(api.resetDefaults).toHaveBeenCalledTimes(1)
  expect(q('[data-preset="Meu"]')).toBeNull()
})
it('Editar abre dentro da aba (sem modal), com Detalhes: Nome, Comando, Maestro com chave, Cancelar e Salvar', async () => {
  await open(); await click(label('Editar Claude Code'))
  const editor = q('.preset-editor')
  expect(editor.closest('[role=tabpanel]')).toBeTruthy(); expect(host.querySelector('.settings-confirm-back')).toBeNull(); expect(host.querySelector('.preset-card')).toBeNull()
  expect(editor.querySelector('h3')!.textContent).toBe('Editar Preset')
  expect([...editor.querySelectorAll('.preset-editor-tabs button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Detalhes', 'true'], ['Aparência', 'false']])
  expect(label('Nome do Preset')).toBeTruthy(); expect((label('Comando') as HTMLInputElement).value).toBe('claude')
  const maestro = label('Modo Maestro') as HTMLInputElement; expect(maestro.getAttribute('role')).toBe('switch')
  expect(editor.querySelector('.preset-maestro svg.lucide-wand-sparkles')).toBeTruthy(); expect(editor.querySelector('.preset-maestro .settings-info-button')).toBeTruthy(); expect(editor.querySelector('.preset-maestro .settings-hint')!.textContent!.length).toBeGreaterThan(20)
  expect([...editor.querySelectorAll('.preset-editor-footer button')].map((b) => b.textContent)).toEqual(['Cancelar', 'Salvar'])
  await click(byText('Cancelar', editor)); expect(q('.preset-card')).toBeTruthy(); expect(api.set).not.toHaveBeenCalled()
})
it('Esc no editor volta para a lista sem fechar as Configurações', async () => {
  await open(); await click(label('Editar Codex'))
  await act(async () => (label('Nome do Preset') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(host.querySelector('.preset-editor')).toBeNull(); expect(close).not.toHaveBeenCalled(); expect(q('.preset-card')).toBeTruthy()
})
it('Aparência: grade de ícones com emoji, cores com arco-íris, Terminal/Chat, quatro cartões de tema e prévia; salvar guarda no preset', async () => {
  await open(); await click(label('Editar Claude Code')); await click(byText('Aparência', q('.preset-editor-tabs')))
  const grid = q('.preset-icon-grid')
  expect(grid.querySelectorAll('button')).toHaveLength(41); expect(grid.querySelector('button')!.textContent).toBe('😀')
  expect(grid.querySelector('[aria-pressed=true]')!.getAttribute('aria-label')).toBe('badge-check')
  expect(host.querySelectorAll('.preset-colors button')).toHaveLength(8); expect(host.querySelector('.preset-colors .preset-rainbow input[type=color]')).toBeTruthy()
  expect(q('.preset-colors button[aria-pressed=true]').getAttribute('aria-label')).toBe('Azul')
  expect([...host.querySelectorAll('.preset-faces button')].map((b) => b.textContent)).toEqual(['Terminal', 'Chat'])
  expect([...host.querySelectorAll('[aria-label="Tema"] button')].map((b) => b.textContent)).toEqual(['Sistema', 'Escuro', 'Claro', 'Personalizado'])
  expect(host.querySelector('.theme-preview')).toBeTruthy()
  await click(grid.querySelector('button[aria-label="rocket"]') ?? grid.querySelector('button[aria-label="flag"]'))
  await click(label('Verde')); await click(byText('Claro', label('Tema')))
  await click(byText('Chat', q('.preset-faces')))
  await click(label('Iniciar no Modo de Chat'))
  await click(byText('Salvar'))
  expect(api.set).toHaveBeenLastCalledWith('Claude Code', { newName: 'Claude Code', command: 'claude', maestro: false, startInChat: true, appearance: { icon: 'flag', color: '#34C759', themeId: 'palco-light' } })
})
it('o que não foi mudado continua herdando; o emoji vira o ícone; voltar ao tema global tira o tema do preset', async () => {
  await open(); await click(byText('Adicionar Preset'))
  expect(q('.preset-editor h3').textContent).toBe('Novo Preset'); expect((byText('Salvar') as HTMLButtonElement).disabled).toBe(true)
  await type(label('Nome do Preset') as HTMLInputElement, 'Aider'); await type(label('Comando') as HTMLInputElement, 'aider')
  await click(byText('Aparência', q('.preset-editor-tabs'))); await click(q('.preset-icon-grid button')); await type(label('Emoji') as HTMLInputElement, '🦀'); await click(byText('Usar'))
  await click(byText('Claro', label('Tema'))); await click(byText('Sistema', label('Tema')))
  await click(byText('Salvar'))
  expect(api.create).toHaveBeenLastCalledWith({ name: 'Aider', command: 'aider', appearance: { icon: '🦀' } })
})
it('vale no terminal criado: o Início Rápido mostra e aplica ícone, cor e tema do preset', () => {
  const mine: Preset = { name: 'Claude Code', agent: 'claude', command: 'claude', appearance: { icon: 'rocket', color: '#34C759', themeId: 'dracula' } }
  const tiles = quickStartTiles([mine])
  expect(tiles.find((t) => t.name === 'Claude Code')!.icon).toBe('rocket'); expect(tiles.find((t) => t.name === 'Codex')!.icon).toBe('brain')
  const form = { ...emptyForm(), ...quickTileForm(tiles.find((t) => t.name === 'Claude Code')!, []) }
  expect(toNewNode(form, { pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } }, null, [])).toMatchObject({ icon: 'rocket', color: '#34C759', themeId: 'dracula' })
  // escolher outro preset sem aparência não pode herdar a cor do anterior
  const next = { ...form, ...quickTileForm(tiles.find((t) => t.name === 'Codex')!, []) }
  expect([next.icon, next.color, next.themeId]).toEqual(['brain', '#007AFF', undefined])
})
it('vale no terminal criado pelo CLI (recruit --preset) e Redefinir apaga os personalizados no main', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palco-preset-'))
  try {
    const roles = new RoleStore(join(dir, 'roles')), store = new PresetStore(join(dir, 'presets.json'), roles)
    store.create({ name: 'Visual', command: 'claude', appearance: { icon: 'rocket', color: '#34C759', themeId: 'dracula', fontSize: 15 } })
    expect(new AgentCatalog(store, roles).recruit({ preset: 'Visual' }).look).toEqual({ icon: 'rocket', color: '#34C759', themeId: 'dracula', fontSize: 15 })
    store.resetDefaults(); expect(store.list().map((p) => p.name)).toEqual(BUILTIN_PRESETS.map((p) => p.name))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('os quatro cartões de tema ocupam a largura toda: grade de 4 colunas, prévia embaixo, sem a regra antiga em linha', () => {
  const css = readFileSync('src/renderer/src/settings/settings.css', 'utf8').replace(/\s+/g, ' '), global = readFileSync('src/renderer/src/styles.css', 'utf8')
  expect(css).toMatch(/\.theme-picker \{[^}]*flex-direction: column[^}]*width: 100%/)
  expect(css).toMatch(/\.theme-cards \{[^}]*display: grid[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
  // era isto que punha cartões e prévia lado a lado, pequenos e centralizados
  expect(global).not.toMatch(/^\.theme-(picker|cards) \{ display: flex/m)
})
