// @vitest-environment happy-dom
// Menu do canvas: criação de elementos, colagem e partituras.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Canvas } from '../src/renderer/src/canvas/Canvas'
import { decidePaste, elementClipboard } from '../src/renderer/src/canvas/selection/clipboard'
import { adoptPreferences, suspendShortcuts } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'
import { setLocale } from '../src/shared/i18n/runtime'
import type { Workspace } from '../src/shared/model'
vi.mock('../src/renderer/src/nodes/TerminalView', () => ({ TerminalView: () => null }))

const ws: Workspace = {
  id: 'w', name: 'W', connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 100, y: 50 }, zoom: 2 }, drawings: [],
  nodes: { n: { id: 'n', kind: 'note', name: 'N', content: 'oi', floorId: null, pos: { x: 400, y: 400 }, size: { w: 200, h: 100 } } }
}
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
let api: ReturnType<typeof makeApi>
const makeApi = () => ({
  workspace: { get: async () => ws, onChange: () => () => {} }, workspaces: { sidebar: async () => ({ workspaces: [] }) },
  node: { add: vi.fn(async () => 'novo'), patch: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
  history: { commit: vi.fn(async (_w: string, ops: unknown[]) => ops.map((_o, i) => `c${i}`)) },
  presets: { list: vi.fn(async () => [{ name: 'Revisor', agent: 'claude', command: 'claude --model opus' }, { name: 'Escondido', agent: 'shell', command: '', quickStart: false }]) },
  accounts: { list: vi.fn(async () => []) },
  partitura: { list: vi.fn(async () => [] as Array<{ name: string; createdAt: string }>) },
  clipboard: { read: vi.fn(async () => ({ text: '', files: [] as string[], image: false })), writeText: vi.fn(async () => {}), saveImage: vi.fn(async () => null as string | null) },
  files: { kindOf: vi.fn(async () => ({ kind: 'file', note: false })), noteText: vi.fn(async () => null) }
})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); suspendShortcuts(false); setLocale('pt-BR'); elementClipboard.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api = makeApi(); Object.assign(window, { palco: api })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals() })

const mount = async (extra: Record<string, unknown> = {}) => {
  const spy = { onCamera: vi.fn(), onSelectConn: vi.fn(), onSelectOnly: vi.fn(), onSelectMany: vi.fn(), onPlace: vi.fn(), onPartitura: vi.fn() }
  await act(async () => root.render(createElement(Canvas, { ws, camera: ws.camera, linkFrom: null, onLink: vi.fn(), selectedConn: null, selection: new Set<string>(), onToggleSelect: vi.fn(), onGoToFloor: vi.fn(), ...spy, ...extra })))
  const el = host.querySelector<HTMLElement>('.canvas')!
  el.setPointerCapture = vi.fn(); el.releasePointerCapture = vi.fn(); el.hasPointerCapture = () => true
  el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 700, right: 1010, bottom: 720, x: 10, y: 20, toJSON: () => ({}) })
  return { el, ...spy }
}
const contextmenu = async (target: Element, x = 310, y = 270) => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y })
  await act(async () => { target.dispatchEvent(ev); await Promise.resolve() })
  return ev
}
const menus = () => [...document.querySelectorAll('[role=menu]')]
const item = (id: string) => document.querySelector<HTMLButtonElement>(`[data-menu-id="${id}"]`)
const labels = (menu: Element) => [...menu.querySelectorAll(':scope > [data-menu-id], :scope > [role=separator]')].map((e) => e.getAttribute('role') === 'separator' ? '—' : e.querySelector('.cmenu-label')!.textContent)
const click = async (id: string) => { await act(async () => { item(id)!.click(); await new Promise((r) => setTimeout(r, 0)) }) }

