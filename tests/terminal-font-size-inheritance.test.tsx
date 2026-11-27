// @vitest-environment happy-dom
// editar um terminal sem mexer no tamanho da fonte não o congela.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { EditTerminalDialog } from '../src/renderer/src/dialogs/EditTerminalDialog'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'
import type { TerminalNode } from '../src/shared/model'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const patch = vi.fn(async (_id: string, _p: object) => {})
const reconfigure = vi.fn(async (_id: string, _config: object, _patch?: object) => {})
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences({ ...defaultPreferences(), terminalFontSize: 16 }); patch.mockClear(); reconfigure.mockClear(); Object.assign(window, { palco: { node: { patch }, terminal: { reconfigure, resolveAgent: vi.fn(async () => ({ agent: 'other' })) }, files: { pick: vi.fn() }, accountSettings: { list: vi.fn(async () => []) } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const node = (over: Partial<TerminalNode> = {}) => ({ id: 't', kind: 'terminal', name: 'T', agent: 'shell', command: '', cwd: '/tmp', floorId: null, pos: { x: 0, y: 0 }, size: { w: 4, h: 3 }, ...over }) as TerminalNode
const save = async () => { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
const mount = async (n: TerminalNode) => { await act(async () => root.render(createElement(EditTerminalDialog, { node: n, onClose: vi.fn(), onError: vi.fn() }))) }

it('mostra o tamanho das preferências e não o grava sem mudança', async () => {
  await mount(node()); await save()
  expect(patch).toHaveBeenCalledOnce(); expect(patch.mock.calls[0]![1]).not.toHaveProperty('fontSize')
  expect(host.textContent).toContain('16')
})
it('um terminal com tamanho próprio continua com ele', async () => {
  await mount(node({ fontSize: 18 })); await save()
  expect(patch.mock.calls[0]![1]).toMatchObject({ fontSize: 18 })
})
it('Editar terminal permite selecionar o tipo explicitamente', async () => {
  await mount(node({ agent: 'other', command: 'clauded' }))
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Tipo de agente"]')!
  await act(async () => { select.value = 'claude'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await save()
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Reiniciar')!.click())
  expect(reconfigure).toHaveBeenCalledWith('t', { command: 'clauded', cwd: '/tmp', agent: 'claude' }, expect.any(Object))
})
