// @vitest-environment happy-dom
// Paleta de cor (provedor e conta) e menu "…" de Contas, montados DENTRO do diálogo de Configurações:
// o diálogo segura o `pointerdown`, e a aba montada sozinha não reproduz os defeitos.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SettingsDialog } from '../src/renderer/src/settings/SettingsDialog'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'

vi.mock('../src/renderer/src/usage/UsagePanel', () => ({ UsageRings: ({ color }: { color: string }) => <span data-ring={color} /> }))

const settle = () => new Promise((r) => setTimeout(r, 0))
let host: HTMLElement, root: Root, onClose: ReturnType<typeof vi.fn<() => void>>
let setColor: ReturnType<typeof vi.fn<(id: string, color: string | null) => Promise<void>>>
let configure: ReturnType<typeof vi.fn<(area: string, id: string, patch: object) => Promise<void>>>

async function mount(section: 'Uso' | 'Contas'): Promise<void> {
  const accounts = [
    { id: 'a', name: 'Pessoal', agent: 'claude', mode: 'cli', status: 'connected', terminalCount: 0 },
    { id: 'b', name: 'Trabalho', agent: 'claude', mode: 'cli', status: 'connected', terminalCount: 0 }
  ]
  Object.assign(window, { palco: {
    preferences: { get: async () => ({ ...defaultPreferences(), usageEnabled: true }), onChange: () => () => {}, set: async () => defaultPreferences() },
    accountSettings: { list: async () => accounts, setColor, secureStorage: async () => true, terminals: async () => [], check: async (id: string) => accounts.find((a) => a.id === id) },
    providers: { list: async () => [{ id: 'claude', name: 'Claude Code', enabled: true, color: '#D97757', state: 'bundled', spec: { agent: 'claude' }, executablePath: '/test/claude' }], configure },
    usage: { get: async () => [], onChange: () => () => {}, setVisible: async () => {} }
  } })
  await act(async () => { root.render(<SettingsDialog onClose={onClose} at={{ tab: 'agents', section }} />); await settle(); await settle() })
}
const q = <T extends HTMLElement = HTMLElement>(selector: string): T => { const el = host.querySelector<T>(selector); if (!el) throw new Error('não achei ' + selector); return el }
const trigger = (name: string) => q<HTMLButtonElement>(`[aria-label="Cor de ${name}"]`)
const palettes = () => host.querySelectorAll('.provider-palette').length
const click = (el: HTMLElement) => act(async () => { el.click(); await settle() })
const pointerDown = (el: Element) => act(async () => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await settle() })
const key = (k: string) => act(async () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await settle() })
const custom = (name: string) => q<HTMLInputElement>(`[aria-label="Cor personalizada de ${name}"]`)
const emit = (input: HTMLInputElement, type: 'input' | 'change', value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event(type, { bubbles: true })); await settle()
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  adoptPreferences({ ...defaultPreferences(), usageEnabled: true })
  setColor = vi.fn(async () => {}); configure = vi.fn(async () => {}); onClose = vi.fn<() => void>()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("a paleta fica dentro do cartão e visível", () => {
  const css = () => readFileSync(join(process.cwd(), 'src/renderer/src/settings/tabs/accounts-usage.css'), 'utf8')
  it('a lista nunca deixa o conteúdo vazar sobre o rodapé quando a paleta abre', () => {
    expect(css()).not.toMatch(/:has\(\.provider-palette\)\s*\{[^}]*overflow:\s*visible/)
    expect(css()).toMatch(/\.provider-palette\{[^}]*position:fixed/)
  })

  /** happy-dom não faz layout: as caixas são dadas aqui. */
  function layout(triggerTop: number): { scrolled: string[] } {
    const scrolled: string[] = []
    const box = (top: number, height: number, left = 300, width = 660) => ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('usage-providers')) return box(250, 350)
      if (this.classList.contains('settings-content')) return box(140, 560, 260, 760)
      if (this.classList.contains('provider-color-trigger')) return box(triggerTop, 28, 920, 28)
      return box(0, 0, 0, 0)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('provider-palette') ? 150 : 0 })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('provider-palette') ? 130 : 0 })
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: function (this: Element) { scrolled.push(this.className) } })
    return { scrolled }
  }

  it.each(['Trabalho', 'Claude Code'])('%s: perto do fim do cartão a paleta abre para cima; no começo, para baixo', async (name) => {
    await mount('Uso')
    const { scrolled } = layout(560)
    await click(trigger(name))
    const palette = q('.provider-palette')
    expect(palette.style.top).toBe('408px') // 560 - 2 - 150: termina antes do fim do cartão (600)
    expect(palette.style.left).toBe('818px') // alinhada à direita do botão (948 - 130)
    expect(scrolled).toEqual(expect.arrayContaining([expect.stringContaining('provider-color-trigger'), expect.stringContaining('usage-providers')]))
    await click(trigger(name)); vi.restoreAllMocks(); layout(270)
    await click(trigger(name))
    expect(q('.provider-palette').style.top).toBe('300px')
  })

  it('rolar leva a paleta junto; se a bolinha sai da área visível, a paleta fecha', async () => {
    await mount('Uso'); layout(270)
    await click(trigger('Trabalho'))
    vi.restoreAllMocks(); layout(300)
    await act(async () => { q('.usage-providers').dispatchEvent(new Event('scroll')); await settle() })
    expect(q('.provider-palette').style.top).toBe('330px')
    vi.restoreAllMocks(); layout(40)
    await act(async () => { q('.usage-providers').dispatchEvent(new Event('scroll')); await settle() })
    expect(palettes()).toBe(0)
  })
})

