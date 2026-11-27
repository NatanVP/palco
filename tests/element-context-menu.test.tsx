// @vitest-environment happy-dom
// Menus por tipo de elemento: disponibilidade, ordem e efeitos das ações.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Canvas } from '../src/renderer/src/canvas/Canvas'
import { elementClipboard } from '../src/renderer/src/canvas/selection/clipboard'
import { captureSelection, movableNodeIds, moveOperations } from '../src/renderer/src/canvas/selection/group'
import { registerTerminal } from '../src/renderer/src/nodes/terminal-registry'
import { adoptPreferences, suspendShortcuts } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'
import { setLocale } from '../src/shared/i18n/runtime'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { validateWorkspace } from '../src/main/domain/workspace-schema'
import { CanvasHistory } from '../src/main/history/canvas-history'
import { lazyTerminals } from '../src/main/pty/wake'
import { unloadNodes, wakeNode } from '../src/main/node-state'
import { parseDrawingPatch, parseNewNode, parseNodePatch } from '../src/main/validate'
import type { CanvasNode, TerminalNode, Workspace } from '../src/shared/model'
vi.mock('../src/renderer/src/nodes/TerminalView', () => ({ TerminalView: () => null }))
vi.mock('../src/renderer/src/chat/ChatView', () => ({ ChatView: () => null }))

const base = { floorId: null, pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } }
const NODES: Record<string, CanvasNode> = {
  t: { id: 't', kind: 'terminal', name: 'Testes', agent: 'claude', command: 'claude', cwd: '/tmp', ...base, fontSize: 16, themeId: 'dracula' },
  s: { id: 's', kind: 'terminal', name: 'Sh', agent: 'shell', command: '', cwd: '/tmp', ...base },
  n: { id: 'n', kind: 'note', name: 'Nota', content: 'texto da nota', ...base, color: '#6aa8e8' },
  p: { id: 'p', kind: 'portal', name: 'Portal', url: 'https://exemplo.dev/', ...base },
  x: { id: 'x', kind: 'text', name: 'Txt', text: 'oi', fontSize: 20, ...base },
  a: { id: 'a', kind: 'filetree', name: 'Pasta', root: '/tmp', ...base },
  f: { id: 'f', kind: 'file', name: 'foto.png', path: '/tmp/foto.png', ...base },
  b: { id: 'b', kind: 'band', name: 'Time', members: ['m'], ...base },
  m: { id: 'm', kind: 'terminal', name: 'Membro', agent: 'shell', command: '', cwd: '/tmp', ...base }
}
const mkws = (patch: Record<string, Partial<CanvasNode>> = {}): Workspace => ({
  id: 'w', name: 'W', connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 },
  nodes: Object.fromEntries(Object.entries(NODES).map(([k, v]) => [k, { ...v, ...patch[k] } as CanvasNode])),
  drawings: [
    { id: 'd1', floorId: null, points: [{ x: 10, y: 10 }, { x: 60, y: 60 }], color: '#fff', width: 4, tool: 'rect' },
    { id: 'd2', floorId: null, points: [{ x: 100, y: 100 }, { x: 160, y: 160 }], color: '#fff', width: 4, tool: 'rect' }
  ]
})
const makeApi = () => ({
  workspace: { get: async () => mkws(), onChange: () => () => {} }, workspaces: { sidebar: async () => ({ workspaces: [] }) },
  node: { add: vi.fn(async () => 'novo'), patch: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
  nodeState: { unload: vi.fn(async () => {}), wake: vi.fn(async () => {}), reveal: vi.fn(async () => {}), open: vi.fn(async () => 'opened' as const), copyFile: vi.fn(async () => true), clearPortalStorage: vi.fn(async () => {}), copyScreenshot: vi.fn(async () => true) },
  terminal: { restart: vi.fn(async () => {}), setFocused: vi.fn(), write: vi.fn() },
  band: { add: vi.fn(async () => {}), dissolve: vi.fn(async () => {}) },
  preferences: { set: vi.fn(async () => defaultPreferences()) },
  history: { commit: vi.fn(async (_w: string, ops: unknown[]) => ops.map((_o, i) => `c${i}`)) },
  presets: { list: vi.fn(async () => []) }, partitura: { list: vi.fn(async () => []) },
  clipboard: { read: vi.fn(async () => ({ text: 'colado', files: [] as string[], image: false })), writeText: vi.fn(async () => {}), saveImage: vi.fn(async () => '/tmp/img.png' as string | null) },
  chat: { clearHistory: vi.fn(async () => {}), onChange: () => () => {} }, portal: { register: vi.fn() }, shell: { openExternal: vi.fn(async () => {}) },
  files: { list: vi.fn(async () => []), read: vi.fn(async () => ({ kind: 'binary', data: '', truncated: false })) }
})
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, api: ReturnType<typeof makeApi>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); suspendShortcuts(false); setLocale('pt-BR'); elementClipboard.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api = makeApi(); Object.assign(window, { palco: api })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals() })

