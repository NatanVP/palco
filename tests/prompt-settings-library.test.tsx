// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentsTab } from '../src/renderer/src/settings/tabs/agents'
import { PromptStore } from '../src/main/prompts/prompt-store'

let root: Root | undefined, host: HTMLElement
const dirs: string[] = []
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'palco-prompt-library-')); dirs.push(d); return d }
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const meta = (id: string, name: string, workspaceId: string | null = null) => ({ id, name, description: '', workspaceId })
const writeText = vi.fn(async () => {})
function mock(items = [meta('b', 'Beta'), meta('a', 'Alfa'), meta('w1/c', 'Do projeto', 'w1')]) {
  const prompts = {
    list: vi.fn(async () => ({ items, problems: [] as Array<{ id: string; reason: string }> })),
    read: vi.fn(async (id: string) => ({ ...items.find(i => i.id === id)!, body: `Corpo de ${id}` })),
    save: vi.fn(async (d: unknown) => d), remove: vi.fn(async () => 'token'), undo: vi.fn(async () => {}), showFolder: vi.fn(async () => {}),
    directory: vi.fn(async (w: string | null) => (w ? `/dados/prompts/${w}` : '/dados/prompts'))
  }
  Object.assign(window, { palco: { workspaces: { sidebar: async () => ({ workspaces: [{ id: 'w1', name: 'COdigos' }], active: 'w1' }), onSidebar: () => () => {} }, prompts } })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return prompts
}
async function panel() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(<AgentsTab section="Prompts" />)) }
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
async function type(el: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
const names = () => [...host.querySelectorAll('.library-row .library-name')].map(e => e.textContent)
const pill = (name: string) => [...host.querySelectorAll('.library-pills button')].find(b => b.textContent === name)!

it('mesmo desenho das Responsabilidades: introdução, busca, pílulas, linha de criar, botões com ícone e explicação', async () => {
  mock()
  await panel()
  expect(host.querySelector('h3')).toBeNull()
  expect(host.querySelector('select')).toBeNull()
  expect(host.querySelector('.settings-hint')?.textContent).toContain('@Prompts')
  expect(host.querySelector('input.library-search')).not.toBeNull()
  expect(host.querySelector('button.library-new')?.textContent).toBe('Novo prompt')
  expect(button('Mostrar pasta de prompts').querySelector('svg')).not.toBeNull()
  expect(button('Copiar Caminho').querySelector('svg.lucide-copy')).not.toBeNull()
  expect(host.querySelector('.library-folder-hint')?.textContent).toContain('PROMPT.md')
  expect(host.textContent).not.toContain('Ainda não há')
  expect(names()).toEqual(['Alfa', 'Beta', 'Do projeto'])
})

it('copia o caminho global e, com um espaço nas pílulas, o da pasta dele; o botão confirma', async () => {
  const prompts = mock()
  await panel()
  await click(button('Copiar Caminho'))
  expect(writeText).toHaveBeenLastCalledWith('/dados/prompts')
  expect(button('Copiado').querySelector('svg.lucide-check')).not.toBeNull()
  await click(pill('COdigos'))
  expect(prompts.directory).toHaveBeenLastCalledWith('w1')
  await click(button('Copiado') ?? button('Copiar Caminho'))
  expect(writeText).toHaveBeenLastCalledWith('/dados/prompts/w1')
  await click(button('Mostrar pasta de prompts'))
  expect(prompts.showFolder).toHaveBeenCalled()
})

it('a descrição aberta mostra o texto do prompt e a busca olha dentro dele', async () => {
  mock()
  await panel()
  await click(host.querySelector('[data-item="a"] .library-expand')!)
  expect(host.querySelector('.library-description')?.textContent).toContain('Corpo de a')
  await type(host.querySelector('input.library-search')!, 'corpo de w1')
  expect(names()).toEqual(['Do projeto'])
})

it('excluir é na hora, com Desfazer', async () => {
  const prompts = mock()
  await panel()
  await click(host.querySelector('[aria-label="Excluir Alfa"]')!)
  expect(document.querySelector('.settings-confirm')).toBeNull()
  expect(prompts.remove).toHaveBeenCalledWith('a')
  await click(button('Desfazer'))
  expect(prompts.undo).toHaveBeenCalledWith('token')
})

it('prompt de espaço que sumiu vai para um grupo próprio; novo prompt em Todos nasce no espaço atual', async () => {
  mock([meta('a', 'Alfa'), meta('x/b', 'Beta', 'x')])
  await panel()
  expect([...host.querySelectorAll('.library-group-title')].map(e => e.textContent)).toEqual(['Global', 'Espaço indisponível'])
  await click(button('Novo prompt'))
  expect(document.querySelector<HTMLSelectElement>('[role=dialog] select')!.value).toBe('w1')
})

it('relê a pasta quando a janela volta ao foco (o agente pode ter editado os arquivos)', async () => {
  const prompts = mock()
  await panel()
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(prompts.list).toHaveBeenCalledTimes(2)
})

it('disco: global na raiz, os de um espaço na pasta com o ID dele; mudar o escopo move a pasta com os arquivos', () => {
  const root = temp(), s = new PromptStore(root)
  const g = s.save({ name: 'Revisar', body: 'a', workspaceId: null })
  const w = s.save({ name: 'Revisar', body: 'b', workspaceId: 'w1' })
  expect(g.id).toBe('revisar'); expect(w.id).toBe('w1/revisar')
  expect(existsSync(join(root, 'w1', 'revisar', 'PROMPT.md'))).toBe(true)
  writeFileSync(join(root, 'revisar', 'anexo.txt'), 'x')
  const moved = s.save({ ...g, workspaceId: 'w2' })
  expect(moved.id).toBe('w2/revisar')
  expect(readFileSync(join(root, 'w2', 'revisar', 'anexo.txt'), 'utf8')).toBe('x')
  expect(existsSync(join(root, 'revisar'))).toBe(false)
  expect(s.list().items.map(i => i.id).sort()).toEqual(['w1/revisar', 'w2/revisar'])
  expect(s.list('w1').items.map(i => i.id)).toEqual(['w1/revisar'])
  const token = s.remove(w.id); s.undo(token); expect(s.read(w.id).body).toBe('b')
})

it('disco: a pasta manda no escopo; formato antigo continua lido e vai para a pasta ao salvar', () => {
  const root = temp(), s = new PromptStore(root)
  mkdirSync(join(root, 'w1', 'do-agente'), { recursive: true })
  writeFileSync(join(root, 'w1', 'do-agente', 'PROMPT.md'), '---\nname: Do agente\n---\ncorpo')
  mkdirSync(join(root, 'antigo'))
  writeFileSync(join(root, 'antigo', 'PROMPT.md'), '---\nname: Antigo\nworkspaceId: "w1"\n---\ncorpo')
  expect(s.list('w1').items.map(i => [i.id, i.workspaceId])).toEqual([['antigo', 'w1'], ['w1/do-agente', 'w1']])
  expect(s.save({ ...s.read('antigo') }).id).toBe('w1/antigo')
})

it('disco: pasta vazia de espaço e arquivos soltos não viram problema; travessia e links são recusados', () => {
  const root = temp(), s = new PromptStore(root)
  expect(s.directory(null)).toBe(root)
  expect(s.directory('w1')).toBe(join(root, 'w1'))
  expect(existsSync(join(root, 'w1'))).toBe(true)
  expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('PROMPT.md')
  expect(s.list()).toEqual({ items: [], problems: [] })
  expect(() => s.directory('../fora')).toThrow()
  expect(() => s.read('w1/../x')).toThrow()
  expect(() => s.save({ name: 'A', body: 'b', workspaceId: '../fora' })).toThrow()
  symlinkSync(temp(), join(root, 'w2'))
  expect(() => s.directory('w2')).toThrow()
  expect(() => s.save({ name: 'A', body: 'b', workspaceId: 'w2' })).toThrow()
})

it('disco: um AGENTS.md escrito pelo usuário não é sobrescrito', () => {
  const root = temp()
  writeFileSync(join(root, 'AGENTS.md'), 'meu')
  new PromptStore(root).directory(null)
  expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe('meu')
})
