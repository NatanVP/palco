import { describe, expect, it } from 'vitest'
import { bandFrame } from '../../src/renderer/src/canvas/band-frame'

const m = (x: number, y: number, w: number, h: number) => ({ pos: { x, y }, size: { w, h } })

describe('bandFrame', () => {
  it('sem membros é null', () => {
    expect(bandFrame([])).toBeNull()
  })

  it('um membro: o retângulo dele com a folga em volta', () => {
    expect(bandFrame([m(100, 200, 300, 150)])).toEqual({ pos: { x: 60, y: 160 }, size: { w: 380, h: 230 } })
  })

  it('dois membros: o bbox deles + 40 de cada lado', () => {
    // a: x 0..100, y 0..50; b: x 300..500, y 200..300 -> bbox x 0..500, y 0..300
    expect(bandFrame([m(0, 0, 100, 50), m(300, 200, 200, 100)])).toEqual({ pos: { x: -40, y: -40 }, size: { w: 580, h: 380 } })
  })

  it('aceita folga própria e membros em coordenadas negativas', () => {
    expect(bandFrame([m(-100, -50, 100, 100)], 10)).toEqual({ pos: { x: -110, y: -60 }, size: { w: 120, h: 120 } })
  })
})
