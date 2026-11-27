import { ringEndpoint, ringGradient } from '../../src/renderer/src/usage/ring'
import { segmentsLit } from '../../src/renderer/src/usage/segments'

describe('segmentsLit', () => {
  it('arredonda para 36 segmentos, com no mínimo 1 se houver uso, e satura em 100%', () => {
    expect(segmentsLit(0)).toBe(0)
    expect(segmentsLit(0.01)).toBe(1)
    expect(segmentsLit(0.5)).toBe(18)
    expect(segmentsLit(1.3)).toBe(36)
    expect(segmentsLit(-1)).toBe(0)
    expect(segmentsLit(0.25, 20)).toBe(5)
  })
})

describe('ringGradient', () => {
  it('conic-gradient do topo: cor a 70% até a cor cheia no ângulo do uso; resto transparente', () => {
    expect(ringGradient(0.25, '#D97757')).toBe(
      'conic-gradient(from 0deg, color-mix(in srgb, #D97757 70%, transparent) 0deg, #D97757 90deg, transparent 90deg)')
  })
  it('acima de 100% usa o ângulo modular (volta extra)', () => {
    expect(ringGradient(1.25, '#000')).toContain('#000 90deg')
  })
})

describe('ringEndpoint', () => {
  it('ponta do anel em coordenadas a partir do centro (0 = topo, sentido horário)', () => {
    const top = ringEndpoint(0, 10)
    expect(top.x).toBeCloseTo(0); expect(top.y).toBeCloseTo(-10)
    const right = ringEndpoint(0.25, 10)
    expect(right.x).toBeCloseTo(10); expect(right.y).toBeCloseTo(0)
  })
})
