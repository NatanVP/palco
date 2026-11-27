// @vitest-environment happy-dom
// entrar nas pastas da árvore (com Voltar à Raiz) e renomear o fichário pela interface.
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { validateWorkspace } from '../src/main/domain/workspace-schema'
import { CanvasHistory } from '../src/main/history/canvas-history'
import { parseNodePatch } from '../src/main/validate'
import { FileTreeView } from '../src/renderer/src/nodes/FileTreeView'
import { captureSelection, pasteOperations } from '../src/renderer/src/canvas/selection/group'
import { emptyWorkspace, mountApp, type Harness } from './helpers/app-harness'
import type { FileTreeNode, NewNode } from '../src/shared/model'

describe('pasta atual da árvore', () => {
  let dir: string, store: WorkspaceStore, id: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-arv-')); store = new WorkspaceStore(join(dir, 'ws.json')); id = store.addNode({ kind: 'filetree', floorId: null, name: 'A', root: '/h/proj', pos: { x: 0, y: 0 }, size: { w: 300, h: 300 } } as NewNode) })
  afterEach(() => { store.dispose(); rmSync(dir, { recursive: true, force: true }) })
  const node = () => store.get().nodes[id] as FileTreeNode
  const go = (current: string) => store.patchNode(id, parseNodePatch({ current }, 'filetree'))

  it('fica dentro da raiz e some quando volta a ela; persiste', () => {
    go('/h/proj/src/a'); expect(node().current).toBe('/h/proj/src/a')
    for (const bad of ['/h/outro', '/h/projeto', '/h/proj/../x', '/etc']) expect(() => go(bad), bad).toThrow()
    store.flush(); const again = new WorkspaceStore(join(dir, 'ws.json')); expect((again.get().nodes[id] as FileTreeNode).current).toBe('/h/proj/src/a'); again.dispose()
    go('/h/proj'); expect(node().current).toBeUndefined()
    expect(() => parseNodePatch({ current: 'rel' }, 'filetree')).toThrow(); expect(() => parseNodePatch({ current: '/h' }, 'note')).toThrow()
  })
  it('um arquivo com pasta atual fora da raiz é consertado', () => {
    const raw = store.get(); (raw.nodes[id] as FileTreeNode).current = '/etc'
    expect(validateWorkspace(raw, () => {}).nodes[id]).not.toHaveProperty('current')
  })
  it('navegar não entra no desfazer nem é desfeito', () => {
    const history = new CanvasHistory()
    history.transact(store, () => store.patchNode(id, { pos: { x: 40, y: 0 } }))
    history.transact(store, () => go('/h/proj/src'))
    history.undo(store); expect(node().pos.x).toBe(0); expect(node().current).toBe('/h/proj/src'); expect(history.canUndo(store)).toBe(false)
  })
})

describe('a árvore na tela', () => {
  let host: HTMLDivElement, root: ReturnType<typeof createRoot>
  const tree: Record<string, Array<{ name: string; dir: boolean }>> = { '/h/proj': [{ name: 'src', dir: true }, { name: 'a.md', dir: false }], '/h/proj/src': [{ name: 'ui', dir: true }], '/h/proj/src/ui': [{ name: 'b.ts', dir: false }] }
  const navigate = vi.fn()
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); navigate.mockClear(); Object.assign(window, { palco: { files: { list: vi.fn(async (d: string) => tree[d] ?? []) }, preferences: {} } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const mount = async (initial?: string) => {
    function Host() { const [current, setCurrent] = useState(initial); return createElement(FileTreeView, { root: '/h/proj', ...(current ? { current } : {}), onNavigate: (p: string) => { navigate(p); setCurrent(p === '/h/proj' ? undefined : p) }, onOpenFile: () => {} }) }
    await act(async () => root.render(createElement(Host))); await settle()
  }
  const row = (name: string) => [...host.querySelectorAll<HTMLElement>('.tree-row')].find((e) => e.textContent === name)!
  const names = () => [...host.querySelectorAll('.tree-row')].map((e) => e.textContent)
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  const click = async (el: HTMLElement) => { await act(async () => el.click()); await settle() }

  it('duplo clique entra na pasta; voltar sobe até a raiz e avançar refaz o caminho', async () => {
    await mount()
    expect(button('Voltar').disabled).toBe(true); expect(button('Avançar').disabled).toBe(true); expect(host.querySelector('.tree-here')!.textContent).toBe('proj')
    await act(async () => { row('src').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) }); await settle()
    expect(navigate).toHaveBeenLastCalledWith('/h/proj/src'); expect(names()).toEqual(['ui']); expect(host.querySelector('.tree-here')!.textContent).toBe('src')
    await act(async () => { row('ui').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) }); await settle(); expect(names()).toEqual(['b.ts'])
    await click(button('Voltar')); expect(navigate).toHaveBeenLastCalledWith('/h/proj/src')
    await click(button('Voltar')); expect(navigate).toHaveBeenLastCalledWith('/h/proj'); expect(button('Voltar').disabled).toBe(true)
    await click(button('Avançar')); expect(navigate).toHaveBeenLastCalledWith('/h/proj/src')
    await click(button('Avançar')); expect(navigate).toHaveBeenLastCalledWith('/h/proj/src/ui'); expect(button('Avançar').disabled).toBe(true)
  })
  it('o nome da pasta abre a hierarquia até a raiz, e saltar esvazia o avançar', async () => {
    await mount('/h/proj/src/ui'); await click(host.querySelector<HTMLElement>('.tree-here')!)
    const items = [...document.querySelectorAll<HTMLButtonElement>('.tree-menu [role=menuitem]')]
    expect(items.map((i) => [i.textContent, i.disabled])).toEqual([['ui', true], ['src', false], ['proj', false]])
    await click(items[2]!); expect(navigate).toHaveBeenLastCalledWith('/h/proj'); expect(button('Avançar').disabled).toBe(true)
  })
  it('o menu da pasta tem Abrir, que entra nela', async () => {
    await mount()
    await act(async () => { row('src').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
    const open = [...document.querySelectorAll<HTMLElement>('.tree-menu [role=menuitem]')].find((e) => e.textContent === 'Abrir')!
    await click(open); expect(navigate).toHaveBeenLastCalledWith('/h/proj/src')
    await act(async () => { row('ui').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) }); expect(document.querySelectorAll('.tree-menu [role=menuitem]').length).toBe(4)
  })
})