const mount = async (ws = mkws(), extra: Record<string, unknown> = {}) => {
  const spy = { onCamera: vi.fn(), onSelectConn: vi.fn(), onSelectOnly: vi.fn(), onSelectMany: vi.fn(), onPlace: vi.fn(), onPartitura: vi.fn(), onEditTerminal: vi.fn(), onEditPortal: vi.fn(), onCreateBand: vi.fn(), onConfirm: vi.fn(), onFail: vi.fn() }
  await act(async () => root.render(createElement(Canvas, { ws, camera: ws.camera, linkFrom: null, onLink: vi.fn(), selectedConn: null, selection: new Set<string>(), onToggleSelect: vi.fn(), onGoToFloor: vi.fn(), ...spy, ...extra })))
  return spy
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const rightClick = async (target: Element) => act(async () => { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 200 })); await tick() })
const open = async (id: string) => rightClick(host.querySelector(`[data-node-id="${id}"] .node-header`) ?? host.querySelector(`[data-node-id="${id}"] .band-label`)!)
const menus = () => [...document.querySelectorAll('.cmenu-menu')]
const item = (id: string) => document.querySelector<HTMLButtonElement>(`[data-menu-id="${id}"]`)!
const labels = (i = 0) => [...menus()[i]!.children].map((e) => e.getAttribute('role') === 'separator' ? '—' : e.querySelector('.cmenu-label')!.textContent)
const click = async (id: string) => act(async () => { item(id).click(); await tick() })

const TAIL = ['Copiar Elemento', 'Duplicar', 'Partituras', '—', 'Bloquear', '—', 'Apagar']

