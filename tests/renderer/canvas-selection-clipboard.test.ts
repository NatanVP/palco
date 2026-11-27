import type { Drawing, TerminalNode, Workspace } from '../../src/shared/model'
import { drawingBox, lassoHits, mergeSelection, normRect, selectAllHits } from '../../src/renderer/src/canvas/selection/lasso'
import { captureSelection, deleteOperations, movableNodeIds, moveOperations, pasteOffset, pasteOperations } from '../../src/renderer/src/canvas/selection/group'
import { selectionKeyAction } from '../../src/renderer/src/canvas/selection/keys'

const term = (id: string, x: number, y: number, extra: Partial<TerminalNode> = {}): TerminalNode => ({
  id, kind: 'terminal', floorId: null, name: id, agent: 'claude', command: 'claude', cwd: '/p', pos: { x, y }, size: { w: 100, h: 80 }, ...extra
})
const stroke = (id: string, pts: Array<[number, number]>, extra: Partial<Drawing> = {}): Drawing => ({
  id, floorId: null, points: pts.map(([x, y]) => ({ x, y })), color: '#000000', width: 4, ...extra
})
const ws = (nodes: Workspace['nodes'], drawings: Drawing[] = []): Workspace => ({
  id: 'w1', name: 'W', nodes, connections: [], camera: { offset: { x: 0, y: 0 }, zoom: 1 }, floors: {}, activeFloor: null, drawings
})

describe('laço: hit test com o item inteiro dentro', () => {
  it('retângulo normalizado em qualquer direção', () => {
    expect(normRect({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 40 })
  })
  it('caixa do desenho inclui metade da espessura visível', () => {
    expect(drawingBox(stroke('d', [[10, 10], [30, 20]]))).toEqual({ x: 8, y: 8, w: 24, h: 14 })
    expect(drawingBox(stroke('h', [[0, 0], [10, 0]], { tool: 'highlighter' }))).toEqual({ x: -8, y: -8, w: 26, h: 16 })
  })
  it('seleciona por interseção: nós e desenhos do andar ativo que tocam a área, sem bandas; só encostar não conta', () => {
    const w = ws({
      a: term('a', 0, 0), b: term('b', 150, 0), c: term('c', 0, 500),
      f: term('f', 10, 10, { floorId: 'x' }),
      band: { id: 'band', kind: 'band', floorId: null, name: 'B', members: ['a'], pos: { x: 0, y: 0 }, size: { w: 10, h: 10 } }
    }, [stroke('d1', [[20, 100], [60, 120]]), stroke('d2', [[20, 100], [400, 120]])])
    expect(lassoHits({ x: -5, y: -5, w: 300, h: 200 }, w)).toEqual({ nodes: ['a', 'b'], drawings: ['d1', 'd2'] })
    // Só a ponta de b (x 150..250) entra no laço até x=160; o d2 (traço comprido) também é pego por um canto da caixa.
    expect(lassoHits({ x: -5, y: -5, w: 165, h: 200 }, w)).toEqual({ nodes: ['a', 'b'], drawings: ['d1', 'd2'] })
    expect(lassoHits({ x: 90, y: 10, w: 20, h: 20 }, w)).toEqual({ nodes: ['a'], drawings: [] })
    // Encostar a borda sem área em comum não seleciona (a termina em x=100; b começa em x=150).
    expect(lassoHits({ x: 100, y: 0, w: 50, h: 80 }, w)).toEqual({ nodes: [], drawings: [] })
    expect(lassoHits({ x: -50, y: 80, w: 50, h: 10 }, w)).toEqual({ nodes: [], drawings: [] })
  })
  it('fichário: selecionar a nota da frente leva as outras do fichário', () => {
    const note = (id: string) => ({ id, kind: 'note' as const, floorId: null, name: id, content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 }, stackId: 's' })
    expect(lassoHits({ x: -1, y: -1, w: 200, h: 200 }, ws({ n1: note('n1'), n2: note('n2') })).nodes.sort()).toEqual(['n1', 'n2'])
  })
  it('Shift soma (união); sem Shift substitui', () => {
    const prev = { nodes: new Set(['a']), drawings: new Set(['d0']) }
    const hits = { nodes: ['b'], drawings: ['d1'] }
    const sum = mergeSelection(prev, hits, true)
    expect([...sum.nodes].sort()).toEqual(['a', 'b'])
    expect([...sum.drawings].sort()).toEqual(['d0', 'd1'])
    const only = mergeSelection(prev, hits, false)
    expect([...only.nodes]).toEqual(['b'])
    expect([...only.drawings]).toEqual(['d1'])
  })
})

