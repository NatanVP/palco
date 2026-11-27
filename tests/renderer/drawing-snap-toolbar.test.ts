import { describe, expect, it } from 'vitest'
import type { Drawing, Vec } from '../../src/shared/model'
import { snapLine, styleOperations, selectionStyle } from '../../src/renderer/src/canvas/draw/style'

const pt = (x: number, y: number): Vec => ({ x, y })
const d = (id: string, extra: Partial<Drawing> = {}): Drawing => ({ id, floorId: null, color: '#FF3B30', width: 3, tool: 'rect', points: [pt(100, 100), pt(200, 200)], ...extra })

describe('encaixe de linha e seta nas bordas das formas', () => {
  const shapes = [d('r')]
  it('as duas pontas grudam na borda; o resto do gesto não muda', () => {
    expect(snapLine([pt(150, 94), pt(300, 300)], shapes, 12)).toEqual([pt(150, 100), pt(300, 300)])
    expect(snapLine([pt(20, 20), pt(96, 150)], shapes, 12)).toEqual([pt(20, 20), pt(100, 150)])
  })
  it('longe das bordas devolve igual; um desenho que não é forma com área não atrai', () => {
    const pts = [pt(0, 0), pt(500, 500)]; expect(snapLine(pts, shapes, 12)).toEqual(pts)
    expect(snapLine([pt(150, 94), pt(1, 1)], [d('p', { tool: 'pen' })], 12)).toEqual([pt(150, 94), pt(1, 1)])
  })
})
describe('estilo em lote dos desenhos selecionados', () => {
  const ws = { drawings: [d('a', { fill: 'hatch', radius: 4 }), d('b', { tool: 'pen' }), d('c', { tool: 'brush' })] } as never
  it('um drawing.patch por desenho, só com o que mudou; preenchimento e raio só nas formas com área', () => {
    expect(styleOperations(ws, ['a', 'b', 'c'], { color: '#007AFF', fill: 'solid', radius: 10, width: 5 })).toEqual([
      { type: 'drawing.patch', id: 'a', patch: { color: '#007AFF', fill: 'solid', radius: 10, width: 5 } },
      { type: 'drawing.patch', id: 'b', patch: { color: '#007AFF', width: 5 } },
      { type: 'drawing.patch', id: 'c', patch: { color: '#007AFF', width: 5 } }
    ])
  })
  it('o padrão do traço não vai para o pincel; ids que não existem somem; patch vazio não gera operação', () => {
    expect(styleOperations(ws, ['c', 'zzz'], { pattern: 'dashed' })).toEqual([])
    expect(styleOperations(ws, ['b', 'zzz'], { pattern: 'dashed' })).toEqual([{ type: 'drawing.patch', id: 'b', patch: { pattern: 'dashed' } }])
    expect(styleOperations(ws, ['a'], {})).toEqual([])
  })
  it('a barra mostra o estilo do primeiro desenho e sabe se há forma com área ou só pincel', () => {
    expect(selectionStyle(ws, ['a', 'b'])).toEqual({ value: { color: '#FF3B30', width: 3, pattern: 'solid', fill: 'hatch', radius: 4, textSize: 20 }, hasArea: true, onlyBrush: false })
    expect(selectionStyle(ws, ['c'])).toMatchObject({ hasArea: false, onlyBrush: true }); expect(selectionStyle(ws, ['zzz'])).toBeNull()
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrawToolbar, DrawingSelectionToolbar } from '../../src/renderer/src/canvas/draw/DrawToolbar'
import { DEFAULT_DRAW_STYLE } from '../../src/renderer/src/canvas/draw/tools'
import { drawingGeometry } from '../../src/renderer/src/canvas/draw/geometry'
import { styleFields } from '../../src/renderer/src/canvas/draw/style'

describe('barra de desenho: preenchimento e raio', () => {
  const html = (tool: string) => renderToStaticMarkup(createElement(DrawToolbar, { style: { ...DEFAULT_DRAW_STYLE, tool: tool as never }, onStyle: () => {} }))
  it('forma com área mostra Preenchimento e o raio; caneta, linha e seta não', () => {
    expect(html('rect')).toContain('aria-label="Preenchimento"'); expect(html('rect')).toContain('aria-label="Aumentar raio"'); expect(html('heart')).toContain('aria-label="Preenchimento"')
    for (const t of ['pen', 'line', 'arrow', 'brush']) { expect(html(t)).not.toContain('Preenchimento'); expect(html(t)).not.toContain('raio') }
  })
  it('o estado inicial é o do palco: sem preenchimento e raio 6', () => { expect(html('rect')).toContain('r 6') })
  it('barra de seleção: preenchimento/raio só quando há forma com área; só pincel desabilita o estilo do traço', () => {
    const bar = (hasArea: boolean, onlyBrush: boolean) => renderToStaticMarkup(createElement(DrawingSelectionToolbar, { value: { color: '#FF3B30', width: 3, pattern: 'solid', fill: 'none', radius: 6 }, hasArea, onlyBrush, onChange: () => {} }))
    expect(bar(true, false)).toContain('Preenchimento'); expect(bar(false, false)).not.toContain('Preenchimento'); expect(bar(false, true)).toMatch(/aria-label="Estilo do traço"[^>]*disabled/)
    expect(bar(true, false)).toContain('role="toolbar"')
  })
  it('o desenho novo grava preenchimento e raio só nas formas com área', () => {
    expect(styleFields({ tool: 'rect', fill: 'hatch', radius: 12, pattern: 'solid' })).toEqual({ fill: 'hatch', radius: 12 })
    expect(styleFields({ tool: 'cloud', fill: 'none', radius: 6, pattern: 'dashed' })).toEqual({ radius: 6, pattern: 'dashed' })
    expect(styleFields({ tool: 'pen', fill: 'solid', radius: 9, pattern: 'solid' })).toEqual({})
    expect(styleFields({ tool: 'brush', fill: 'none', radius: 6, pattern: 'dotted' })).toEqual({})
  })
  it('a geometria usa o raio gravado no desenho', () => { expect(drawingGeometry({ floorId: null, color: '#000', width: 3, tool: 'rect', radius: 12, points: [{ x: 0, y: 0 }, { x: 100, y: 80 }] }).d).toContain('A 12 12') })
})
