import { describe, expect, it } from 'vitest'
import { CLICK_THRESHOLD, MIN_DRAWN_SIDE, PLACE_DEFAULTS, placementFrame, type PlaceKind } from '../../src/renderer/src/canvas/placement'

describe('placementFrame', () => {
  it('arrasto de (13,7) a (300,200): snap para fora na grade de 20', () => {
    expect(placementFrame({ x: 13, y: 7 }, { x: 300, y: 200 }, 'terminal')).toEqual({ pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } })
    expect(placementFrame({ x: 13, y: 7 }, { x: 301, y: 219 }, 'terminal')).toEqual({ pos: { x: 0, y: 0 }, size: { w: 320, h: 220 } })
  })

  it('arrasto invertido (da direita para a esquerda, de baixo para cima) dá o mesmo frame', () => {
    const a = placementFrame({ x: 13, y: 7 }, { x: 300, y: 200 }, 'note')
    expect(placementFrame({ x: 300, y: 200 }, { x: 13, y: 7 }, 'note')).toEqual(a)
    expect(placementFrame({ x: 300, y: 7 }, { x: 13, y: 200 }, 'note')).toEqual(a)
  })

  it('coordenadas negativas também vão para fora', () => {
    expect(placementFrame({ x: -15, y: -41 }, { x: 95, y: 30 }, 'portal')).toEqual({ pos: { x: -20, y: -60 }, size: { w: 120, h: 100 } })
  })

  it.each(Object.keys(PLACE_DEFAULTS) as PlaceKind[])('arrasto de 10 px (%s): tamanho padrão centrado no ponto', (kind) => {
    const size = PLACE_DEFAULTS[kind]
    const start = { x: 1000, y: 500 }
    const frame = placementFrame(start, { x: 1010, y: 505 }, kind)
    expect(frame.size).toEqual(size)
    // Centrado até meia célula da grade (a posição também cai na grade).
    expect(Math.abs(frame.pos.x + size.w / 2 - start.x)).toBeLessThanOrEqual(10)
    expect(Math.abs(frame.pos.y + size.h / 2 - start.y)).toBeLessThanOrEqual(10)
    expect(frame.pos.x % 20).toBe(0)
    expect(frame.pos.y % 20).toBe(0)
  })

  it('tamanhos padrão das constraints', () => {
    expect(PLACE_DEFAULTS).toMatchObject({
      terminal: { w: 560, h: 360 }, note: { w: 260, h: 100 }, filetree: { w: 300, h: 300 }, portal: { w: 640, h: 420 }, text: { w: 240, h: 60 }
    })
    expect(CLICK_THRESHOLD).toBe(24)
  })

  it('o limiar vale nos dois eixos: 24 num eixo já é arrasto', () => {
    expect(placementFrame({ x: 0, y: 0 }, { x: 23, y: 23 }, 'terminal').size).toEqual(PLACE_DEFAULTS.terminal)
    expect(placementFrame({ x: 0, y: 0 }, { x: 200, y: 10 }, 'terminal').size.w).toBe(200)
  })

  it('retângulo fino ganha o lado mínimo (a validação do main recusa < 50)', () => {
    const frame = placementFrame({ x: 0, y: 0 }, { x: 300, y: 5 }, 'terminal')
    expect(frame.size).toEqual({ w: 300, h: MIN_DRAWN_SIDE })
    expect(MIN_DRAWN_SIDE).toBeGreaterThanOrEqual(50)
    expect(MIN_DRAWN_SIDE % 20).toBe(0)
  })
})

import { PlacementGesture } from '../../src/renderer/src/canvas/placement'

describe('PlacementGesture', () => {
  it('begin → move mostra o preview; end devolve o frame e limpa', () => {
    const g = new PlacementGesture()
    expect(g.preview).toBeNull()
    g.begin('note', { x: 13, y: 7 })
    expect(g.preview).toEqual({ pos: { x: 0, y: 0 }, size: { w: 20, h: 20 } })
    g.move({ x: 300, y: 200 })
    expect(g.preview).toEqual({ pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } })
    expect(g.end({ x: 300, y: 200 })).toEqual({ kind: 'note', frame: { pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } } })
    expect(g.preview).toBeNull()
    expect(g.active).toBe(false)
  })

  it('Esc no meio (cancel): o preview some e o soltar não cria nada', () => {
    const g = new PlacementGesture()
    g.begin('terminal', { x: 0, y: 0 })
    g.move({ x: 400, y: 300 })
    g.cancel()
    expect(g.preview).toBeNull()
    expect(g.end({ x: 400, y: 300 })).toBeNull()
  })

  it('arrasto que sai da janela (pointercancel ou perda de foco = cancel) não cria nada', () => {
    const g = new PlacementGesture()
    g.begin('portal', { x: 0, y: 0 })
    g.move({ x: 5000, y: 5000 })
    g.cancel()
    expect(g.move({ x: 10, y: 10 })).toBeNull()
    expect(g.end({ x: 10, y: 10 })).toBeNull()
  })

  it('move ou end sem begin são ignorados', () => {
    const g = new PlacementGesture()
    expect(g.move({ x: 1, y: 1 })).toBeNull()
    expect(g.end({ x: 1, y: 1 })).toBeNull()
  })
})
