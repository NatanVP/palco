// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileTreeView } from '../../src/renderer/src/nodes/FileTreeView'
import { OPTIONS } from '../../src/renderer/src/settings/options'
import { adoptPreferences } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, files: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  files = { list: vi.fn(async () => [{ name: 'src', dir: true }, { name: 'a.txt', dir: false }]), trash: vi.fn(async () => {}), rename: vi.fn(async (_p: string, n: string) => `/r/${n}`) }
  Object.assign(window, { palco: { files } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.querySelectorAll('.tree-menu, .tree-menu-back').forEach(e => e.remove()); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const mount = async () => { await act(async () => root.render(createElement(FileTreeView, { root: '/r', onOpenFile: vi.fn() }))); await flush() }
const row = (name: string) => [...host.querySelectorAll<HTMLElement>('.tree-row')].find(r => r.textContent === name)!
const rightClick = async (name: string) => { await act(async () => row(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))); await flush() }
const item = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>('.tree-menu button')].find(b => b.textContent === label)!

it('"Confirmar antes de excluir arquivos" está ativa na janela', () => { expect(OPTIONS.find(o => o.key === 'confirmFileDelete')?.ready).toBe(true) })
it('botão direito abre o menu; Copiar Caminho copia o caminho completo', async () => {
  const write = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
  await mount(); await rightClick('a.txt'); expect([...document.body.querySelectorAll('.tree-menu button')].map(b => b.textContent)).toEqual(['Copiar Caminho', 'Renomear…', 'Mover para a Lixeira'])
  await act(async () => item('Copiar Caminho').click()); expect(write).toHaveBeenCalledWith('/r/a.txt'); expect(document.body.querySelector('.tree-menu')).toBeNull()
})
it('com a confirmação ligada (padrão), excluir pergunta antes; Cancelar não manda nada', async () => {
  await mount(); await rightClick('a.txt'); await act(async () => item('Mover para a Lixeira').click()); await flush()
  expect(host.querySelector('[aria-label="Mover para a Lixeira?"]')?.textContent).toContain('a.txt'); expect(files.trash).not.toHaveBeenCalled()
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.tree-confirm button')].find(b => b.textContent === 'Cancelar')!.click()); expect(files.trash).not.toHaveBeenCalled()
  await rightClick('a.txt'); await act(async () => item('Mover para a Lixeira').click()); await act(async () => host.querySelector<HTMLButtonElement>('.tree-confirm .danger')!.click()); await flush()
  expect(files.trash).toHaveBeenCalledWith('/r/a.txt'); expect(files.list).toHaveBeenCalledTimes(2)
})
it('com a confirmação desligada, vai direto para a lixeira', async () => {
  adoptPreferences({ ...defaultPreferences(), confirmFileDelete: false }); await mount(); await rightClick('a.txt'); await act(async () => item('Mover para a Lixeira').click()); await flush()
  expect(files.trash).toHaveBeenCalledWith('/r/a.txt'); expect(host.querySelector('.tree-confirm')).toBeNull()
})
it('renomear em linha: Enter grava e recarrega; Esc cancela; erro do main aparece', async () => {
  await mount(); await rightClick('a.txt'); await act(async () => item('Renomear…').click()); await flush()
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Novo nome"]')!; expect(input.value).toBe('a.txt')
  input.value = 'b.txt'; await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); await flush()
  expect(files.rename).toHaveBeenCalledWith('/r/a.txt', 'b.txt')
  files.rename!.mockRejectedValueOnce(new Error("Error invoking remote method 'x': Error: já existe um arquivo com esse nome"))
  await rightClick('a.txt'); await act(async () => item('Renomear…').click()); await flush(); const i2 = host.querySelector<HTMLInputElement>('input[aria-label="Novo nome"]')!; i2.value = 'c.txt'
  await act(async () => i2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); await flush(); expect(host.querySelector('[role="alert"]')?.textContent).toBe('já existe um arquivo com esse nome')
  await rightClick('a.txt'); await act(async () => item('Renomear…').click()); await act(async () => host.querySelector('input[aria-label="Novo nome"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(host.querySelector('input[aria-label="Novo nome"]')).toBeNull()
})
