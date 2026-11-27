import { describe, expect, it } from 'vitest'
import { DRAW_FILLS, DRAW_KINDS } from '../src/shared/model'
import { parseDrawing, parseDrawingPatch } from '../src/main/validate'
import { validateWorkspace } from '../src/main/domain/workspace-schema'

const base = { floorId: null, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#FF3B30', width: 3 }
describe('desenho: formas, preenchimento, raio e curva', () => {
  it('as formas extras do palco existem', () => {
    for (const k of ['oval', 'parallelogram', 'cloud', 'heart', 'boxX', 'checkbox', 'arrowLeft', 'arrowUp', 'arrowDown', 'arrowRight']) expect(DRAW_KINDS).toContain(k)
    expect([...DRAW_FILLS]).toEqual(['none', 'hatch', 'cross', 'tint', 'solid'])
  })
  it('parseDrawing aceita fill, radius e control e recusa valores fora do contrato', () => {
    expect(parseDrawing({ ...base, tool: 'cloud', fill: 'hatch', radius: 12, control: { x: 5, y: 20 } })).toMatchObject({ tool: 'cloud', fill: 'hatch', radius: 12, control: { x: 5, y: 20 } })
    expect(() => parseDrawing({ ...base, fill: 'xis' })).toThrow(/fill/)
    expect(() => parseDrawing({ ...base, radius: -1 })).toThrow(); expect(() => parseDrawing({ ...base, radius: 9999 })).toThrow()
    expect(() => parseDrawing({ ...base, control: { x: 'a', y: 1 } })).toThrow()
  })
  it('parseDrawingPatch: só cor, largura, padrão, fill e radius; nada de pontos ou id', () => {
    expect(parseDrawingPatch({ color: '#007AFF', width: 5, pattern: 'dashed', fill: 'solid', radius: 8 })).toEqual({ color: '#007AFF', width: 5, pattern: 'dashed', fill: 'solid', radius: 8 })
    expect(parseDrawingPatch({ fill: 'tint' })).toEqual({ fill: 'tint' })
    expect(() => parseDrawingPatch({ points: [] })).toThrow(); expect(() => parseDrawingPatch({})).toThrow(); expect(() => parseDrawingPatch({ fill: 'zzz' })).toThrow()
  })
  it('parseDrawingPatch aceita o ponto de controle da seta e null para voltar à reta', () => {
    expect(parseDrawingPatch({ control: { x: 1, y: 2 } })).toEqual({ control: { x: 1, y: 2 } }); expect(parseDrawingPatch({ control: null })).toEqual({ control: null }); expect(() => parseDrawingPatch({ control: 5 })).toThrow()
  })
  it('patch com pontos e rotação (redimensionar e girar); rotation 0 apaga o campo', () => {
    expect(parseDrawingPatch({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], rotation: 0.5 })).toEqual({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], rotation: 0.5 })
    expect(() => parseDrawingPatch({ points: [] })).toThrow(); expect(() => parseDrawingPatch({ points: [{ x: 'a', y: 1 }] })).toThrow(); expect(() => parseDrawingPatch({ rotation: 5000 })).toThrow()
    expect(parseDrawing({ ...base, rotation: 1 })).toMatchObject({ rotation: 1 }); expect(() => parseDrawing({ ...base, rotation: 'x' })).toThrow()
  })
  it('arquivo com fill/radius/control inválidos mantém o traço e descarta só o campo', () => {
    const ws = validateWorkspace({ id: 'w', name: 'W', version: 1, nodes: {}, connections: [], floors: {}, activeFloor: null, camera: { x: 0, y: 0, zoom: 1 }, drawings: [{ id: 'd', floorId: null, points: [{ x: 0, y: 0 }], color: '#000', width: 2, fill: 'xx', radius: 'a', control: 3 }] } as never) as unknown as { drawings: Array<Record<string, unknown>> } 
    expect(ws?.drawings[0]).toMatchObject({ id: 'd' }); expect(ws?.drawings[0]).not.toHaveProperty('fill'); expect(ws?.drawings[0]).not.toHaveProperty('radius'); expect(ws?.drawings[0]).not.toHaveProperty('control')
  })
})
