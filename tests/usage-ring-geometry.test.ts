import { describe, expect, it } from 'vitest'
import * as ring from '../src/renderer/src/usage/ring'
import { segmentsLit } from '../src/renderer/src/usage/segments'

describe('geometria do anel de uso', () => {
  it('medidas: painel 72/8/2 e pílula 20/2.4/0.9', () => {
    expect(ring.RING_PANEL).toEqual({ size: 72, lineWidth: 8, spacing: 2 })
    expect(ring.RING_PILL).toEqual({ size: 20, lineWidth: 2.4, spacing: 0.9 })
  })
  it('anéis concêntricos: cada um perde 2*(espessura+espaço) e só existe enquanto > 1,5 espessura', () => {
    expect(ring.ringLayout?.(72, 8, 2, 2)).toEqual([{ size: 72, inset: 0 }, { size: 52, inset: 10 }])
    expect(ring.ringLayout?.(20, 2.4, 0.9, 2)?.map((r) => r.size)).toEqual([20, 13.4])
    expect(ring.ringLayout?.(10, 4, 2, 2)?.map((r) => r.size)).toEqual([10]) // o segundo (-2) não cabe
  })
  it('sem a bolinha: a ponta é só a metade direita do disco (cap arredondado) e o começo, a metade esquerda', () => {
    const c = ring.ringCaps?.(0.5, 8)
    expect(c?.endClip).toBe('inset(0 0 0 calc(50% - 1px))')
    expect(c?.startClip).toBe('inset(0 50% 0 0)')
    expect(c?.startVisible).toBe(true)
    expect(c?.endRotation).toBe(180)
  })
  it('sem uso não há cap; com 100% ou mais o começo some e a ponta ganha sombra', () => {
    expect(ring.ringCaps?.(0, 8)).toMatchObject({ startVisible: false, endVisible: false })
    const full = ring.ringCaps?.(1, 8)
    expect(full).toMatchObject({ startVisible: false, endVisible: true, endRotation: 0 })
    expect(full?.endShadow).toBe('1.6px 0 2px rgb(0 0 0 / 0.3)')
    expect(ring.ringCaps?.(0.5, 8)?.endShadow).toBe('none')
    expect(ring.ringCaps?.(1.25, 8)?.endRotation).toBe(90)
  })
})

describe('barra de segmentos', () => {
  it('36 pílulas; com uso acende ao menos uma', () => {
    expect(segmentsLit(0.34, 36)).toBe(12)
    expect(segmentsLit(0.001, 36)).toBe(1)
    expect(segmentsLit(2, 36)).toBe(36)
  })
})
