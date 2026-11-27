// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/src/settings/SettingsDialog'
import { adoptPreferences, getPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const close = vi.fn()
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); close.mockClear(); adoptPreferences(defaultPreferences())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Object.assign(window, { palco: { preferences: { get: async () => getPreferences(), set: vi.fn(), onChange: () => () => {} } } })
  await act(async () => root.render(<SettingsDialog onClose={close} />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const dialog = () => host.querySelector<HTMLElement>('.settings-dialog')!
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('.settings-tabs [role=tab]')]

it('sem título visível nem "Concluir": o nome é só para leitor de tela e um X no canto fecha', async () => {
  expect(dialog().getAttribute('aria-label')).toBe('Configurações')
  expect(dialog().querySelector('h1')).toBeNull()
  expect([...dialog().querySelectorAll('button')].some((b) => b.textContent === 'Concluir')).toBe(false)
  const x = dialog().querySelector<HTMLButtonElement>('header button')!
  expect(x.getAttribute('aria-label')).toBe('Fechar'); expect(x.querySelector('svg.lucide-x')).toBeTruthy()
  await act(async () => x.click()); expect(close).toHaveBeenCalledTimes(1)
  expect(dialog().querySelectorAll('header button')).toHaveLength(1) // o onboarding fecha a janela por este botão
})
it('abas em cima, cada uma com o ícone acima do rótulo, na ordem do palco sem Licença e Atualizações', () => {
  expect(tabs().map((t) => t.textContent)).toEqual(['Geral', 'Terminal', 'Agentes', 'Atalhos', 'Wire', 'Dados', 'Sobre'])
  const icons = ['sliders-horizontal', 'square-terminal', 'bot', 'keyboard', 'waypoints', 'hard-drive', 'info']
  tabs().forEach((tab, i) => { const first = tab.firstElementChild!; expect(first.tagName.toLowerCase()).toBe('svg'); expect(first.getAttribute('class')).toContain(`lucide-${icons[i]}`) })
  expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true')
})
it('sub-abas num controle segmentado centralizado; a escolhida fica marcada', async () => {
  const nav = host.querySelector('.settings-subtabs')!, track = nav.querySelector('.settings-segmented')!
  expect(track).toBeTruthy()
  const items = [...track.querySelectorAll('button')]
  expect(items.map((b) => b.textContent)).toEqual(['Sistema', 'Tela', 'Notificações', 'Ambientes', 'Git'])
  expect(items.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false'])
})
it('medidas e cores do palco: janela 760×640, abas empilhadas, aba ativa com fundo e trilho segmentado', () => {
  const css = readFileSync('src/renderer/src/settings/settings.css', 'utf8').replace(/\s+/g, ' ')
  expect(css).toMatch(/\.settings-dialog \{[^}]*width: min\(760px[^}]*height: min\(640px, 86vh\)/)
  expect(css).toContain('--s-bg: #202022'); expect(css).toContain('--s-active: #303032'); expect(css).toContain('--s-track: #3c3c3d')
  expect(css).toMatch(/\.settings-tabs button \{[^}]*flex-direction: column[^}]*font-size: 11px/)
  expect(css).toMatch(/\.settings-tabs button\[aria-selected=true\] \{[^}]*background: var\(--s-active\)[^}]*color: var\(--s-primary\)/)
  expect(css).toMatch(/\.settings-segmented \{[^}]*background: var\(--s-track\)/)
})
