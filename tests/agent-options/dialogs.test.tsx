// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NewTerminalDialog } from '../../src/renderer/src/dialogs/NewTerminalDialog'
import { EditTerminalDialog } from '../../src/renderer/src/dialogs/EditTerminalDialog'
import { PresetEditor } from '../../src/renderer/src/settings/tabs/preset-editor'
import { adoptPreferences } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'
import type { TerminalNode } from '../../src/shared/model'
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const reconfigure = vi.fn(async () => {})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); reconfigure.mockClear()
  Object.assign(window, { palco: { presets: { roles: async () => [], list: async () => [] }, accountSettings: { list: async () => [] }, terminal: { reconfigure, resolveAgent: async (command: string) => ({ agent: command.startsWith('codex') ? 'codex' : 'claude', wrapper: false, forwardsArgs: true }) }, files: { exists: async () => true } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const type = async (el: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
const toggle = async (flag: string) => act(async () => host.querySelector<HTMLInputElement>(`[role=switch][aria-label="${flag}"]`)!.click())
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
it('Novo Terminal cria com a opção escolhida no comando final', async () => {
  const create = vi.fn(async () => null)
  await act(async () => root.render(<NewTerminalDialog sizeLabel={null} onCancel={() => {}} onCreate={create} />))
  await type(host.querySelector<HTMLInputElement>('input[placeholder*="claude"]')!, 'claude')
  await toggle('--verbose')
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ command: 'claude --verbose' }))
})
it('Editar Terminal confirma o reinício com as opções atualizadas', async () => {
  const node = { id: 't', name: 'Terminal', agent: 'codex', command: 'codex', cwd: '', kind: 'terminal' } as TerminalNode
  await act(async () => root.render(<EditTerminalDialog node={node} onClose={() => {}} onError={() => {}} />))
  await toggle('--search')
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(reconfigure).not.toHaveBeenCalled()
  await act(async () => button('Reiniciar').click())
  expect(reconfigure).toHaveBeenCalledWith('t', { command: 'codex --search', cwd: '', agent: 'codex' }, expect.anything())
})
it('o editor de preset salva o mesmo comando montado pela seção', async () => {
  const save = vi.fn(async () => {})
  await act(async () => root.render(<PresetEditor initial={{ name: 'Meu agente', agent: 'claude', command: 'claude' }} onSave={save} onCancel={() => {}} />))
  await toggle('--verbose')
  await act(async () => button('Salvar').click())
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ command: 'claude --verbose' }))
})
