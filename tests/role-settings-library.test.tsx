// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentsTab } from '../src/renderer/src/settings/tabs/agents'
import { NewTerminalDialog } from '../src/renderer/src/dialogs/NewTerminalDialog'
import type { RoleEntry } from '../src/shared/agent-libraries'

let root: Root | undefined, host: HTMLElement
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren() })

const role = (name: string, workspaceId: string | null = null, terminalCount = 0): RoleEntry => ({ name, displayName: name, text: `Instruções de ${name}`, workspaceId, terminalCount, icon: 'contact', color: '#007AFF' })
function mock(items: RoleEntry[] = [], workspaces = [{ id: 'w1', name: 'COdigos' }, { id: 'w2', name: 'Outro' }]) {
  const roles = { list: vi.fn(async () => items), save: vi.fn(async (d: unknown) => d), remove: vi.fn(async () => {}), discover: vi.fn(async () => [{ name: 'Revisor', text: 'Revise tudo', icon: 'eye', color: '#34C759' }]), import: vi.fn(async () => {}) }
  Object.assign(window, { palco: { workspaces: { sidebar: async () => ({ workspaces }), onSidebar: () => () => {} }, roles, presets: { roles: vi.fn(async () => []), list: async () => [] } } })
  return roles
}
async function render(el: React.ReactElement) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(el)) }
const panel = () => render(<AgentsTab section="Responsabilidades" />)
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const click = (el: Element, init: MouseEventInit = {}) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })) })
const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const pills = () => [...host.querySelectorAll('[role=radiogroup] [role=radio]')].filter(b => b.closest('.library-pills')) as HTMLButtonElement[]
const names = () => [...host.querySelectorAll('.library-row .library-name')].map(e => e.textContent)
const row = (name: string) => host.querySelector<HTMLButtonElement>(`.library-row[data-item="${name}"] .library-select`)!

it('mostra introdução, busca, pílulas e a linha tracejada, sem título, select, vazio nem Descobrir', async () => {
  mock()
  await panel()
  expect(host.querySelector('h3')).toBeNull()
  expect(host.querySelector('select')).toBeNull()
  expect(host.querySelector('.settings-hint')?.textContent).toContain('responsabilidade')
  const search = host.querySelector<HTMLInputElement>('input.library-search')!
  expect(search.placeholder).toBe('Buscar responsabilidades...')
  expect(pills().map(p => p.textContent)).toEqual(['Todos', 'Global', 'COdigos', 'Outro'])
  expect(pills()[0]!.getAttribute('aria-checked')).toBe('true')
  expect(host.querySelector('button.library-new')?.textContent).toBe('Nova Responsabilidade')
  expect(host.textContent).not.toContain('Descobrir')
  expect(host.textContent).not.toContain('Ainda não há')
})

it('filtra por pílula (também pelas setas) e por busca; agrupa quando há mais de um grupo', async () => {
  mock([role('Geral'), role('Do projeto', 'w1'), role('Órfã', 'apagado')])
  await panel()
  expect([...host.querySelectorAll('.library-group-title')].map(e => e.textContent)).toEqual(['Global', 'COdigos'])
  expect(names()).toEqual(['Geral', 'Órfã', 'Do projeto'])
  await click(pills()[2]!)
  expect(names()).toEqual(['Do projeto'])
  expect(host.querySelector('.library-group-title')).toBeNull()
  await key(pills()[2]!, 'ArrowLeft')
  expect(pills()[1]!.getAttribute('aria-checked')).toBe('true')
  expect(names()).toEqual(['Geral', 'Órfã'])
  await click(pills()[0]!)
  await type(host.querySelector('input.library-search')!, 'codig')
  expect(names()).toEqual(['Do projeto'])
  expect(pills().map(p => p.textContent)).toEqual(['Todos', 'Global', 'COdigos'])
})

it('criar abre o editor dentro da aba no escopo da pílula e grava', async () => {
  const roles = mock()
  await panel()
  await click(pills()[2]!)
  await click(button('Nova Responsabilidade'))
  const editor = host.querySelector('[data-inline-editor]')!
  expect(editor).not.toBeNull()
  expect(host.querySelector('.library-new')).toBeNull()
  expect(editor.querySelector('select')!.value).toBe('w1')
  expect(button('Salvar').disabled).toBe(true)
  await type(editor.querySelector('input[maxlength="200"]')!, 'Revisora')
  await type(editor.querySelector('textarea')!, 'Leia o diff')
  await click(button('Salvar'))
  expect(roles.save).toHaveBeenCalledWith({ name: 'Revisora', text: 'Leia o diff', workspaceId: 'w1', icon: 'contact', color: '#007AFF' })
  expect(host.querySelector('[data-inline-editor]')).toBeNull()
})