it('no tema claro a árvore é clara, com texto escuro e os botões da navegação sem bloco', async () => {
  const { readFileSync } = await import('node:fs')
  const style = document.createElement('style'); style.textContent = ['styles.css', 'settings/settings.css'].map((p) => readFileSync(join(process.cwd(), 'src/renderer/src', p), 'utf8').replace(/^@import.*$/gm, '')).join('\n'); document.head.append(style)
  document.documentElement.dataset.appearance = 'light'
  document.body.innerHTML = '<div class="treebox"><div class="tree-nav"><button class="icon-btn"></button><button class="tree-here">x</button></div><div class="tree-body"><div class="tree-row dir">src</div></div></div>'
  const css = (s: string) => getComputedStyle(document.querySelector(s)!)
  expect(css('.treebox').backgroundColor.toLowerCase()).toBe('#fff')
  expect(css('.tree-row').color.toLowerCase()).toBe('#252a33'); expect(css('.tree-here').color.toLowerCase()).toBe('#252a33')
  for (const s of ['.tree-nav .icon-btn', '.tree-here']) expect(css(s).backgroundColor).toBe('transparent')
  style.remove(); delete document.documentElement.dataset.appearance; document.body.replaceChildren()
})

describe('no canvas', () => {
  let app: Harness
  const patch = vi.fn(async () => {}), rename = vi.fn(async () => {})
  const noteIn = (id: string, extra: object = {}) => ({ id, kind: 'note', name: id, content: '', floorId: null, pos: { x: 500, y: 200 }, size: { w: 260, h: 160 }, ...extra })
  const ws = (stackNames?: Record<string, string>, current?: string) => emptyWorkspace({ nodes: { t: { id: 't', kind: 'filetree', name: 't', root: '/h/proj', floorId: null, pos: { x: 100, y: 200 }, size: { w: 300, h: 300 }, ...(current ? { current } : {}) }, a: noteIn('a', { stackId: 's1' }), b: noteIn('b', { stackId: 's1' }) } as never, ...(stackNames ? { stackNames } : {}) })
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); vi.clearAllMocks() })
  afterEach(async () => { await app.unmount(); vi.unstubAllGlobals() })
  const mount = async (workspace = ws()) => { app = await mountApp({ workspace, api: { 'node.patch': patch, 'stack.rename': rename, 'files.list': async () => [] } }) }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const context = async (selector: string) => { await act(async () => { app.host.querySelector(selector)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })) }); await settle() }
  const items = () => [...document.querySelectorAll('[role^=menuitem]')].map((e) => e.textContent!.trim())
  const choose = async (label: string) => { const el = [...document.querySelectorAll<HTMLElement>('[role^=menuitem]')].find((e) => e.textContent!.trim() === label)!; expect(el, label).toBeTruthy(); await act(async () => el.click()); await settle() }
  const type = async (value: string) => { const input = app.host.querySelector<HTMLInputElement>('.stack-rename')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }); await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }); await settle() }

  it('Voltar à Raiz aparece no menu só quando se entrou numa pasta', async () => {
    await mount(); await context('[data-node-id="t"] .node-header'); expect(items()).not.toContain('Voltar à Raiz')
    await app.workspace(ws(undefined, '/h/proj/src')); await context('[data-node-id="t"] .node-header'); await choose('Voltar à Raiz')
    expect(patch).toHaveBeenCalledWith('t', { current: '/h/proj' })
  })
  it('o fichário se renomeia pelo menu, mostra o nome e aceita limpar', async () => {
    await mount()
    const front = '.node.note .node-header'
    expect(app.host.querySelector('.stack-name')).toBeNull()
    await context(front); await choose('Renomear Fichário'); await type('Pesquisa'); expect(rename).toHaveBeenLastCalledWith('s1', 'Pesquisa')
    await app.workspace(ws({ s1: 'Pesquisa' })); expect(app.host.querySelector('.stack-name')!.textContent).toBe('Pesquisa')
    await act(async () => { app.host.querySelector('.stack-name')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) }); await type('')
    expect(rename).toHaveBeenLastCalledWith('s1', null)
    await context(front); expect(items()).toContain('Renomear'); expect(items()).toContain('Renomear Fichário')
  })
  it('copiar o fichário inteiro leva o nome para o fichário novo', () => {
    const source = ws({ s1: 'Pesquisa' })
    const ops = pasteOperations(captureSelection(source, ['a', 'b'], []), { x: 0, y: 0 }, [], null, () => 'novo')
    expect(ops.at(-1)).toEqual({ type: 'stack.rename', id: 'novo', name: 'Pesquisa' })
    expect(pasteOperations(captureSelection(source, ['a'], []), { x: 0, y: 0 }, [], null).some((o) => o.type === 'stack.rename')).toBe(false)
  })
})
