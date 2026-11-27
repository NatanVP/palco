import { describe, expect, it } from 'vitest'
import { dockDefaultWidth, dockNode, dockRect, dockZone, dismissLift, EMPTY_DOCK, landDocked, liftNode, panelKindOf, presentPanel, sanitizeDock, togglePanel, DOCK_MIN_WIDTH } from '../../src/renderer/src/canvas/dock'
import { liftFrame } from '../../src/renderer/src/canvas/lift'

const view = { w: 1400, h: 900 }
describe('dock de borda: geometria', () => {
  it('tipos de painel e larguras padrão: nota 400, terminal/portal 520, árvore 340', () => {
    expect(panelKindOf({ kind: 'note' } as never)).toBe('note'); expect(panelKindOf({ kind: 'terminal' } as never)).toBe('wide'); expect(panelKindOf({ kind: 'portal' } as never)).toBe('wide'); expect(panelKindOf({ kind: 'filetree' } as never)).toBe('tree')
    expect([dockDefaultWidth('note'), dockDefaultWidth('wide'), dockDefaultWidth('tree')]).toEqual([400, 520, 340])
  })
  it('borda de trás: encostada à direita com 12 de folga; da frente: logo depois do recuo da barra lateral', () => {
    const t = dockRect('wide', 'trailing', view, { leadingInset: 0 }), l = dockRect('wide', 'leading', view, { leadingInset: 62 })
    expect(t.w).toBe(520); expect(t.x).toBe(1400 - 520 - 12); expect(l.x).toBe(62 + 12)
    expect(t.y).toBe(l.y); expect(t.h).toBe(900 - t.y - 64); expect(l.h).toBe(900 - l.y - 16)
  })
  it('largura: sua escolha, entre 280 e metade da área livre (mín. 280)', () => {
    expect(dockRect('note', 'trailing', view, { leadingInset: 0, width: 100 }).w).toBe(DOCK_MIN_WIDTH); expect(dockRect('note', 'trailing', view, { leadingInset: 0, width: 5000 }).w).toBe(700)
    expect(dockRect('note', 'trailing', { w: 400, h: 900 }, { leadingInset: 0 }).w).toBe(280)
  })
})
describe('dock de borda: arrasto do painel', () => {
  const at = (x: number, translation = 0) => ({ x, translation })
  it('perto da borda (110 px) encaixa; no meio fica; o encaixado que anda 140 px para o centro vira elevado', () => {
    expect(dockZone(at(1300), EMPTY_DOCK, view, 0)).toEqual({ kind: 'dock', edge: 'trailing' }); expect(dockZone(at(40), EMPTY_DOCK, view, 0)).toEqual({ kind: 'dock', edge: 'leading' })
    expect(dockZone(at(700), EMPTY_DOCK, view, 0)).toEqual({ kind: 'stay' })
    const docked = { ...EMPTY_DOCK, dockedId: 'a' }
    expect(dockZone({ ...at(700, -200) }, docked, view, 0, 'a')).toEqual({ kind: 'center' }); expect(dockZone(at(700, -100), docked, view, 0, 'a')).toEqual({ kind: 'stay' })
  })
  it('a faixa da frente começa depois do recuo da barra lateral', () => { expect(dockZone(at(150), EMPTY_DOCK, view, 62)).toEqual({ kind: 'dock', edge: 'leading' }); expect(dockZone(at(200), EMPTY_DOCK, view, 62)).toEqual({ kind: 'stay' }) })
})
describe('dock de borda: estados', () => {
  it('elevar e encaixar são exclusivos para o mesmo nó; encaixar lembra o nó', () => {
    let s = liftNode(EMPTY_DOCK, 'a'); expect(s.liftedId).toBe('a')
    s = dockNode(s, 'a', 'leading'); expect(s).toEqual({ dockedId: 'a', edge: 'leading', memory: ['a'], liftedId: null })
    s = liftNode(s, 'a'); expect(s.dockedId).toBeNull(); expect(s.liftedId).toBe('a'); expect(s.memory).toEqual(['a'])
  })
  it('um nó elevado e outro encaixado convivem; encaixar outro troca o encaixado', () => {
    let s = dockNode(EMPTY_DOCK, 'a', 'trailing'); s = liftNode(s, 'b'); expect(s).toMatchObject({ dockedId: 'a', liftedId: 'b' })
    s = dockNode(s, 'c', 'trailing'); expect(s).toMatchObject({ dockedId: 'c', liftedId: 'b', memory: ['a', 'c'] })
  })
  it('atalho: com algo elevado recolhe; no encaixado desencaixa; nó lembrado volta encaixado; senão eleva', () => {
    const lifted = liftNode(EMPTY_DOCK, 'a'); expect(togglePanel(lifted, 'a')).toMatchObject({ liftedId: null }); expect(togglePanel(lifted, 'z')).toMatchObject({ liftedId: null })
    const docked = dockNode(EMPTY_DOCK, 'a', 'leading'); expect(togglePanel(docked, 'a')).toMatchObject({ dockedId: null, memory: ['a'] })
    expect(togglePanel(landDocked(docked), 'a')).toMatchObject({ dockedId: 'a', edge: 'leading' }); expect(togglePanel(EMPTY_DOCK, 'b')).toMatchObject({ liftedId: 'b', dockedId: null })
    expect(presentPanel(EMPTY_DOCK, 'q').liftedId).toBe('q'); expect(dismissLift(lifted).liftedId).toBeNull()
  })
  it('sanitizeDock tira o que não existe mais', () => {
    const s = { dockedId: 'x', edge: 'leading' as const, memory: ['x', 'a'], liftedId: 'y' }
    expect(sanitizeDock(s, new Set(['a']))).toEqual({ dockedId: null, edge: 'leading', memory: ['a'], liftedId: null })
    expect(sanitizeDock({ ...s, liftedId: 'a', dockedId: 'a' }, new Set(['a']))).toMatchObject({ dockedId: 'a', liftedId: null })
  })
  it('o painel encaixado usa a mesma moldura de mundo do elevado (tamanho real, escala 1/zoom)', () => {
    const r = dockRect('wide', 'trailing', view, { leadingInset: 0 })
    expect(liftFrame(r, { offset: { x: 0, y: 0 }, zoom: 0.5 }).scale).toBe(2)
  })
})
