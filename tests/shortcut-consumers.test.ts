import { describe, expect, it } from 'vitest'
import { defaultShortcuts, matchShortcut, SHORTCUTS, type ShortcutId } from '../src/shared/shortcuts'
import { alignFrames, ALIGN_IDS } from '../src/renderer/src/canvas/commands/align'
import { connectedOrder, cycleId, spatialOrder } from '../src/renderer/src/canvas/commands/order'
import { tidyFrames, TIDY_LAYOUTS } from '../src/renderer/src/canvas/commands/tidy'
import { fitCamera, unionBox } from '../src/renderer/src/canvas/commands/view'
import { WorkspaceJumpArm } from '../src/renderer/src/canvas/commands/jump'
import { snapFrame } from '../src/renderer/src/canvas/commands/snap'
import { resolveCommand } from '../src/renderer/src/canvas/commands/keymap'
import { filterSearch, searchEntries } from '../src/renderer/src/search/search-index'
import { MAX_ZOOM, MIN_ZOOM } from '../src/renderer/src/canvas/camera'
import type { CanvasNode, Connection } from '../src/shared/model'

const ev = (key: string, extra: Record<string, unknown> = {}) => ({ key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })
const frame = (id: string, x: number, y: number, w = 100, h = 60) => ({ id, pos: { x, y }, size: { w, h } })
const node = (id: string, x: number, y: number, extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, kind: 'note', name: id, content: '', floorId: null, pos: { x, y }, size: { w: 100, h: 60 }, ...extra }) as CanvasNode

