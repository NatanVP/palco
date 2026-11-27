// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ContextualBar } from '../src/renderer/src/canvas/ContextualBar'
import { barContent, formatNote } from '../src/renderer/src/canvas/contextual'
import { NoteView } from '../src/renderer/src/nodes/NoteView'
import type { CanvasNode, Workspace } from '../src/shared/model'
const note: CanvasNode = { id: 'n', kind: 'note', name: 'Nota', content: 'texto', floorId: null, pos: { x: 0, y: 0 }, size: { w: 260, h: 100 } }
const portal: CanvasNode = { id: 'p', kind: 'portal', name: 'Portal', url: 'https://example.com/', floorId: null, pos: { x: 400, y: 0 }, size: { w: 640, h: 420 } }
const ws: Workspace = { id: 'w', name: 'W', nodes: { n: note, p: portal }, connections: [{ id: 'c', a: 'n', b: 'p' }], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 } }
const props = (selection: string[]) => ({ ws, selection: new Set(selection), linkFrom: null, onLink: vi.fn(), onEdit: vi.fn(), onCreateBand: vi.fn(), onFocus: vi.fn(), onCleared: vi.fn(), onError: vi.fn(), modeHint: null })
const nativeAnimate = Element.prototype.animate
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true, writable: true }) })
afterAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: nativeAnimate, configurable: true, writable: true }) })
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => vi.unstubAllGlobals())
it("distingue nota, portal e múltiplas notas (2+ notas oferecem o fichário)", () => {
  expect(barContent(ws, new Set(['n']))).toEqual({ kind: 'note', id: 'n' })
  expect(barContent(ws, new Set(['p']))).toEqual({ kind: 'portal', id: 'p' })
  const n2 = { ...note, id: 'n2' }
  expect(barContent({ ...ws, nodes: { ...ws.nodes, n2 } }, new Set(['n', 'n2']))).toEqual({ kind: 'notes', ids: ['n', 'n2'] })
})
it('formata seleção Markdown sem perder o restante ou quebrar blocos de código', () => {
  expect(formatNote('antes texto depois', 6, 11, { kind: 'bold' })).toMatchObject({ text: 'antes **texto** depois', start: 8, end: 13 })
  expect(formatNote('um\ndois', 0, 7, { kind: 'task' }).text).toBe('- [ ] um\n- [ ] dois')
  expect(formatNote('um\ndois', 3, 7, { kind: 'heading', level: 2 }).text).toBe('um\n## dois')
  expect(formatNote('a```b', 0, 5, { kind: 'code-block' }).text).toBe('````\na```b\n````')
  expect(() => formatNote('', 0, 0, { kind: 'image', url: 'javascript:alert(1)', alt: '' })).toThrow()
})
it('nota aplica negrito no editor ativo, copia rascunho e mantém selo/exclusão', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), api = { node: { patch: vi.fn(async () => {}), remove: vi.fn(async () => {}) }, connection: { remove: vi.fn(async () => {}) } }
  vi.stubGlobal('palco', api); Object.assign(window, { palco: api })
  const copy = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  const bar = props(['n'])
  try {
    await act(async () => root.render(createElement('div', null,
      createElement('div', { 'data-node-id': 'n' }, createElement(NoteView, { id: 'n', content: 'texto' })), createElement(ContextualBar, bar))))
    const area = host.querySelector('textarea')!; area.focus(); area.setSelectionRange(0, 5)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Negrito"]')!.click())
    expect(area.value).toBe('**texto**')
    expect(api.node.patch).toHaveBeenCalledWith('n', { content: '**texto**' })
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Mais ações da nota"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Copiar conteúdo"]')!.click())
    expect(copy).toHaveBeenCalledWith('**texto**')
    expect(host.querySelector('[aria-label="Conexões (1)"]')).not.toBeNull()
    // O campo `locked` impede a edição da nota.
    expect(host.querySelector('[aria-label="Travar conteúdo"]')).not.toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Excluir nota"]')!.click())
    expect(api.node.remove).toHaveBeenCalledWith('n')
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('portal recarrega guest, edita nome/endereço validado e fecha pelo API existente', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const bar = props(['p'])
  const patch = vi.fn(async () => {}), remove = vi.fn(async () => {}), reload = vi.fn(), loadURL = vi.fn(async () => {})
  Object.assign(window, { palco: { node: { patch, remove }, connection: { remove: vi.fn() } } })
  const card = document.createElement('div'); card.dataset.nodeId = 'p'
  const guest = document.createElement('webview'); Object.assign(guest, { reload, loadURL }); card.append(guest); host.append(card)
  const mount = document.createElement('div'); host.append(mount)
  const barRoot = createRoot(mount)
  try {
    await act(async () => barRoot.render(createElement(ContextualBar, bar)))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Recarregar portal"]')!.click())
    expect(reload).toHaveBeenCalledOnce()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Editar portal"]')!.click())
    const name = host.querySelector<HTMLInputElement>('[name="portal-name"]')!, url = host.querySelector<HTMLInputElement>('[name="portal-url"]')!
    name.value = 'Novo'; url.value = 'example.org'
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(loadURL).toHaveBeenCalledWith('https://example.org/')
    expect(patch).toHaveBeenCalledWith('p', { name: 'Novo', url: 'https://example.org/' })
    expect(host.querySelector('[aria-label="Modo design"]')).toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Fechar portal"]')!.click())
    expect(remove).toHaveBeenCalledWith('p')
  } finally { await act(async () => barRoot.unmount()); host.remove() }
})