describe('itens por tipo, na ordem do palco', () => {
  it('terminal: itens e ações disponíveis', async () => {
    await mount(); await open('t')
    expect(labels()).toEqual(['Copiar', 'Colar', 'Selecionar Tudo', '—', 'Renomear', 'Editar…', 'Monitorar Atividade', 'Adicionar à Banda', '—', 'Desfocar', 'Recarregar', 'Descarregar', 'Padrões para Novos Elementos', '—', ...TAIL])
    expect(item('copy').disabled).toBe(true)
    expect(item('monitor').getAttribute('aria-checked')).toBe('true')
    expect(item('delete').classList.contains('danger')).toBe(true)
  })
  it('shell começa sem Monitorar Atividade marcada', async () => { await mount(); await open('s'); expect(item('monitor').getAttribute('aria-checked')).toBe('false') })
  it.each([
    ['n', ['Renomear', 'Travar Conteúdo', 'Desfocar', '—', 'Copiar Conteúdo', 'Mover para fora…', 'Copiar Elemento', 'Duplicar', 'Cor', 'Padrões para Novos Elementos', '—', 'Partituras', '—', 'Bloquear', '—', 'Apagar']],
    ['p', ['Renomear', 'Editar…', 'Ocultar Moldura', 'Silenciar', 'Mostrar Tamanho', 'Escopo de Armazenamento', '—', 'Copiar Captura de Tela', 'Recarregar', 'Descarregar', 'Abrir no Navegador', 'Padrões para Novos Elementos', '—', ...TAIL]],
    ['x', TAIL],
    ['a', ['Mostrar na Pasta', '—', ...TAIL]],
    ['f', ['Abrir', 'Mostrar na Pasta', 'Copiar', '—', ...TAIL]],
    ['b', ['Renomear', 'Descarregar Banda', '—', 'Copiar Elemento', 'Duplicar', 'Partituras', '—', 'Desagrupar', '—', 'Apagar Banda']]
  ])('%s', async (id, expected) => { await mount(); await open(id); expect(labels()).toEqual(expected) })
  it('nenhum item mostra atalho de teclado', async () => { await mount(); await open('t'); expect(menus()[0]!.querySelector('kbd, .cmenu-shortcut')).toBeNull() })
  it('o botão direito num elemento não muda a seleção', async () => { const s = await mount(); await open('t'); expect(s.onSelectOnly).not.toHaveBeenCalled(); expect(s.onSelectMany).not.toHaveBeenCalled() })
})