describe('menu do canvas', () => {
  it('Adicionar, Colar e Partituras, na ordem e com os separadores do palco', async () => {
    const c = await mount()
    const ev = await contextmenu(c.el)
    expect(ev.defaultPrevented).toBe(true)
    expect(menus()).toHaveLength(1)
    expect(labels(menus()[0]!)).toEqual(['Adicionar', '—', 'Colar', '—', 'Partituras'])
    expect(item('paste')!.disabled).toBe(false)
  })
  it('submenus: Adicionar › Terminal com Novo Terminal… e os presets do início rápido', async () => {
    const c = await mount(); await contextmenu(c.el)
    await click('add')
    expect(labels(menus()[1]!)).toEqual(['Terminal', 'Nota', 'Árvore de Arquivos', 'Portal', 'Texto'])
    await click('add.terminal')
    expect(labels(menus()[2]!)).toEqual(['Novo Terminal…', '—', 'Claude Code', 'Codex', 'Antigravity', 'OpenCode', 'Shell', 'Revisor'])
  })
  it.each([['add.note', 'note'], ['add.filetree', 'filetree'], ['add.portal', 'portal'], ['add.text', 'text']])('%s cria centrado no ponto do clique (em mundo) e fecha o menu', async (id, kind) => {
    const c = await mount(); await contextmenu(c.el, 310, 270)
    await click('add'); await click(id)
    expect(c.onPlace).toHaveBeenCalledTimes(1)
    const [k, frame] = c.onPlace.mock.calls[0]!
    expect(k).toBe(kind)
    // tela (310,270) - canvas (10,20) = (300,250); mundo = (local - offset) / zoom = (100,100)
    expect(Math.abs(frame.pos.x + frame.size.w / 2 - 100)).toBeLessThanOrEqual(10)
    expect(Math.abs(frame.pos.y + frame.size.h / 2 - 100)).toBeLessThanOrEqual(10)
    expect(menus()).toHaveLength(0)
  })
  it('Novo Terminal… abre o diálogo com o frame no ponto; um preset cria o terminal direto', async () => {
    const c = await mount(); await contextmenu(c.el)
    await click('add'); await click('add.terminal'); await click('add.terminal.new')
    expect(c.onPlace.mock.calls[0]![0]).toBe('terminal')
    await contextmenu(c.el); await click('add'); await click('add.terminal'); await click('add.terminal.preset:Revisor')
    expect(api.node.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'terminal', name: 'Revisor', command: 'claude --model opus', agent: 'claude', floorId: null }))
    expect(c.onSelectMany).toHaveBeenCalledWith(['novo'])
  })
  it('Esc e clique fora fecham; as setas navegam e Enter escolhe', async () => {
    const c = await mount(); await contextmenu(c.el)
    const key = async (k: string) => act(async () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
    await key('ArrowDown'); expect(document.activeElement).toBe(item('add'))
    await key('ArrowRight'); expect(menus()).toHaveLength(2); expect(document.activeElement).toBe(item('add.terminal'))
    await key('ArrowDown'); await key('Enter')
    await act(async () => { (document.activeElement as HTMLButtonElement).click() })
    expect(c.onPlace.mock.calls[0]![0]).toBe('note')
    await contextmenu(c.el); await key('Escape'); expect(menus()).toHaveLength(0)
    await contextmenu(c.el); await act(async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) }); expect(menus()).toHaveLength(0)
  })
  it('Partituras: Criar e Atualizar pedem seleção; Atualizar pede também uma partitura salva; a biblioteca sempre abre', async () => {
    let c = await mount(); await contextmenu(c.el); await click('scores')
    expect(labels(menus()[1]!)).toEqual(['Criar Partitura…', 'Atualizar Partitura…', '—', 'Abrir Biblioteca…'])
    expect(item('scores.create')!.disabled).toBe(true); expect(item('scores.update')!.disabled).toBe(true)
    await click('scores.open'); expect(c.onPartitura).toHaveBeenCalledWith('open', [])
    c = await mount({ selection: new Set(['n']) }); await contextmenu(c.el); await click('scores')
    expect(item('scores.create')!.disabled).toBe(false); expect(item('scores.update')!.disabled).toBe(true)
    await click('scores.create'); expect(c.onPartitura).toHaveBeenCalledWith('create', ['n'])
    api.partitura.list.mockResolvedValue([{ name: 'x', createdAt: '' }])
    await contextmenu(c.el); await click('scores'); await click('scores.update')
    expect(c.onPartitura).toHaveBeenCalledWith('update', ['n'])
  })
  it('o menu não abre em campo de texto da barra do portal nem durante uma ligação', async () => {
    const c = await mount({ linkFrom: 'n' }); await contextmenu(c.el); expect(menus()).toHaveLength(0)
  })
})

describe('Colar', () => {
  it('elementos copiados vencem quando a área de transferência do sistema ainda tem a marca deles ou está vazia', () => {
    const clip = { token: 'palco:elements:1', data: { nodes: [], drawings: [], connections: [], box: { x: 0, y: 0, w: 0, h: 0 } } }
    expect(decidePaste({ text: 'palco:elements:1', files: [], image: false }, clip).kind).toBe('elements')
    expect(decidePaste({ text: '', files: [], image: false }, clip).kind).toBe('elements')
    expect(decidePaste({ text: 'https://exemplo.dev/a', files: [], image: false }, clip)).toEqual({ kind: 'url', url: 'https://exemplo.dev/a' })
    expect(decidePaste({ text: '', files: ['/tmp/a.png'], image: true }, clip)).toEqual({ kind: 'files', files: ['/tmp/a.png'] })
    expect(decidePaste({ text: '', files: [], image: true }, null).kind).toBe('image')
    expect(decidePaste({ text: 'um texto qualquer', files: [], image: false }, clip).kind).toBe('nothing')
    expect(decidePaste({ text: '', files: [], image: false }, null).kind).toBe('nothing')
  })
  it('cola os elementos copiados com o centro da caixa no ponto do clique', async () => {
    elementClipboard.set({ nodes: [{ kind: 'note', name: 'N', content: 'oi', floorId: null, pos: { x: 400, y: 400 }, size: { w: 200, h: 100 } }], drawings: [], connections: [], box: { x: 400, y: 400, w: 200, h: 100 } })
    const c = await mount(); await contextmenu(c.el, 310, 270); await click('paste')
    expect(api.history.commit).toHaveBeenCalledWith('w', [{ type: 'node.add', node: expect.objectContaining({ name: 'N 2', pos: { x: 0, y: 50 } }) }])
  })
  it('uma URL vira cartão de link e um arquivo vira nó de arquivo no ponto', async () => {
    api.clipboard.read.mockResolvedValue({ text: 'https://exemplo.dev/', files: [], image: false })
    const c = await mount(); await contextmenu(c.el, 310, 270); await click('paste')
    expect(api.node.add).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'link', url: 'https://exemplo.dev/' }))
    api.clipboard.read.mockResolvedValue({ text: '', files: ['/tmp/foto.png'], image: false })
    await contextmenu(c.el, 310, 270); await click('paste')
    expect(api.node.add).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'file', path: '/tmp/foto.png' }))
  })
})