describe('ações em grupo como uma transação', () => {
  const w = ws({ a: term('a', 0, 0), b: term('b', 150, 0) }, [stroke('d1', [[0, 0], [10, 10]], { tool: 'line' })])
  it('apagar: node.remove e drawing.remove num lote só', () => {
    expect(deleteOperations(w, ['a', 'b'], ['d1'])).toEqual([
      { type: 'node.remove', id: 'a' }, { type: 'node.remove', id: 'b' }, { type: 'drawing.remove', id: 'd1' }
    ])
  })
  it('mover: delta comum encaixado na grade para nós e desenhos; o desenho é recriado deslocado', () => {
    expect(moveOperations(w, ['a', 'b'], ['d1'], { x: 41, y: 19 })).toEqual([
      { type: 'node.patch', id: 'a', patch: { pos: { x: 40, y: 20 } } },
      { type: 'node.patch', id: 'b', patch: { pos: { x: 190, y: 20 } } },
      { type: 'drawing.remove', id: 'd1' },
      { type: 'drawing.add', drawing: { floorId: null, points: [{ x: 40, y: 20 }, { x: 50, y: 30 }], color: '#000000', width: 4, tool: 'line' } }
    ])
  })
})

describe('copiar, colar e duplicar', () => {
  const source = ws({
    t: term('t', 100, 100, { accountId: 'acc', role: 'tech-lead', color: '#FF0000', icon: 'bot', fontSize: 14, monitor: true, maestro: true, recruitedBy: 'x', autoStart: false }),
    n: { id: 'n', kind: 'note', floorId: null, name: 'Nota', content: 'oi', pos: { x: 300, y: 100 }, size: { w: 100, h: 100 }, stackId: 's', color: '#123456' },
    p: { id: 'p', kind: 'portal', floorId: null, name: 'Web', url: 'https://a.com/', pos: { x: 100, y: 300 }, size: { w: 400, h: 300 }, storage: 'isolated', userAgent: 'UA/1' }
  }, [stroke('d', [[100, 100], [150, 150]])])

  it('a cópia do terminal leva a configuração, não o processo nem o vínculo de quem recrutou', () => {
    const clip = captureSelection(source, ['t', 'n', 'p'], ['d'])
    const t = clip.nodes.find((n) => n.kind === 'terminal')!
    expect(t).toEqual({
      kind: 'terminal', floorId: null, name: 't', agent: 'claude', command: 'claude', cwd: '/p', accountId: 'acc', role: 'tech-lead',
      color: '#FF0000', icon: 'bot', fontSize: 14, monitor: true, pos: { x: 100, y: 100 }, size: { w: 100, h: 80 }
    })
    const n = clip.nodes.find((x) => x.kind === 'note')!
    expect(n).toMatchObject({ content: 'oi', color: '#123456' })
    expect(n).toMatchObject({ stackId: 's' }) // a cópia guarda o fichário de origem; o colar troca por um id novo (portal-drawing-preference-recovery)
    expect(clip.nodes.find((x) => x.kind === 'portal')).toMatchObject({ url: 'https://a.com/', storage: 'isolated', userAgent: 'UA/1' })
    expect(clip.drawings).toHaveLength(1)
    expect(clip.box).toEqual({ x: 98, y: 98, w: 402, h: 502 })
  })

  it('colar: um lote de node.add e drawing.add, deslocado, com nomes únicos', () => {
    const clip = captureSelection(source, ['t'], ['d'])
    const ops = pasteOperations(clip, { x: 30, y: 30 }, ['t', 't 2'], 'f1')
    expect(ops).toEqual([
      { type: 'node.add', node: expect.objectContaining({ kind: 'terminal', name: 't 3', floorId: 'f1', pos: { x: 130, y: 130 } }) },
      { type: 'drawing.add', drawing: expect.objectContaining({ floorId: 'f1', points: [{ x: 130, y: 130 }, { x: 180, y: 180 }] }) }
    ])
  })

  it('deslocamento: Ctrl+V centra no meio da vista; repetir soma 30', () => {
    const clip = captureSelection(source, ['t'], [])
    expect(pasteOffset(clip.box, { x: 1000, y: 1000 }, 0)).toEqual({ x: 850, y: 860 })
    expect(pasteOffset(clip.box, { x: 1000, y: 1000 }, 2)).toEqual({ x: 910, y: 920 })
  })

  it('bandas não entram na cópia', () => {
    const w = ws({ b: { id: 'b', kind: 'band', floorId: null, name: 'B', members: [], pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } } })
    expect(captureSelection(w, ['b'], []).nodes).toEqual([])
  })
})