describe('terminal: ações', () => {
  const fake = (selected = '') => { const t = { selection: () => selected, paste: vi.fn(), selectAll: vi.fn(), focus: vi.fn() }; return { t, off: registerTerminal('t', t) } }
  it('Copiar só com seleção; Colar usa o paste do xterm; Selecionar Tudo', async () => {
    const { t, off } = fake('saída')
    await mount(); await open('t'); expect(item('copy').disabled).toBe(false)
    await click('copy'); expect(api.clipboard.writeText).toHaveBeenCalledWith('saída')
    await open('t'); await click('paste'); expect(t.paste).toHaveBeenCalledWith('colado')
    await open('t'); await click('selectAll'); expect(t.selectAll).toHaveBeenCalled()
    off()
  })
  it('Colar uma imagem cola o caminho do arquivo gravado, entre aspas se preciso', async () => {
    const { t, off } = fake(); api.clipboard.read.mockResolvedValue({ text: '', files: [], image: true }); api.clipboard.saveImage.mockResolvedValue('/tmp/a b.png')
    await mount(); await open('t'); await click('paste'); expect(t.paste).toHaveBeenCalledWith("'/tmp/a b.png' ")
    off()
  })
  it('Renomear abre o campo no cabeçalho; Editar… abre o diálogo', async () => {
    const s = await mount(); await open('t'); await click('rename'); expect(host.querySelector('[data-node-id="t"] input.rename')).toBeTruthy()
    await open('s'); await click('edit'); expect(s.onEditTerminal).toHaveBeenCalledWith('s')
  })
  it('Monitorar Atividade grava o contrário do que está marcado', async () => {
    await mount(); await open('t'); await click('monitor'); expect(api.node.patch).toHaveBeenCalledWith('t', { monitor: false })
  })
  it('Desfocar, Recarregar, Descarregar e Bloquear', async () => {
    await mount(); await open('t'); await click('redact'); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'node.patch', id: 't', patch: { redacted: true } }])
    await open('t'); await click('reload'); expect(api.terminal.restart).toHaveBeenCalledWith('t')
    await open('t'); await click('unload'); expect(api.nodeState.unload).toHaveBeenCalledWith(['t'])
    await open('t'); await click('lock'); expect(api.node.patch).toHaveBeenLastCalledWith('t', { positionLocked: true })
  })
  it('com o elemento na seleção, Recarregar, Descarregar e Apagar valem para a seleção inteira', async () => {
    await mount(mkws(), { selection: new Set(['t', 's']) })
    await open('t'); await click('unload'); expect(api.nodeState.unload).toHaveBeenLastCalledWith(['t', 's'])
    await open('t'); await click('reload'); expect(api.terminal.restart.mock.calls.map((c) => (c as unknown as string[])[0])).toEqual(['t', 's'])
    await open('t'); await click('delete'); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'node.remove', id: 't' }, { type: 'node.remove', id: 's' }])
  })
  it('Padrões para Novos Elementos: tamanho, fonte e tema deste terminal; desabilita o que já é o padrão', async () => {
    await mount(); await open('t'); await click('defaults')
    expect(labels(1)).toEqual(['Usar Este Tamanho', 'Usar Esta Fonte', 'Usar Este Tema'])
    await click('defaults.size'); expect(api.preferences.set).toHaveBeenLastCalledWith({ defaultTerminalSize: { width: 300, height: 200 } })
    await open('t'); await click('defaults'); await click('defaults.font'); expect(api.preferences.set).toHaveBeenLastCalledWith({ terminalFontFamily: defaultPreferences().terminalFontFamily, terminalFontSize: 16 })
    await open('t'); await click('defaults'); await click('defaults.theme'); expect(api.preferences.set).toHaveBeenLastCalledWith({ defaultTerminalTheme: 'dracula', defaultTerminalDarkThemeId: null })
    await open('s'); await click('defaults'); expect(item('defaults.font').disabled).toBe(true); expect(item('defaults.theme').disabled).toBe(true)
  })
  it('Copiar Elemento e Duplicar agem no elemento clicado', async () => {
    const s = await mount(mkws(), { selection: new Set(['t', 's']) }); await open('t'); await click('copyElement')
    expect(elementClipboard.get()!.data.nodes.map((n) => n.name)).toEqual(['Testes'])
    await open('t'); await click('duplicate')
    expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'node.add', node: expect.objectContaining({ name: 'Testes 2', pos: { x: 30, y: 30 }, themeId: 'dracula' }) }])
    await tick(); expect(s.onSelectMany).toHaveBeenCalledWith(['c0'])
  })
  it('Adicionar à Banda lista as bandas do andar; Limpar Histórico do Chat só com o chat, e pede confirmação', async () => {
    const s = await mount(mkws({ t: { chatMode: true } as never })); await open('t'); await click('joinBand'); await click('joinBand:b'); expect(api.band.add).toHaveBeenCalledWith('b', 't')
    await open('t'); await click('clearChat'); expect(s.onConfirm).toHaveBeenCalled(); s.onConfirm.mock.calls[0]![0].onConfirm(); expect(api.chat.clearHistory).toHaveBeenCalledWith('t')
  })
})

describe('seleção múltipla', () => {
  it('Organizar, Alinhar e Criar Banda entram antes de Bloquear', async () => {
    const s = await mount(mkws({ s: { pos: { x: 500, y: 90 } }, n: { pos: { x: 900, y: 40 } } }), { selection: new Set(['t', 's', 'n']) })
    await open('t')
    const l = labels(); expect(l.slice(l.indexOf('Partituras'))).toEqual(['Partituras', '—', 'Organizar', 'Alinhar', 'Agrupar', 'Criar Banda', '—', 'Bloquear', '—', 'Apagar'])
    await click('align'); expect(labels(1)).toEqual(['Alinhar à Esquerda', 'Centralizar na Horizontal', 'Alinhar à Direita', '—', 'Alinhar no Topo', 'Centralizar na Vertical', 'Alinhar na Base', '—', 'Distribuir na Horizontal', 'Distribuir na Vertical'])
    await click('align.top'); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'node.patch', id: 's', patch: { pos: { x: 500, y: 0 } } }, { type: 'node.patch', id: 'n', patch: { pos: { x: 900, y: 0 } } }])
    await open('t'); await click('band.create'); expect(s.onCreateBand).toHaveBeenCalledWith(['t', 's'])
  })
  it('duas notas soltas: Colocar no Fichário', async () => {
    const ws = mkws(); ws.nodes.n2 = { ...NODES.n!, id: 'n2', name: 'Outra' } as CanvasNode
    await mount(ws, { selection: new Set(['n', 'n2']) }); await open('n')
    expect(labels()).toContain('Colocar no Fichário')
    expect(item('distribute') ?? null).toBeNull()
  })
})