it('seletor H oferece texto normal e remove só os prefixos de cabeçalho', async () => {
  expect(formatNote('## um\ntexto\n### dois', 0, 22, { kind: 'heading', level: 0 }).text).toBe('um\ntexto\ndois')
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const patch = vi.fn(async () => {})
  Object.assign(window, { palco: { node: { patch } } })
  try {
    await act(async () => root.render(createElement('div', null,
      createElement('div', { 'data-node-id': 'n' }, createElement(NoteView, { id: 'n', content: '## texto' })), createElement(ContextualBar, props(['n'])))))
    const area = host.querySelector('textarea')!; area.setSelectionRange(0, 8)
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Cabeçalho"]')!
    expect(select.querySelector('option[value="0"]')?.textContent).toBe('Texto normal')
    await act(async () => { select.value = '0'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(area.value).toBe('texto')
    expect(patch).toHaveBeenCalledWith('n', { content: 'texto' })
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('portal grava a edição mesmo se a navegação falhar', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const card = document.createElement('div'); card.dataset.nodeId = 'p'
  const guest = document.createElement('webview'), loadURL = vi.fn(async () => { throw new Error('offline') })
  Object.assign(guest, { loadURL }); card.append(guest); host.append(card)
  const mount = document.createElement('div'); host.append(mount); const root = createRoot(mount)
  const patch = vi.fn(async () => {}), bar = props(['p'])
  Object.assign(window, { palco: { node: { patch } } })
  try {
    await act(async () => root.render(createElement(ContextualBar, bar)))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Editar portal"]')!.click())
    host.querySelector<HTMLInputElement>('[name="portal-name"]')!.value = 'Nome salvo'
    host.querySelector<HTMLInputElement>('[name="portal-url"]')!.value = 'https://example.org/'
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(patch).toHaveBeenCalledWith('p', { name: 'Nome salvo', url: 'https://example.org/' })
    expect(bar.onError).toHaveBeenCalled()
    expect(host.querySelector('form')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove() }
})
it("colocar várias notas no fichário aplica um único lote de histórico", async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const multi = { ...ws, nodes: { ...ws.nodes, n2: { ...note, id: 'n2' } } }
  const commit = vi.fn(async (_workspaceId: string, _operations: unknown[]) => []), patch = vi.fn(async () => {})
  Object.assign(window, { palco: { node: { patch }, history: { commit } } })
  try {
    await act(async () => root.render(createElement(ContextualBar, { ...props(['n', 'n2']), ws: multi })))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Colocar no fichário"]')!.click())
    expect(commit).toHaveBeenCalledExactlyOnceWith('w', [
      { type: 'node.patch', id: 'n', patch: { stackId: expect.any(String), pos: note.pos, size: note.size } },
      { type: 'node.patch', id: 'n2', patch: { stackId: expect.any(String), pos: note.pos, size: note.size } }
    ])
    const operations = commit.mock.calls[0]![1] as unknown as Array<{ patch: { stackId: string } }>
    expect(operations[0]!.patch.stackId).toBe(operations[1]!.patch.stackId)
    expect(patch).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove() }
})
