import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseDrawing, parseDrawingPatch } from '../src/main/validate'
import { validateWorkspace } from '../src/main/domain/workspace-schema'
import { contrastColor, drawingTextLayout, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_DEFAULT, clampTextSize } from '../src/renderer/src/canvas/draw/text'
import { styleOperations, selectionStyle } from '../src/renderer/src/canvas/draw/style'
import { DrawingTextEditor } from '../src/renderer/src/canvas/draw/DrawingTextEditor'

const base = { floorId: null, points: [{ x: 0, y: 0 }, { x: 200, y: 100 }], color: '#FF3B30', width: 3 }
describe('texto dentro das formas: dados', () => {
  it('parseDrawing aceita text e textSize (8–200); recusa fora do contrato', () => {
    expect(parseDrawing({ ...base, tool: 'rect', text: 'Olá\nmundo', textSize: 24 })).toMatchObject({ text: 'Olá\nmundo', textSize: 24 })
    expect(() => parseDrawing({ ...base, textSize: 7 })).toThrow(); expect(() => parseDrawing({ ...base, textSize: 201 })).toThrow(); expect(() => parseDrawing({ ...base, text: 5 })).toThrow()
    expect(() => parseDrawing({ ...base, text: 'x'.repeat(5001) })).toThrow()
  })
  it('patch: text (null apaga) e textSize', () => {
    expect(parseDrawingPatch({ text: 'oi', textSize: 40 })).toEqual({ text: 'oi', textSize: 40 }); expect(parseDrawingPatch({ text: null })).toEqual({ text: null })
    expect(() => parseDrawingPatch({ textSize: 3 })).toThrow()
  })
  it('arquivo com texto inválido mantém o desenho e solta só o campo', () => {
    const ws = validateWorkspace({ id: 'w', name: 'W', version: 1, nodes: {}, connections: [], floors: {}, activeFloor: null, camera: { x: 0, y: 0, zoom: 1 }, drawings: [{ id: 'd', floorId: null, points: [{ x: 0, y: 0 }], color: '#000', width: 2, text: 7, textSize: 999 }] } as never) as unknown as { drawings: Array<Record<string, unknown>> }
    expect(ws.drawings[0]).toMatchObject({ id: 'd' }); expect(ws.drawings[0]).not.toHaveProperty('text'); expect(ws.drawings[0]).not.toHaveProperty('textSize')
  })
})
describe('texto dentro das formas: layout', () => {
  const d = (extra: object) => ({ ...base, tool: 'rect', text: 'Oi', ...extra }) as never
  it('limites e padrão do tamanho: 8 a 200, padrão 20, inteiro', () => { expect([TEXT_SIZE_MIN, TEXT_SIZE_MAX, TEXT_SIZE_DEFAULT]).toEqual([8, 200, 20]); expect(clampTextSize(3)).toBe(8); expect(clampTextSize(999)).toBe(200); expect(clampTextSize(21.4)).toBe(21) })
  it('coluna = largura − 16 (mínimo 40), centrada na forma; sem texto ou em forma sem área não há layout', () => {
    expect(drawingTextLayout(d({}))).toMatchObject({ x: 8, y: 0, width: 184, height: 100, fontSize: 20, text: 'Oi' })
    expect(drawingTextLayout(d({ points: [{ x: 0, y: 0 }, { x: 30, y: 30 }] }))!.width).toBe(40)
    expect(drawingTextLayout(d({ text: undefined }))).toBeNull(); expect(drawingTextLayout(d({ text: '' }))).toBeNull(); expect(drawingTextLayout(d({ tool: 'pen' }))).toBeNull(); expect(drawingTextLayout(d({ tool: 'arrow' }))).toBeNull()
  })
  it('ajuste óptico vertical: triângulo +12%, estrela +5%, coração −6% da altura', () => {
    expect(drawingTextLayout(d({ tool: 'triangle' }))!.y).toBeCloseTo(12); expect(drawingTextLayout(d({ tool: 'star' }))!.y).toBeCloseTo(5); expect(drawingTextLayout(d({ tool: 'heart' }))!.y).toBeCloseTo(-6)
  })
  it('cor: a do desenho; com preenchimento sólido, preto ou branco pelo contraste', () => {
    expect(drawingTextLayout(d({ fill: 'tint' }))!.color).toBe('#FF3B30'); expect(drawingTextLayout(d({ fill: 'solid', color: '#FFCC00' }))!.color).toBe('#000000')
    expect(drawingTextLayout(d({ fill: 'solid', color: '#000000' }))!.color).toBe('#FFFFFF'); expect(contrastColor('#007AFF')).toBe('#FFFFFF'); expect(contrastColor('#FFFFFF')).toBe('#000000')
  })
  it('o editor é uma caixa de texto centrada, com a mesma cor, fonte e coluna', () => {
    const html = renderToStaticMarkup(createElement(DrawingTextEditor, { drawing: { ...base, id: 'a', tool: 'rect', fill: 'solid' } as never, value: 'x', onChange: () => {}, onCommit: () => {} }))
    expect(html).toContain('<textarea'); expect(html).toContain('aria-label="Texto da forma"'); expect(html).toContain('font-size:20px'); expect(html).toContain('width:184px'); expect(html).toContain('color:#FFFFFF')
  })
})
describe('texto dentro das formas: estilo em lote', () => {
  const ws = { drawings: [{ ...base, id: 'a', tool: 'rect' }, { ...base, id: 'b', tool: 'pen' }] } as never
  it('o tamanho vai só para formas com área', () => {
    expect(styleOperations(ws, ['a', 'b'], { textSize: 32 })).toEqual([{ type: 'drawing.patch', id: 'a', patch: { textSize: 32 } }])
    expect(selectionStyle(ws, ['a'])!.value.textSize).toBe(20)
  })
})
