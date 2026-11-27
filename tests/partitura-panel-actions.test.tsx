// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PartituraMenu } from '../src/renderer/src/partituras/PartituraMenu'
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const api = { list: vi.fn(async () => []), save: vi.fn(async () => {}), insert: vi.fn(async () => {}), remove: vi.fn(async () => {}), rename: vi.fn(async () => {}), export: vi.fn(), import: vi.fn(), inspect: vi.fn(async () => ({ imported: false, terminals: [] })) }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.assign(window, { palco: { partitura: api } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks() })
const mount = async () => { await act(async () => root.render(createElement(PartituraMenu, { onClose: vi.fn() }))) }
const click = async (label: string) => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)!; expect(b).toBeTruthy(); await act(async () => b.click()) }
it('abre painel não modal com vazio explicativo e ações de arquivo no menu', async () => {
 await mount(); expect(host.querySelector('[role=dialog]')?.getAttribute('aria-modal')).toBe('false')
 expect(host.textContent).toContain('Nenhuma Partitura Ainda'); expect(host.querySelector('form')).toBeNull()
 await click('Ações das partituras'); expect(host.textContent).toContain('Importar arquivo'); expect(host.textContent).toContain('Exportar todas')
})
it('cria pelo menu e mantém texto das notas no formulário de salvar', async () => {
 await mount(); await click('Ações das partituras'); await click('Salvar andar atual')
 expect(host.querySelector('form')).toBeTruthy(); expect(host.textContent).toContain('Incluir texto das notas')
})
it('lista com inserir por duplo clique e opções por item', async () => {
 api.list.mockResolvedValue([{ name: 'Equipe', createdAt: '2026-11-25' }] as never)
 await mount(); const card = host.querySelector('[data-partitura-card]')!; expect(card).toBeTruthy()
 await act(async () => card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
 expect(api.insert).toHaveBeenCalledWith('Equipe', { commands: true })
 await click('Ações de Equipe'); expect(host.textContent).toContain('Renomear'); expect(host.textContent).toContain('Exportar arquivo')
})
it('renomeia pelo formulário e confirma exclusão antes de apagar', async () => {
 api.list.mockResolvedValue([{ name: 'Equipe', createdAt: '2026-11-25' }] as never)
 await mount(); await click('Ações de Equipe'); await click('Renomear')
 const input = host.querySelector('form input') as HTMLInputElement
 await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, 'Time'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
 await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
 expect(api.rename).toHaveBeenCalledWith('Equipe', expect.any(String))
 await click('Ações de Equipe'); await click('Excluir'); expect(api.remove).not.toHaveBeenCalled()
 await click('Excluir'); expect(api.remove).toHaveBeenCalledWith('Equipe')
})