describe('botão direito arrastando', () => {
  const pointer = async (target: Element, kind: string, x: number) => act(async () => { target.dispatchEvent(new PointerEvent(kind, { button: 2, buttons: kind === 'pointerup' ? 0 : 2, pointerId: 7, clientX: x, clientY: 100, bubbles: true, cancelable: true })) })
  const on = () => adoptPreferences({ ...defaultPreferences(), rightDragPansCanvas: true })
  it('parado: o contextmenu do aperto é adiado e o menu abre ao soltar', async () => {
    on(); const c = await mount()
    await pointer(c.el, 'pointerdown', 100)
    const ev = await contextmenu(c.el, 100, 100)
    expect(ev.defaultPrevented).toBe(true); expect(menus()).toHaveLength(0)
    await pointer(c.el, 'pointerup', 102)
    expect(menus()).toHaveLength(1); expect(c.onCamera).not.toHaveBeenCalled()
  })
  it('arrastando mais de 4 px: move a vista e não abre menu, nem com o contextmenu atrasado', async () => {
    on(); const c = await mount()
    await pointer(c.el, 'pointerdown', 100); await contextmenu(c.el, 100, 100)
    await pointer(c.el, 'pointermove', 140)
    expect(c.onCamera).toHaveBeenLastCalledWith({ zoom: 2, offset: { x: 140, y: 50 } })
    await pointer(c.el, 'pointerup', 140); expect(menus()).toHaveLength(0)
    await pointer(c.el, 'pointerdown', 100); await pointer(c.el, 'pointermove', 140); await pointer(c.el, 'pointerup', 140)
    await contextmenu(c.el, 140, 100); expect(menus()).toHaveLength(0)
  })
  it('vale também em cima de um elemento, sem mudar a seleção', async () => {
    on(); const c = await mount()
    const header = host.querySelector('[data-node-id="n"] .node-header')!
    await pointer(header, 'pointerdown', 100); await pointer(header, 'pointermove', 160); await pointer(header, 'pointerup', 160)
    expect(c.onCamera).toHaveBeenCalled(); expect(c.onSelectOnly).not.toHaveBeenCalled()
  })
  it('com a opção desligada, o botão direito não move a vista e o menu abre na hora', async () => {
    const c = await mount()
    await pointer(c.el, 'pointerdown', 100); await contextmenu(c.el, 100, 100); expect(menus()).toHaveLength(1)
    await pointer(c.el, 'pointermove', 160); await pointer(c.el, 'pointerup', 160)
    expect(c.onCamera).not.toHaveBeenCalled(); expect(c.onSelectMany).not.toHaveBeenCalled()
  })
})

describe('no main: partituras da seleção e arquivos copiados', () => {
  it('captura exatamente os nós escolhidos e atualizar regrava a partitura salva', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path')
    const { WorkspaceStore } = await import('../src/main/domain/workspace-store')
    const { PartituraStore } = await import('../src/main/partituras/partitura-store')
    const { savePartitura, updatePartitura } = await import('../src/main/partituras/routes')
    const dir = mkdtempSync(join(tmpdir(), 'palco-canvas-partitura-'))
    try {
      const store = new WorkspaceStore(join(dir, 'w.json')), lib = new PartituraStore(join(dir, 'partituras'))
      const note = (name: string) => store.addNode({ kind: 'note', floorId: null, name, content: name, pos: { x: 10, y: 10 }, size: { w: 200, h: 100 } })
      const a = note('A'), b = note('B'); note('C'); store.connect(a, b)
      savePartitura(lib, store, 'sel', null, { noteText: true, ids: new Set([a]) })
      expect(lib.get('sel').nodes.map((n) => n.name)).toEqual(['A'])
      updatePartitura(lib, store, 'sel', null, { noteText: true, ids: new Set([a, b]) })
      expect(lib.get('sel').nodes.map((n) => n.name)).toEqual(['A', 'B']); expect(lib.get('sel').connections).toHaveLength(1)
      expect(() => updatePartitura(lib, store, 'sel', null, { noteText: true, ids: new Set() })).toThrow()
      expect(lib.get('sel').nodes).toHaveLength(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('text/uri-list vira caminhos locais; o resto fica de fora', async () => {
    const { parseUriList } = await import('../src/main/uri-list')
    expect(parseUriList('# comentário\r\nfile:///tmp/a%20b.png\r\nhttps://x.dev\nfile:///tmp/c.txt')).toEqual(['/tmp/a b.png', '/tmp/c.txt'])
  })
})
