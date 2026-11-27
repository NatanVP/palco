import { describe, expect, it } from 'vitest'
import { distanceToPolyline, ropesAt, ROPE_THRESHOLDS, ROPE_WIDEN, ROPE_MAX } from '../src/renderer/src/canvas/rope-menu'

const line = (id: string, y: number, x0 = 0, x1 = 400) => ({ id, points: [{ x: x0, y }, { x: x1, y }] })
describe('distância até a corda', () => {
  it('ao segmento (perpendicular e pontas) e à polilinha inteira', () => {
    expect(distanceToPolyline({ x: 50, y: 10 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe(10); expect(distanceToPolyline({ x: 110, y: 0 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe(10)
    expect(distanceToPolyline({ x: 100, y: 50 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])).toBe(0); expect(distanceToPolyline({ x: 5, y: 5 }, [{ x: 0, y: 0 }])).toBeCloseTo(Math.hypot(5, 5)); expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity)
  })
})
describe('quais cordas o clique pega (3/8/14 px divididos pelo zoom)', () => {
  it('as constantes são as do palco', () => { expect([...ROPE_THRESHOLDS]).toEqual([3, 8, 14]); expect(ROPE_WIDEN).toBe(6); expect(ROPE_MAX).toBe(14) })
  it('clique em cima de uma corda pega só ela', () => { expect(ropesAt([line('a', 0), line('b', 50)], { x: 100, y: 1 }, 1)).toEqual(['a']) })
  it('duas cordas a ~9 px viram duas linhas (o limiar mínimo de 3 alarga em +6)', () => {
    expect(ropesAt([line('a', 0), line('b', 9)], { x: 100, y: 0 }, 1).sort()).toEqual(['a', 'b'])
    expect(ropesAt([line('a', 0), line('b', 10)], { x: 100, y: 0 }, 1)).toEqual(['a'])
  })
  it('clique a 7 px usa o limiar de 8 e alarga até o teto de 14', () => {
    expect(ropesAt([line('a', 0), line('b', 20)], { x: 100, y: 7 }, 1).sort()).toEqual(['a', 'b'])
    expect(ropesAt([line('a', 0), line('b', 22)], { x: 100, y: 7 }, 1)).toEqual(['a'])
  })
  it('fora de qualquer limiar (mais de 14 px) não pega nada', () => { expect(ropesAt([line('a', 0)], { x: 100, y: 15 }, 1)).toEqual([]) })
  it('os limiares são em pixels de TELA: dividem pelo zoom do mundo', () => {
    expect(ropesAt([line('a', 0)], { x: 100, y: 10 }, 0.5)).toEqual(['a'])
    expect(ropesAt([line('a', 0)], { x: 100, y: 10 }, 2)).toEqual([])
    expect(ropesAt([line('a', 0), line('b', 9)], { x: 100, y: 0 }, 2)).toEqual(['a'])
  })
  it('a corda de cima (a última desenhada) vem primeiro', () => { expect(ropesAt([line('a', 0), line('b', 0), line('c', 0)], { x: 5, y: 0 }, 1)).toEqual(['c', 'b', 'a']) })
})
