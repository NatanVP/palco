// @vitest-environment happy-dom
// grupos do canvas (moldura que agrupa elementos).
import { act } from 'react'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { validateWorkspace } from '../src/main/domain/workspace-schema'
import { CanvasHistory } from '../src/main/history/canvas-history'
import { floorGroups } from '../src/shared/groups'
import { captureSelection, pasteOperations } from '../src/renderer/src/canvas/selection/group'
import { groupFrame } from '../src/renderer/src/canvas/groups/group-frame'
import { emptyWorkspace, mountApp, type Harness } from './helpers/app-harness'
import type { NewNode, Workspace } from '../src/shared/model'

const note = (name: string, x = 0, extra: object = {}): NewNode => ({ kind: 'note', floorId: null, name, content: '', pos: { x, y: 100 }, size: { w: 200, h: 100 }, ...extra }) as NewNode

describe('grupos no workspace', () => {
  let dir: string, store: WorkspaceStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-grupos-')); store = new WorkspaceStore(join(dir, 'ws.json')) })
  afterEach(() => { store.dispose(); rmSync(dir, { recursive: true, force: true }) })
  const ids = (n: number) => Array.from({ length: n }, (_, i) => store.addNode(note(`N${i}`, i * 300)))
  // O arquivo grava as chaves em ordem: a ordem dos membros não importa.
  const groups = () => floorGroups(store.get(), null).map((g) => [g.group.name, g.members.map((m) => m.name).sort()])

  it('agrupa dois ou mais; com um só não faz nada', () => {
    const [a, b] = ids(2)
    expect(store.groupNodes([a!])).toBeNull(); expect(groups()).toEqual([])
    const id = store.groupNodes([a!, b!])!
    expect(groups()).toEqual([['', ['N0', 'N1']]]); expect(store.get().nodes[a!]!.groupId).toBe(id)
  })
  it('somar a um grupo reaproveita o grupo; juntar dois grupos cria um novo', () => {
    const [a, b, c, d, e] = ids(5)
    const first = store.groupNodes([a!, b!])!; store.renameGroup(first, 'Um')
    expect(store.groupNodes([a!, c!])).toBe(first); expect(groups()).toEqual([['Um', ['N0', 'N1', 'N2']]])
    store.groupNodes([d!, e!])
    const merged = store.groupNodes([a!, d!])!
    expect(merged).not.toBe(first)
    // O que sobrou de cada grupo antigo: um grupo com menos de dois membros some.
    expect(groups()).toEqual([['Um', ['N1', 'N2']], ['', ['N0', 'N3']]])
    expect(store.get().nodes[e!]).not.toHaveProperty('groupId')
  })
  it('desagrupar e apagar deixam o grupo sumir quando resta menos de dois', () => {
    const [a, b, c] = ids(3)
    const id = store.groupNodes([a!, b!, c!])!
    store.ungroupNodes([a!]); expect(groups()).toEqual([['', ['N1', 'N2']]])
    store.removeNode(b!); expect(groups()).toEqual([]); expect(store.get().groups).toEqual({}); expect(store.get().nodes[c!]).not.toHaveProperty('groupId')
    expect(() => store.renameGroup(id, 'x')).toThrow()
  })
  it('renomeia (inclusive para vazio) e colore; cor que não é #RRGGBB é recusada', () => {
    const [a, b] = ids(2), id = store.groupNodes([a!, b!])!
    store.renameGroup(id, '  Entrada  '); store.setGroupColor(id, '#bbdefb')
    expect(store.get().groups![id]).toEqual({ name: 'Entrada', color: '#bbdefb' })
    store.renameGroup(id, ''); store.setGroupColor(id, null); expect(store.get().groups![id]).toEqual({ name: '' })
    expect(() => store.setGroupColor(id, 'red')).toThrow()
  })
  it('persiste, e um arquivo com referência quebrada é consertado', () => {
    const [a, b] = ids(2), id = store.groupNodes([a!, b!])!; store.renameGroup(id, 'Fica'); store.flush(); store.dispose()
    store = new WorkspaceStore(join(dir, 'ws.json'))
    expect(groups()).toEqual([['Fica', ['N0', 'N1']]])
    const raw = store.get() as Workspace
    ;(raw.nodes[a!] as { groupId?: string }).groupId = 'fantasma'
    const fixed = validateWorkspace(raw, () => {})
    expect(fixed.nodes[a!]).not.toHaveProperty('groupId'); expect(fixed.nodes[b!]).not.toHaveProperty('groupId'); expect(fixed.groups).toEqual({})
  })
  it('desfazer e refazer voltam o grupo, o nome e a cor', () => {
    const [a, b] = ids(2), history = new CanvasHistory()
    const id = history.transact(store, () => store.groupNodes([a!, b!]))!
    history.transact(store, () => store.renameGroup(id, 'Novo'))
    history.transact(store, () => store.ungroupNodes([a!, b!]))
    history.undo(store); expect(groups()).toEqual([['Novo', ['N0', 'N1']]])
    history.undo(store); expect(groups()).toEqual([['', ['N0', 'N1']]])
    history.undo(store); expect(groups()).toEqual([])
    history.redo(store); history.redo(store); expect(groups()).toEqual([['Novo', ['N0', 'N1']]])
  })
  it('copiar e colar um grupo inteiro cria um grupo novo com o mesmo nome e cor; um membro sozinho vem solto', () => {
    const [a, b, c] = ids(3), id = store.groupNodes([a!, b!])!; store.renameGroup(id, 'Par'); store.setGroupColor(id, '#fff9c4')
    const ops = pasteOperations(captureSelection(store.get(), [a!, b!, c!], []), { x: 20, y: 20 }, [], null)
    expect(ops.filter((o) => o.type === 'node.add').map((o) => (o as { node: { groupId?: string } }).node.groupId)).toEqual([undefined, undefined, undefined])
    expect(ops.at(-1)).toEqual({ type: 'group.create', members: [{ op: 0 }, { op: 1 }], name: 'Par', color: '#fff9c4' })
    expect(pasteOperations(captureSelection(store.get(), [a!], []), { x: 0, y: 0 }, [], null).some((o) => o.type === 'group.create')).toBe(false)
  })
})