describe('teclas do laço', () => {
  const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, target: Partial<HTMLElement> = { tagName: 'DIV' }) =>
    ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, repeat: false, ...mods, target: { closest: () => null, isContentEditable: false, ...target } }) as unknown as KeyboardEvent
  const st = { hasSelection: true }
  it('Delete/Backspace apagam a seleção; Ctrl+C, Ctrl+V e Ctrl+D copiam, colam e duplicam; H alterna o pan; Space segura o pan', () => {
    expect(selectionKeyAction(ev('Delete'), st)).toEqual({ kind: 'delete' })
    expect(selectionKeyAction(ev('Backspace'), st)).toEqual({ kind: 'delete' })
    expect(selectionKeyAction(ev('Delete'), { hasSelection: false })).toBeNull()
    expect(selectionKeyAction(ev('c', { ctrlKey: true }), st)).toEqual({ kind: 'copy' })
    expect(selectionKeyAction(ev('c', { metaKey: true }), st)).toEqual({ kind: 'copy' })
    expect(selectionKeyAction(ev('v', { ctrlKey: true }), { hasSelection: false })).toEqual({ kind: 'paste' })
    expect(selectionKeyAction(ev('d', { ctrlKey: true }), st)).toEqual({ kind: 'duplicate' })
    expect(selectionKeyAction(ev('c', { ctrlKey: true, shiftKey: true }), st)).toBeNull()
    expect(selectionKeyAction(ev('h'), { hasSelection: false })).toEqual({ kind: 'toggle-pan' })
    expect(selectionKeyAction(ev('Control', { ctrlKey: true }), { hasSelection: false })).toEqual({ kind: 'hold-pan' })
  })
  it('foco em campo, nota em edição, terminal, portal ou diálogo: as teclas ficam com eles', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'WEBVIEW' },
      { tagName: 'DIV', closest: ((s: string) => (s.includes('.xterm') ? {} : null)) as never }]) {
      expect(selectionKeyAction(ev('Delete', {}, target), st)).toBeNull()
      expect(selectionKeyAction(ev('v', { ctrlKey: true }, target), st)).toBeNull()
    }
    expect(selectionKeyAction({ ...ev('Delete'), defaultPrevented: true } as KeyboardEvent, st)).toBeNull()
  })
})