describe('nota, portal, arquivos e banda: ações', () => {
  it('nota: travar conteúdo, copiar conteúdo, cor e padrões', async () => {
    await mount(); await open('n'); await click('lockContents'); expect(api.node.patch).toHaveBeenLastCalledWith('n', { locked: true })
    await open('n'); await click('copyContents'); expect(api.clipboard.writeText).toHaveBeenCalledWith('texto da nota')
    await open('n'); await click('color'); expect(labels(1)).toHaveLength(10); expect(item('color.blue').getAttribute('aria-checked')).toBe('true'); await click('color.pink'); expect(api.node.patch).toHaveBeenLastCalledWith('n', { color: '#e58fb0' })
    await open('n'); await click('defaults'); expect(labels(1)).toEqual(['Usar Este Tamanho', 'Usar Esta Cor', 'Usar Esta Fonte'])
    await click('defaults.color'); expect(api.preferences.set).toHaveBeenLastCalledWith({ defaultNoteColor: 'blue' })
  })
  it('portal: moldura, som, tamanho, escopo, limpar armazenamento, captura, recarregar e abrir fora', async () => {
    const s = await mount(); await open('p'); await click('chrome'); expect(api.node.patch).toHaveBeenLastCalledWith('p', { chromeHidden: true })
    await open('p'); await click('mute'); expect(api.node.patch).toHaveBeenLastCalledWith('p', { muted: true })
    await open('p'); await click('sizeReadout'); expect(labels(1)).toEqual(['Ao Redimensionar', 'Sempre', 'Nunca']); await click('sizeReadout.always'); expect(api.preferences.set).toHaveBeenLastCalledWith({ portalSizeReadout: 'always' })
    await open('p'); await click('storage'); expect(labels(1)).toEqual(['Isolado', 'Workspace', 'Global', '—', 'Limpar Armazenamento…']); await click('storage.isolated'); expect(api.node.patch).toHaveBeenLastCalledWith('p', { storage: 'isolated' })
    await open('p'); await click('storage'); await click('storage.clear'); expect(api.nodeState.clearPortalStorage).not.toHaveBeenCalled(); s.onConfirm.mock.calls[0]![0].onConfirm(); expect(api.nodeState.clearPortalStorage).toHaveBeenCalledWith('p')
    await open('p'); await click('screenshot'); expect(api.nodeState.copyScreenshot).toHaveBeenCalledWith('p')
    await open('p'); await click('unload'); expect(api.nodeState.unload).toHaveBeenLastCalledWith(['p'])
    await open('p'); await click('openExternal'); expect(api.shell.openExternal).toHaveBeenCalledWith('https://exemplo.dev/')
    await open('p'); await click('edit'); expect(s.onEditPortal).toHaveBeenCalledWith('p')
  })
  it('árvore e arquivo: mostrar na pasta, abrir e copiar', async () => {
    await mount(); await open('a'); await click('reveal'); expect(api.nodeState.reveal).toHaveBeenCalledWith('a')
    await open('f'); await click('open'); expect(api.nodeState.open).toHaveBeenCalledWith('f')
    await open('f'); await click('copyFile'); expect(api.nodeState.copyFile).toHaveBeenCalledWith('f')
  })
  it('banda: renomear, descarregar/recarregar os membros, desagrupar e apagar com confirmação', async () => {
    const s = await mount(); await open('b'); await click('bandLoad'); expect(api.nodeState.unload).toHaveBeenCalledWith(['m'])
    await open('b'); await click('rename'); expect(host.querySelector('.band-label input.rename')).toBeTruthy()
    await open('b'); await click('dissolve'); expect(api.band.dissolve).toHaveBeenCalledWith('b')
    await open('b'); await click('delete'); s.onConfirm.mock.calls.at(-1)![0].onConfirm(); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'node.remove', id: 'b' }, { type: 'node.remove', id: 'm' }])
    await mount(mkws({ m: { unloaded: true } as never })); await open('b'); expect(item('bandLoad').textContent).toBe('Recarregar Banda')
  })
})