describe("o clique fora fecha, dentro do diálogo", () => {
  it.each(['Pessoal', 'Claude Code'])('paleta de %s fecha no clique fora, e o diálogo continua', async (name) => {
    await mount('Uso')
    await click(trigger(name)); expect(palettes()).toBe(1)
    await pointerDown(q('.agent-usage-settings .settings-hint'))
    expect(palettes()).toBe(0); expect(onClose).not.toHaveBeenCalled()
  })
  it('nunca ficam duas paletas abertas', async () => {
    await mount('Uso')
    await click(trigger('Pessoal'))
    await pointerDown(trigger('Claude Code')); await click(trigger('Claude Code'))
    expect(palettes()).toBe(1); expect(q('.provider-palette').getAttribute('aria-label')).toBe('Cores de Claude Code')
  })
  it('o foco saindo pela tecla Tab também fecha a paleta', async () => {
    await mount('Uso')
    await click(trigger('Pessoal'))
    await act(async () => { q('.refresh-all').focus(); await settle() })
    expect(palettes()).toBe(0)
  })
  it('Escape com o foco na bolinha fecha só a paleta', async () => {
    await mount('Uso')
    await click(trigger('Pessoal')); await act(async () => { trigger('Pessoal').focus() })
    await key('Escape')
    expect(palettes()).toBe(0); expect(onClose).not.toHaveBeenCalled()
  })
  it('o menu … de Contas fecha no clique fora', async () => {
    await mount('Contas')
    await click(q('.account-menu > button')); expect(host.querySelector('.account-menu [role=menu]')).not.toBeNull()
    await pointerDown(q('.settings-agent-library .settings-hint'))
    expect(host.querySelector('.account-menu [role=menu]')).toBeNull(); expect(onClose).not.toHaveBeenCalled()
  })
})

describe("o foco volta para a bolinha ao escolher", () => {
  it.each([['Pessoal', '[aria-label="Cor #4285F4"]'], ['Pessoal', '.account-color-inherit'], ['Claude Code', '[aria-label="Cor #4285F4"]']])('%s (%s): foco na bolinha enquanto grava e depois', async (name, option) => {
    let done = (): void => {}
    const pending = () => new Promise<void>((r) => { done = r })
    setColor.mockImplementation(pending); configure.mockImplementation(pending)
    await mount('Uso')
    await click(trigger(name)); await click(q(`.provider-palette ${option}`))
    // Um botão desabilitado perde o foco no Chromium: enquanto grava ele fica habilitado, mas não reabre.
    expect(trigger(name).disabled).toBe(false); expect(document.activeElement).toBe(trigger(name))
    await click(trigger(name)); expect(palettes()).toBe(0)
    await act(async () => { done(); await settle() })
    expect(document.activeElement).toBe(trigger(name))
    await click(trigger(name)); expect(palettes()).toBe(1)
  })
})

describe("a cor personalizada vale no fechamento do seletor", () => {
  const saved = (name: string) => name === 'Claude Code' ? configure.mock.calls.map((c) => (c[2] as { color: string }).color) : setColor.mock.calls.map((c) => c[1])
  it.each(['Trabalho', 'Claude Code'])('%s: enquanto arrasta não grava; no change grava só o último valor', async (name) => {
    await mount('Uso')
    await click(trigger(name))
    const input = custom(name)
    await emit(input, 'input', '#111111'); await emit(input, 'input', '#22cc88')
    expect(input.isConnected).toBe(true); expect(saved(name)).toEqual([])
    await emit(input, 'change', '#22cc88')
    expect(saved(name)).toEqual(['#22cc88']); expect(palettes()).toBe(0); expect(document.activeElement).toBe(trigger(name))
  })
  it('clique fora com um valor ainda sem change grava o que estava escolhido, uma vez', async () => {
    await mount('Uso')
    await click(trigger('Trabalho')); await emit(custom('Trabalho'), 'input', '#abcdef')
    await pointerDown(q('.agent-usage-settings .settings-hint'))
    expect(setColor.mock.calls).toEqual([['b', '#abcdef']])
  })
  // Escape dentro do seletor nativo: ele reverte com um `input` da cor original e não manda `change`.
  it('voltar à cor original no seletor não grava nada: a conta que herda continua herdando', async () => {
    await mount('Uso')
    await click(trigger('Trabalho')); await emit(custom('Trabalho'), 'input', '#abcdef'); await emit(custom('Trabalho'), 'input', '#d97757')
    await pointerDown(q('.agent-usage-settings .settings-hint'))
    expect(setColor).not.toHaveBeenCalled(); expect(palettes()).toBe(0)
  })
  it('Escape descarta o valor ainda sem change', async () => {
    await mount('Uso')
    await click(trigger('Trabalho')); await emit(custom('Trabalho'), 'input', '#abcdef')
    await act(async () => { custom('Trabalho').focus() }); await key('Escape')
    expect(setColor).not.toHaveBeenCalled(); expect(palettes()).toBe(0)
  })
})