describe('padrões do palco', () => {
  const m = defaultShortcuts()
  const hit = (id: ShortcutId, e: ReturnType<typeof ev>) => matchShortcut(id, e, m)
  it('as ações do painel têm os padrões do palco', () => {
    expect(hit('nextWorkspace', ev('ArrowDown', { ctrlKey: true }))).toBe(true)
    expect(hit('prevWorkspace', ev('ArrowUp', { metaKey: true }))).toBe(true)
    expect(hit('nextNode', ev('Tab', { ctrlKey: true }))).toBe(true)
    expect(hit('prevNode', ev('Tab', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(hit('toggleFocus', ev('\\', { code: 'Backslash', ctrlKey: true }))).toBe(true)
    expect(hit('floorOverview', ev('\\', { code: 'Backslash', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(hit('zoomSelection', ev('\\', { code: 'Backslash', ctrlKey: true, altKey: true }))).toBe(true)
    expect(hit('nextConnected', ev('ArrowRight', { ctrlKey: true, altKey: true }))).toBe(true)
    expect(hit('prevConnected', ev('ArrowLeft', { ctrlKey: true, altKey: true }))).toBe(true)
    expect(hit('filter', ev('p', { ctrlKey: true }))).toBe(true)
    expect(hit('prompter', ev('P', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(hit('minimap', ev('M', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(hit('tidy', ev('T', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(hit('deleteSelection', ev('w', { ctrlKey: true }))).toBe(true)
    expect(hit('toggleSidebar', ev('s', { ctrlKey: true }))).toBe(true)
    expect(hit('chatSwap', ev('J', { ctrlKey: true, shiftKey: true }))).toBe(true)
  })
  it('zoom da roda é com Alt; encaixe e saltos são com Ctrl/Cmd', () => {
    expect(hit('zoomWheel', ev('', { altKey: true }))).toBe(true)
    expect(hit('zoomWheel', ev('', { ctrlKey: true }))).toBe(false)
    for (const id of ['tile', 'workspaceJump', 'nodeJump'] as const) { expect(hit(id, ev('', { ctrlKey: true })), id).toBe(true); expect(hit(id, ev('', { altKey: true })), id).toBe(false) }
  })
  it('alinhar e distribuir não têm atalho padrão, mas aceitam um', () => {
    for (const id of [...ALIGN_IDS]) expect(m[id], id).toEqual([])
  })
  it("nada fica reservado: toda ação do registro tem consumidor", () => {
    expect(SHORTCUTS.filter(s => s.reason).map(s => s.id)).toEqual([])
    expect(SHORTCUTS.find(s => s.id === 'lift')!.defaults).toEqual([])
    for (const s of SHORTCUTS.filter(x => x.reason)) expect(s.reason!.length).toBeGreaterThan(20)
  })
})

describe('alinhar e distribuir', () => {
  const fs = [frame('a', 0, 0, 100, 40), frame('b', 150, 50, 60, 80), frame('c', 400, 20, 200, 100)]
  const at = (r: ReturnType<typeof alignFrames>, id: string) => r.find(x => x.id === id)!.pos
  it('esquerda, direita, topo e base usam a borda extrema da seleção', () => {
    expect(alignFrames('left', fs).map(r => r.pos.x)).toEqual([0, 0, 0])
    expect(alignFrames('right', fs).map(r => r.pos.x)).toEqual([500, 540, 400])
    expect(alignFrames('top', fs).map(r => r.pos.y)).toEqual([0, 0, 0])
    expect(alignFrames('bottom', fs).map(r => r.pos.y)).toEqual([90, 50, 30])
  })
  it('centralizar leva os centros ao centro da caixa da seleção', () => {
    const r = alignFrames('centerHorizontally', fs), box = unionBox(fs), cx = box.x + box.w / 2
    for (const f of fs) expect(at(r, f.id).x + f.size.w / 2).toBeCloseTo(cx)
    const v = alignFrames('centerVertically', fs), cy = box.y + box.h / 2
    for (const f of fs) expect(at(v, f.id).y + f.size.h / 2).toBeCloseTo(cy)
  })
  it('distribuir mantém as pontas e iguala os vãos; exige três ou mais', () => {
    const r = alignFrames('distributeHorizontally', fs)
    expect(at(r, 'a').x).toBe(0); expect(at(r, 'c').x).toBe(400)
    const gapAB = at(r, 'b').x - (0 + 100), gapBC = 400 - (at(r, 'b').x + 60)
    expect(gapAB).toBeCloseTo(gapBC)
    expect(alignFrames('distributeHorizontally', fs.slice(0, 2))).toEqual([])
    const v = alignFrames('distributeVertically', [frame('a', 0, 0, 10, 10), frame('b', 0, 20, 10, 10), frame('c', 0, 300, 10, 10)])
    expect(v.find(x => x.id === 'b')!.pos.y).toBeCloseTo(150)
  })
  it('um elemento só não muda nada', () => { expect(alignFrames('left', [frame('a', 5, 5)])).toEqual([]) })
})

describe('ciclos de elementos', () => {
  const nodes = [node('c', 400, 10), node('a', 0, 0), node('b', 200, 20), node('d', 10, 300)]
  it('ordem espacial: linha por linha, da esquerda para a direita', () => { expect(spatialOrder(nodes).map(n => n.id)).toEqual(['a', 'b', 'c', 'd']) })
  it('o ciclo é circular nos dois sentidos e, sem atual, começa pelo primeiro (ou pelo último)', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(cycleId(ids, 'a', 1)).toBe('b'); expect(cycleId(ids, 'd', 1)).toBe('a')
    expect(cycleId(ids, 'a', -1)).toBe('d'); expect(cycleId(ids, null, 1)).toBe('a'); expect(cycleId(ids, null, -1)).toBe('d')
    expect(cycleId([], 'a', 1)).toBeNull()
  })
  it('conectados: os vizinhos do elemento âncora, em ordem espacial', () => {
    const conns: Connection[] = [{ id: '1', a: 'b', b: 'a' }, { id: '2', a: 'a', b: 'd' }, { id: '3', a: 'c', b: 'd' }]
    expect(connectedOrder(nodes, conns, 'a')).toEqual(['b', 'd'])
    expect(connectedOrder(nodes, conns, 'd')).toEqual(['a', 'c'])
    expect(connectedOrder(nodes, [], 'a')).toEqual([])
  })
  it('só entram os elementos do mesmo andar', () => {
    const other = [node('a', 0, 0), node('x', 50, 0, { floorId: 'f1' } as never)]
    expect(connectedOrder(other, [{ id: '1', a: 'a', b: 'x' }], 'a')).toEqual([])
  })
})

describe('organizar seleção', () => {
  const fs = [frame('a', 500, 500, 100, 50), frame('b', 0, 0, 100, 50), frame('c', 300, 40, 100, 50), frame('d', 700, 10, 100, 50)]
  it('grade, linha e coluna a partir do canto da seleção, com vão de 40', () => {
    expect(TIDY_LAYOUTS).toEqual(['grid', 'row', 'column'])
    const row = tidyFrames(fs, 'row'), col = tidyFrames(fs, 'column'), grid = tidyFrames(fs, 'grid')
    expect(row.map(r => r.pos.y)).toEqual([0, 0, 0, 0]); expect(row.map(r => r.pos.x).sort((a, b) => a - b)).toEqual([0, 140, 280, 420])
    expect(col.map(r => r.pos.x)).toEqual([0, 0, 0, 0]); expect(col.map(r => r.pos.y).sort((a, b) => a - b)).toEqual([0, 90, 180, 270])
    expect(new Set(grid.map(r => r.pos.x)).size).toBe(2); expect(new Set(grid.map(r => r.pos.y)).size).toBe(2)
  })
  it('nada se sobrepõe e a ordem espacial é mantida', () => {
    const r = tidyFrames(fs, 'row'), order = [...r].sort((p, q) => p.pos.x - q.pos.x).map(x => x.id)
    expect(order).toEqual(spatialOrder(fs.map(f => node(f.id, f.pos.x, f.pos.y))).map(n => n.id))
  })
})

describe('câmera', () => {
  it('enquadrar uma caixa: centra e respeita o zoom mínimo e máximo', () => {
    const cam = fitCamera({ x: 0, y: 0, w: 400, h: 200 }, { w: 1000, h: 600 })
    expect(cam.zoom).toBeGreaterThanOrEqual(MIN_ZOOM); expect(cam.zoom).toBeLessThanOrEqual(MAX_ZOOM)
    expect(cam.offset.x + 200 * cam.zoom).toBeCloseTo(500); expect(cam.offset.y + 100 * cam.zoom).toBeCloseTo(300)
    expect(fitCamera({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 600 }).zoom).toBe(MAX_ZOOM)
    expect(fitCamera({ x: 0, y: 0, w: 100000, h: 100000 }, { w: 1000, h: 600 }).zoom).toBe(MIN_ZOOM)
  })
  it('a caixa da seleção une as molduras', () => { expect(unionBox([frame('a', 0, 0, 10, 10), frame('b', 90, 40, 10, 10)])).toEqual({ x: 0, y: 0, w: 100, h: 50 }) })
})

describe('encaixe magnético', () => {
  it('cola a borda no vizinho mais próximo dentro do limite; fora dele, não mexe', () => {
    const others = [frame('o', 300, 0, 100, 100)]
    expect(snapFrame(frame('m', 193, 5, 100, 100), others, 12).pos.x).toBe(200)
    expect(snapFrame(frame('m', 405, 5, 100, 100), others, 12).pos.x).toBe(400)
    expect(snapFrame(frame('m', 150, 3, 100, 100), others, 12).pos).toEqual({ x: 150, y: 0 })
    expect(snapFrame(frame('m', 100, 500, 100, 100), others, 12).pos).toEqual({ x: 100, y: 500 })
  })
})

describe('pular por número', () => {
  it('toque duplo no modificador arma o salto de espaço de trabalho; o número vale uma vez e dentro do prazo', () => {
    const arm = new WorkspaceJumpArm()
    expect(arm.digit(0, 3)).toBeNull()
    arm.tap(1000); expect(arm.digit(1100, 3)).toBeNull()
    arm.tap(1200); arm.tap(1400); expect(arm.armed(1500)).toBe(true)
    expect(arm.digit(1600, 3)).toBe(2); expect(arm.digit(1700, 3)).toBeNull()
    arm.tap(5000); arm.tap(5100); expect(arm.digit(8000, 3)).toBeNull()
    arm.tap(9000); arm.tap(9100); expect(arm.digit(9200, 9)).toBe(8)
  })
})

describe('mapa de teclas → comandos', () => {
  const m = defaultShortcuts(), ctx = { shortcuts: m, jump: new WorkspaceJumpArm(), now: 0 }
  it('cada atalho vira o comando certo', () => {
    expect(resolveCommand(ev('ArrowDown', { ctrlKey: true }), ctx)).toEqual({ kind: 'workspace', dir: 1 })
    expect(resolveCommand(ev('ArrowUp', { ctrlKey: true }), ctx)).toEqual({ kind: 'workspace', dir: -1 })
    expect(resolveCommand(ev('Tab', { ctrlKey: true }), ctx)).toEqual({ kind: 'node', dir: 1 })
    expect(resolveCommand(ev('Tab', { ctrlKey: true, shiftKey: true }), ctx)).toEqual({ kind: 'node', dir: -1 })
    expect(resolveCommand(ev('ArrowRight', { ctrlKey: true, altKey: true }), ctx)).toEqual({ kind: 'connected', dir: 1 })
    expect(resolveCommand(ev('\\', { code: 'Backslash', ctrlKey: true }), ctx)).toEqual({ kind: 'toggleFocus' })
    expect(resolveCommand(ev('\\', { code: 'Backslash', ctrlKey: true, altKey: true }), ctx)).toEqual({ kind: 'zoomSelection' })
    expect(resolveCommand(ev('p', { ctrlKey: true }), ctx)).toEqual({ kind: 'search' })
    expect(resolveCommand(ev('M', { ctrlKey: true, shiftKey: true }), ctx)).toEqual({ kind: 'minimap' })
    expect(resolveCommand(ev('J', { ctrlKey: true, shiftKey: true }), ctx)).toEqual({ kind: 'chatSwap' })
    expect(resolveCommand(ev('T', { ctrlKey: true, shiftKey: true }), ctx)).toEqual({ kind: 'tidy' })
    expect(resolveCommand(ev('=', { code: 'Equal', ctrlKey: true }), ctx)).toEqual({ kind: 'zoom', op: 'in' })
    expect(resolveCommand(ev('-', { code: 'Minus', ctrlKey: true }), ctx)).toEqual({ kind: 'zoom', op: 'out' })
    expect(resolveCommand(ev('0', { code: 'Digit0', ctrlKey: true }), ctx)).toEqual({ kind: 'zoom', op: 'reset' })
    expect(resolveCommand(ev('x'), ctx)).toBeNull()
  })
  it('Ctrl+número salta ao elemento; com o toque duplo armado, salta ao espaço de trabalho', () => {
    expect(resolveCommand(ev('3', { code: 'Digit3', ctrlKey: true }), ctx)).toEqual({ kind: 'jumpNode', index: 2 })
    const jump = new WorkspaceJumpArm(); jump.tap(100); jump.tap(200)
    expect(resolveCommand(ev('2', { code: 'Digit2', ctrlKey: true }), { shortcuts: m, jump, now: 300 })).toEqual({ kind: 'jumpWorkspace', index: 1 })
  })
  it('alinhamentos só disparam depois de o usuário gravar uma tecla', () => {
    const custom = { ...m, left: [{ key: 'ArrowLeft', mod: true, shift: true }] }
    expect(resolveCommand(ev('ArrowLeft', { ctrlKey: true, shiftKey: true }), { ...ctx, shortcuts: custom })).toEqual({ kind: 'align', action: 'left' })
    expect(resolveCommand(ev('ArrowLeft', { ctrlKey: true, shiftKey: true }), ctx)).toBeNull()
  })
  it('as reservadas não disparam nada', () => { expect(resolveCommand(ev('a', { ctrlKey: true, shiftKey: true }), ctx)).toBeNull() })
})

describe('Batuta Search', () => {
  const entries = searchEntries({
    nodes: [node('n1', 0, 0, { name: 'Servidor API' }), { ...node('n2', 0, 0, { name: 'Notas da reunião' }) }],
    workspaces: [{ id: 'w1', name: 'Palco', active: true }, { id: 'w2', name: 'Site novo', active: false }],
    commands: [{ id: 'minimap', label: 'Alternar minimapa', hint: 'Ctrl+Shift+M' }]
  })
  it('indexa elementos, espaços de trabalho e comandos com o tipo de cada um', () => {
    expect(entries.map(e => e.kind)).toEqual(['node', 'node', 'workspace', 'workspace', 'command'])
  })
  it('filtra sem acento nem caixa e ordena por quem começa com o texto', () => {
    expect(filterSearch(entries, 'reuniao').map(e => e.label)).toEqual(['Notas da reunião'])
    expect(filterSearch(entries, 'SITE').map(e => e.label)).toEqual(['Site novo'])
    expect(filterSearch(entries, 'no').map(e => e.label)[0]).toBe('Notas da reunião')
    expect(filterSearch(entries, '').length).toBe(5)
    expect(filterSearch(entries, 'zzzz')).toEqual([])
  })
  it('o prefixo ">" mostra só comandos', () => {
    expect(filterSearch(entries, '>').every(e => e.kind === 'command')).toBe(true)
    expect(filterSearch(entries, '> mini').map(e => e.label)).toEqual(['Alternar minimapa'])
  })
})