describe('desenhos', () => {
  const hit = (i: number) => host.querySelectorAll('.drawing-hit')[i]!
  it('frente, trás, bloquear, duplicar e apagar', async () => {
    await mount(); await rightClick(hit(0))
    expect(labels()).toEqual(['Trazer para a Frente', 'Enviar para Trás', '—', 'Bloquear', '—', 'Duplicar', 'Apagar'])
    await click('front'); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'drawing.patch', id: 'd1', patch: { order: 'front' } }])
    await rightClick(hit(1)); await click('lock'); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'drawing.patch', id: 'd2', patch: { locked: true } }])
    await rightClick(hit(0)); await click('delete'); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'drawing.remove', id: 'd1' }])
  })
  it('desenho travado não se move com a seleção', () => {
    const ws = mkws(); ws.drawings![0]!.locked = true
    expect(moveOperations(ws, [], ['d1', 'd2'], { x: 40, y: 0 }).filter((o) => o.type === 'drawing.remove')).toEqual([{ type: 'drawing.remove', id: 'd2' }])
  })
})

describe('estados no cartão', () => {
  it('descarregado mostra o cartão com Acordar; desfocado cobre o conteúdo até o olho', async () => {
    await mount(mkws({ t: { unloaded: true } as never, p: { unloaded: true } as never, n: { redacted: true } as never }))
    expect(host.querySelector('[data-node-id="p"] webview')).toBeNull()
    const wake = host.querySelector<HTMLButtonElement>('[data-node-id="t"] .node-unloaded button')!
    await act(async () => wake.click()); expect(api.nodeState.wake).toHaveBeenCalledWith('t')
    const eye = host.querySelector<HTMLButtonElement>('[data-node-id="n"] .node-redacted button')!
    expect(eye.getAttribute('aria-label')).toBe('Remover Desfoque')
    await act(async () => eye.click()); expect(api.history.commit).toHaveBeenLastCalledWith('w', [{ type: 'node.patch', id: 'n', patch: { redacted: false } }])
    await open('t'); expect(item('unload').disabled).toBe(true)
  })
  it('bloqueado não tem alça de redimensionar, não se arrasta e o menu oferece Desbloquear', async () => {
    const s = await mount(mkws({ x: { positionLocked: true } }))
    expect(host.querySelector('[data-node-id="x"] .resize-handle')).toBeNull()
    await open('x'); expect(item('lock').textContent).toBe('Desbloquear')
    expect(movableNodeIds(mkws({ x: { positionLocked: true } }), ['x', 't'])).toEqual(['t'])
    expect(s.onFail).not.toHaveBeenCalled()
  })
})