it('nome repetido avisa e não deixa salvar; Escape volta para a lista', async () => {
  mock([role('Geral')])
  await panel()
  await click(button('Nova Responsabilidade'))
  const name = host.querySelector<HTMLInputElement>('[data-inline-editor] input[maxlength="200"]')!
  await type(name, 'geral'); await type(host.querySelector('[data-inline-editor] textarea')!, 'x')
  expect(host.querySelector('[data-inline-editor] [role=alert]')?.textContent).toContain('Já existe')
  expect(button('Salvar').disabled).toBe(true)
  await key(name, 'Escape')
  expect(host.querySelector('[data-inline-editor]')).toBeNull()
  expect(host.querySelector('.library-new')).not.toBeNull()
})

it('linha: abre a descrição, edita pelo lápis e pelo duplo clique, mostra o uso', async () => {
  mock([role('Geral', null, 2)])
  await panel()
  expect(host.querySelector('.library-row')!.textContent).toContain('Em uso por 2')
  expect(host.textContent).not.toContain('Instruções de Geral')
  const toggle = host.querySelector<HTMLButtonElement>('.library-expand')!
  await click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(host.textContent).toContain('Instruções de Geral')
  await click(host.querySelector('[aria-label="Editar Geral"]')!)
  expect(host.querySelector<HTMLTextAreaElement>('[data-inline-editor] textarea')!.value).toBe('Instruções de Geral')
  await click(button('Cancelar'))
  await act(async () => { row('Geral').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  expect(host.querySelector('[data-inline-editor]')).not.toBeNull()
})

it('seleção: clique, Ctrl, Shift e teclado; exclui várias com confirmação', async () => {
  const roles = mock([role('A'), role('B'), role('C')])
  await panel()
  const selected = () => [...host.querySelectorAll('.library-row.selected .library-name')].map(e => e.textContent)
  await click(row('A')); expect(selected()).toEqual(['A'])
  await click(row('C'), { ctrlKey: true }); expect(selected()).toEqual(['A', 'C'])
  await click(row('B')); expect(selected()).toEqual(['B'])
  await click(row('C'), { shiftKey: true }); expect(selected()).toEqual(['B', 'C'])
  await click(button('Excluir 2 responsabilidades'))
  expect(roles.remove).not.toHaveBeenCalled()
  await click(document.querySelector('.settings-confirm .danger')!)
  expect(roles.remove).toHaveBeenCalledWith(['B', 'C'])
  await key(row('A'), ' '); expect(selected()).toEqual(['A'])
  await key(row('A'), 'Delete')
  expect(document.querySelector('.settings-confirm')).not.toBeNull()
})

it('a lixeira da linha pede confirmação', async () => {
  const roles = mock([role('A')])
  await panel()
  await click(host.querySelector('[aria-label="Excluir A"]')!)
  await click(document.querySelector('.settings-confirm .danger')!)
  expect(roles.remove).toHaveBeenCalledWith(['A'])
})

it('menu do botão direito: seleção, editar e excluir', async () => {
  mock([role('A')])
  await panel()
  await act(async () => { host.querySelector('.library-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
  expect([...document.querySelectorAll('[role=menuitem]')].map(e => e.textContent)).toEqual(['Adicionar à seleção', 'Editar Responsabilidade', 'Excluir'])
  await click([...document.querySelectorAll('[role=menuitem]')][0]!)
  expect(host.querySelector('.library-row.selected')).not.toBeNull()
  expect(document.querySelector('[role=menu]')).toBeNull()
})

it('Descobrir Responsabilidades fica na aba de responsabilidade do Novo Terminal e importa as marcadas', async () => {
  const roles = mock()
  await render(<NewTerminalDialog sizeLabel={null} workspaceId="w1" onCancel={() => {}} onCreate={async () => null} />)
  const agentTab = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].at(-1)!
  await click(agentTab)
  await click(button('Descobrir Responsabilidades'))
  expect(roles.discover).toHaveBeenCalledWith('w1')
  const sheet = document.querySelector('.role-discovery')!
  expect(sheet.textContent).toContain('Revisor')
  expect(sheet.textContent).toContain('Revise tudo')
  await click(button('Desmarcar Tudo'))
  expect(button('Importar').disabled).toBe(true)
  await click(button('Selecionar Tudo'))
  await click(button('Importar 1'))
  expect(roles.import).toHaveBeenCalledWith([{ name: 'Revisor', text: 'Revise tudo', icon: 'eye', color: '#34C759' }], 'w1')
  expect(document.querySelector('.role-discovery')).toBeNull()
  expect(window.palco.presets.roles).toHaveBeenCalledTimes(2)
})