describe('o main aceita a cópia da nota com a aparência', () => {
  it('node.add de nota guarda cor, fonte e trava válidas e recusa inválidas', async () => {
    const { parseNewNode } = await import('../../src/main/validate')
    const base = { kind: 'note', name: 'N', content: 'x', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
    expect(parseNewNode({ ...base, color: '#123456', fontSize: 14, fontFamily: 'serif', locked: true })).toMatchObject({ color: '#123456', fontSize: 14, fontFamily: 'serif', locked: true })
    expect(() => parseNewNode({ ...base, color: 'red' })).toThrow()
    expect(parseNewNode(base)).not.toHaveProperty('color')
  })
})

describe('nome da cópia', () => {
  it('cópia de "A 2" vira "A 3", não "A 2 2"', async () => {
    const { uniqueName } = await import('../../src/renderer/src/canvas/selection/group')
    expect(uniqueName('A 2', new Set(['a', 'a 2']))).toBe('A 3')
    expect(uniqueName('A', new Set(['a']))).toBe('A 2')
    expect(uniqueName('Sprint 2024', new Set(['sprint 2024']))).toBe('Sprint 2')
    expect(uniqueName('Livre', new Set())).toBe('Livre')
  })
})

describe('cordas entre os itens copiados', () => {
  const t = (id: string, x: number) => term(id, x, 0)
  const w: Workspace = {
    ...ws({ a: t('a', 0), b: t('b', 200), c: t('c', 400) }),
    connections: [{ id: 'k1', a: 'a', b: 'b' }, { id: 'k2', a: 'b', b: 'c' }]
  }
  it('a cópia guarda só as cordas com as duas pontas copiadas, pelo índice', () => {
    const clip = captureSelection(w, ['a', 'b'], [])
    expect(clip.connections).toEqual([{ a: 0, b: 1 }])
  })
  it('colar e duplicar criam essas cordas no mesmo lote, apontando para os node.add', () => {
    const clip = captureSelection(w, ['b', 'a', 'c'], [])
    const ops = pasteOperations(clip, { x: 30, y: 30 }, ['a', 'b', 'c'], null)
    expect(ops.slice(3)).toEqual([
      { type: 'connection.add', a: { op: 1 }, b: { op: 0 } },
      { type: 'connection.add', a: { op: 0 }, b: { op: 2 } }
    ])
    expect(ops.slice(0, 3).every((op) => op.type === 'node.add')).toBe(true)
  })
  it('sem corda interna, nenhuma connection.add', () => {
    expect(pasteOperations(captureSelection(w, ['a', 'c'], []), { x: 0, y: 0 }, [], null).some((op) => op.type === 'connection.add')).toBe(false)
  })
})

describe("setas, Ctrl+A e itens travados", () => {
  const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, target: Partial<HTMLElement> = { tagName: 'DIV' }) =>
    ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, repeat: false, ...mods, target: { closest: () => null, isContentEditable: false, ...target } }) as unknown as KeyboardEvent
  const locked = { id: 'n', kind: 'note', floorId: null, name: 'N', content: '', locked: true, pos: { x: 300, y: 0 }, size: { w: 100, h: 100 } } as const
  it('as setas movem a seleção 1 unidade; Shift move 10; com Ctrl, Alt ou Meta ficam livres para outros atalhos', () => {
    const st = { hasSelection: true }
    expect(selectionKeyAction(ev('ArrowLeft'), st)).toEqual({ kind: 'nudge', by: { x: -1, y: 0 } })
    expect(selectionKeyAction(ev('ArrowRight'), st)).toEqual({ kind: 'nudge', by: { x: 1, y: 0 } })
    expect(selectionKeyAction(ev('ArrowUp'), st)).toEqual({ kind: 'nudge', by: { x: 0, y: -1 } })
    expect(selectionKeyAction(ev('ArrowDown', { shiftKey: true }), st)).toEqual({ kind: 'nudge', by: { x: 0, y: 10 } })
    expect(selectionKeyAction(ev('ArrowDown', { altKey: true }), st)).toBeNull(); expect(selectionKeyAction(ev('ArrowDown', { ctrlKey: true }), st)).toBeNull(); expect(selectionKeyAction(ev('ArrowDown', { metaKey: true }), st)).toBeNull()
    expect(selectionKeyAction(ev('ArrowDown'), { hasSelection: false })).toBeNull()
    expect(selectionKeyAction(ev('ArrowDown', {}, { tagName: 'TEXTAREA' }), st)).toBeNull()
  })
  it('Ctrl+A / Cmd+A selecionam tudo, mesmo sem seleção; Shift+Ctrl+A não', () => {
    expect(selectionKeyAction(ev('a', { ctrlKey: true }), { hasSelection: false })).toEqual({ kind: 'select-all' })
    expect(selectionKeyAction(ev('a', { metaKey: true }), { hasSelection: true })).toEqual({ kind: 'select-all' })
    expect(selectionKeyAction(ev('a', { ctrlKey: true }, { tagName: 'INPUT' }), { hasSelection: false })).toBeNull()
    expect(selectionKeyAction(ev('a', { ctrlKey: true, shiftKey: true }), { hasSelection: false })).toBeNull()
  })
  it('selecionar tudo: nós do andar (sem bandas, com o fichário inteiro) e desenhos do andar, sem olhar o que está dentro do laço', () => {
    const w = ws({ a: term('a', 5000, -3000), b: { id: 'b', kind: 'band', floorId: null, name: 'B', members: [], pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } }, x: term('x', 0, 0, { floorId: 'f1' }) }, [stroke('d1', [[-9000, 0], [10, 10]]), stroke('d2', [[0, 0], [1, 1]], { floorId: 'f1' })])
    expect(selectAllHits(w)).toEqual({ nodes: ['a'], drawings: ['d1'] })
  })
  it('nota travada não se move (setas, arrasto em grupo), mas o resto da seleção sim', () => {
    const w = ws({ a: term('a', 0, 0), n: locked })
    expect(moveOperations(w, ['a', 'n'], [], { x: 40, y: 0 })).toEqual([{ type: 'node.patch', id: 'a', patch: { pos: { x: 40, y: 0 } } }])
    expect(moveOperations(w, ['n'], [], { x: 40, y: 0 })).toEqual([])
    expect(movableNodeIds(w, ['a', 'n'])).toEqual(['a'])
  })
  it('seta move sem encaixar na grade (1 unidade de verdade) e recria o desenho deslocado', () => {
    const w = ws({ a: term('a', 0, 0) }, [stroke('d1', [[0, 0], [10, 10]], { tool: 'line' })])
    expect(moveOperations(w, ['a'], ['d1'], { x: 1, y: 0 }, { snap: false })).toEqual([
      { type: 'node.patch', id: 'a', patch: { pos: { x: 1, y: 0 } } },
      { type: 'drawing.remove', id: 'd1' },
      { type: 'drawing.add', drawing: { floorId: null, points: [{ x: 1, y: 0 }, { x: 11, y: 10 }], color: '#000000', width: 4, tool: 'line' } }
    ])
    expect(moveOperations(w, ['a'], [], { x: 1, y: 0 })).toEqual([])
  })
})