describe('main', () => {
  const withStore = (fn: (s: WorkspaceStore) => void) => { const dir = mkdtempSync(join(tmpdir(), 'palco-element-menu-')); try { fn(new WorkspaceStore(join(dir, 'w.json'))) } finally { rmSync(dir, { recursive: true, force: true }) } }
  const term = { kind: 'terminal', floorId: null, name: 'T', agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } } as const
  it('validação: bloquear, desfocar e silenciar entram por patch; descarregar não', () => {
    expect(parseNodePatch({ positionLocked: true }, 'text')).toEqual({ positionLocked: true })
    expect(parseNodePatch({ redacted: true }, 'terminal')).toEqual({ redacted: true })
    expect(() => parseNodePatch({ redacted: true }, 'portal')).toThrow()
    expect(parseNodePatch({ muted: false }, 'portal')).toEqual({ muted: false })
    expect(() => parseNodePatch({ unloaded: true }, 'terminal')).toThrow()
    expect(parseNewNode({ ...term, positionLocked: true, redacted: true })).toMatchObject({ positionLocked: true, redacted: true })
    expect(parseDrawingPatch({ locked: true })).toEqual({ locked: true }); expect(parseDrawingPatch({ order: 'back' })).toEqual({ order: 'back' }); expect(() => parseDrawingPatch({ order: 'meio' })).toThrow()
  })
  it('descarregar encerra o processo e acordar sobe de novo; o descarregado não sobe sozinho', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'palco-element-menu-'))
    try {
      const store = new WorkspaceStore(join(dir, 'w.json')), id = store.addNode(term)
      const terminals = { dispose: vi.fn(), unload: vi.fn(async () => {}), startConfirmed: vi.fn(async () => {}), isRunning: () => false }, portals = { unregister: vi.fn() }
      const deps = { registry: { storeOfNode: () => store }, terminals, portals }
      await unloadNodes(deps, [id])
      expect((store.get().nodes[id] as TerminalNode).unloaded).toBe(true); expect(terminals.unload).toHaveBeenCalledWith(id)
      expect(lazyTerminals(store.get())).toEqual([])
      await wakeNode(deps, id)
      expect((store.get().nodes[id] as TerminalNode).unloaded).toBeUndefined(); expect(terminals.startConfirmed).toHaveBeenCalledTimes(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('o desfazer não ressuscita nem perde o estado descarregado, e não sobe terminal descarregado', () => withStore((store) => {
    const spawn = vi.fn(), history = new CanvasHistory({ spawn, dispose: vi.fn(), unregister: vi.fn() })
    const id = store.addNode(term)
    history.transact(store, () => store.patchNode(id, { name: 'Outro' }), false)
    store.setUnloaded(id, true)
    expect(history.observe(store)).toBe(false); expect(history.canUndo(store)).toBe(true)
    history.undo(store); expect((store.get().nodes[id] as TerminalNode).unloaded).toBe(true)
    history.transact(store, () => store.removeNode(id), false); history.undo(store); expect(spawn).not.toHaveBeenCalled()
  }))
  it('ordem e trava dos desenhos no arquivo; flags inválidas saem do workspace com aviso', () => withStore((store) => {
    const d = () => store.addDrawing({ floorId: null, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#fff', width: 2, tool: 'rect' })
    const a = d(), b = d()
    store.patchDrawing(a, { order: 'front' }); expect(store.get().drawings!.map((x) => x.id)).toEqual([b, a])
    store.patchDrawing(a, { order: 'back' }); expect(store.get().drawings!.map((x) => x.id)).toEqual([a, b])
    store.patchDrawing(a, { locked: true }); expect(store.get().drawings![0]!.locked).toBe(true)
    store.patchDrawing(a, { locked: false }); expect(store.get().drawings![0]!.locked).toBeUndefined()
    const id = store.addNode(term), raw = store.get() as unknown as { nodes: Record<string, Record<string, unknown>> }
    raw.nodes[id]!.unloaded = 'sim'; const warn = vi.fn(); validateWorkspace(raw, warn); expect(raw.nodes[id]!.unloaded).toBeUndefined(); expect(warn).toHaveBeenCalled()
  }))
  it('a cópia do elemento leva aparência, desfoque e trava, mas não o estado descarregado', () => {
    const clip = captureSelection(mkws({ t: { redacted: true, positionLocked: true, unloaded: true } as never }), ['t'], [])
    expect(clip.nodes[0]).toMatchObject({ themeId: 'dracula', redacted: true, positionLocked: true }); expect(clip.nodes[0]).not.toHaveProperty('unloaded')
  })
})