it('a moldura é a união dos membros com folga de 16, em coordenadas de tela', () => {
  const frames = [{ pos: { x: 100, y: 100 }, size: { w: 200, h: 100 } }, { pos: { x: 400, y: 150 }, size: { w: 100, h: 200 } }]
  expect(groupFrame(frames, { offset: { x: 10, y: 20 }, zoom: 2 })).toEqual({ x: (100 - 16) * 2 + 10, y: (100 - 16) * 2 + 20, w: (400 + 32) * 2, h: (250 + 32) * 2 })
  expect(groupFrame([], { offset: { x: 0, y: 0 }, zoom: 1 })).toBeNull()
})

describe('grupos na tela', () => {
  let app: Harness
  const api = { create: vi.fn(async () => 'g2'), ungroup: vi.fn(async () => {}), rename: vi.fn(async () => {}), color: vi.fn(async () => {}) }
  const commit = vi.fn(async () => [])
  const node = (id: string, x: number, extra: object = {}) => ({ id, kind: 'note', name: id, content: '', floorId: null, pos: { x, y: 200 }, size: { w: 200, h: 100 }, ...extra })
  const grouped = () => emptyWorkspace({ nodes: { a: node('a', 100, { groupId: 'g1' }), b: node('b', 400, { groupId: 'g1' }), c: node('c', 700) } as never, groups: { g1: { name: 'Entrada', color: '#bbdefb' } } })
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); vi.clearAllMocks(); HTMLElement.prototype.setPointerCapture = () => {}; HTMLElement.prototype.releasePointerCapture = () => {} })
  afterEach(async () => { await app.unmount(); vi.unstubAllGlobals() })
  const mount = async (workspace = grouped()) => { app = await mountApp({ workspace, api: { 'group.create': api.create, 'group.ungroup': api.ungroup, 'group.rename': api.rename, 'group.color': api.color, 'history.commit': commit as never } }) }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const header = () => app.host.querySelector<HTMLElement>('.group-header')!
  const context = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })) }); await settle() }
  const items = () => [...document.querySelectorAll('[role=menuitem]')].map((e) => e.textContent!.trim())
  const choose = async (label: string) => { const el = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find((e) => e.textContent!.trim() === label)!; expect(el, label).toBeTruthy(); await act(async () => el.click()); await settle() }
  const type = async (value: string) => { const input = app.host.querySelector<HTMLInputElement>('.group-rename')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }); await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }); await settle() }

  it('desenha a moldura tracejada e o cabeçalho com o nome; sem nome, mostra "Grupo"', async () => {
    await mount()
    expect(app.host.querySelectorAll('.group-frame')).toHaveLength(1); expect(header().textContent).toBe('Entrada')
    await app.workspace({ ...grouped(), groups: { g1: { name: '' } } }); expect(header().textContent).toBe('Grupo')
    await app.workspace({ ...grouped(), nodes: { a: node('a', 100, { groupId: 'g1' }) } as never }); expect(app.host.querySelector('.group-frame')).toBeNull()
  })
  it('o menu do cabeçalho tem os itens do palco; Cor e Desagrupar agem no grupo inteiro', async () => {
    await mount(); await context(header())
    expect(items()).toEqual(['Renomear', 'Copiar Elemento', 'Cor', 'Partituras', 'Desagrupar'])
    await choose('Desagrupar'); expect(api.ungroup).toHaveBeenCalledWith(['a', 'b'])
    await context(header()); await act(async () => [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find((e) => e.textContent!.trim() === 'Cor')!.click()); await settle()
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role^=menuitem]')].find((e) => e.textContent!.trim() === 'Neutra')!.click()); await settle()
    expect(api.color).toHaveBeenCalledWith('g1', null)
  })
  it('duplo clique no cabeçalho renomeia, e o nome pode ser apagado; Escape cancela', async () => {
    await mount()
    await act(async () => { header().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) }); await type('Saída')
    expect(api.rename).toHaveBeenLastCalledWith('g1', 'Saída')
    await act(async () => { header().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) }); await type('')
    expect(api.rename).toHaveBeenLastCalledWith('g1', '')
    api.rename.mockClear()
    await act(async () => { header().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    await act(async () => { app.host.querySelector('.group-rename')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(app.host.querySelector('.group-rename')).toBeNull(); expect(api.rename).not.toHaveBeenCalled()
  })
  it('arrastar o cabeçalho move todos os membros num nível só de desfazer; o travado fica', async () => {
    await mount({ ...grouped(), nodes: { ...grouped().nodes, c: node('c', 700, { groupId: 'g1', positionLocked: true }) } as never })
    const at = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y })
    await act(async () => { header().dispatchEvent(at('pointerdown', 0, 0)) })
    await act(async () => { header().dispatchEvent(at('pointermove', 60, 40)) })
    await act(async () => { header().dispatchEvent(at('pointerup', 60, 40)) }); await settle()
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0]![1 as never]).toEqual([{ type: 'node.patch', id: 'a', patch: { pos: { x: 160, y: 240 } } }, { type: 'node.patch', id: 'b', patch: { pos: { x: 460, y: 240 } } }])
  })
  it('na seleção múltipla, Agrupar cria o grupo e já abre o nome; num membro, Desagrupar solta só ele', async () => {
    await mount(emptyWorkspace({ nodes: { a: node('a', 100), b: node('b', 400) } as never }))
    for (const [i, id] of ['a', 'b'].entries()) await act(async () => { app.host.querySelector(`[data-node-id="${id}"] .node-header`)!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: i + 2, shiftKey: true })) })
    await context(app.host.querySelector('[data-node-id="a"] .node-header')!)
    expect(items()).toContain('Agrupar'); expect(items()).not.toContain('Desagrupar')
    await choose('Agrupar'); expect(api.create).toHaveBeenCalledWith(['a', 'b'])
    await app.workspace(emptyWorkspace({ nodes: { a: node('a', 100, { groupId: 'g2' }), b: node('b', 400, { groupId: 'g2' }) } as never, groups: { g2: { name: '' } } }))
    expect(app.host.querySelector('.group-rename')).toBeTruthy()
  })
  it('um elemento sozinho de um grupo oferece Desagrupar', async () => {
    await mount()
    await context(app.host.querySelector('[data-node-id="a"] .node-header')!)
    expect(items()).not.toContain('Agrupar'); await choose('Desagrupar'); expect(api.ungroup).toHaveBeenCalledWith(['a'])
  })
})
