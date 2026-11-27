import { describe, expect, it } from 'vitest'
import { minimapToWorld, minimapTransform, worldToMinimap } from '../../src/renderer/src/canvas/minimap'

const box = { w: 200, h: 140 }
const viewport = { pos: { x: 0, y: 0 }, size: { w: 1000, h: 700 } }

describe('minimapTransform', () => {
  it('cabe todos os nós e a viewport dentro da caixa, com margem', () => {
    const nodes = [
      { pos: { x: -2000, y: -500 }, size: { w: 400, h: 300 } },
      { pos: { x: 3000, y: 1200 }, size: { w: 640, h: 400 } }
    ]
    const t = minimapTransform(nodes, viewport, box)
    for (const r of [...nodes, viewport]) {
      const a = worldToMinimap(r.pos, t)
      const b = worldToMinimap({ x: r.pos.x + r.size.w, y: r.pos.y + r.size.h }, t)
      expect(a.x).toBeGreaterThanOrEqual(4)
      expect(a.y).toBeGreaterThanOrEqual(4)
      expect(b.x).toBeLessThanOrEqual(box.w - 4)
      expect(b.y).toBeLessThanOrEqual(box.h - 4)
    }
    expect(t.scale).toBeGreaterThan(0)
  })

  it('centraliza o conteúdo na caixa', () => {
    const t = minimapTransform([], { pos: { x: 100, y: 100 }, size: { w: 100, h: 100 } }, box)
    const c = worldToMinimap({ x: 150, y: 150 }, t)
    expect(c.x).toBeCloseTo(box.w / 2)
    expect(c.y).toBeCloseTo(box.h / 2)
  })

  it('ida e volta de coordenada', () => {
    const t = minimapTransform([{ pos: { x: -300, y: 40 }, size: { w: 500, h: 500 } }], viewport, box)
    const p = { x: 123.5, y: -77 }
    const back = minimapToWorld(worldToMinimap(p, t), t)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('viewport degenerada não gera NaN nem infinito', () => {
    const t = minimapTransform([], { pos: { x: 0, y: 0 }, size: { w: 0, h: 0 } }, box)
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(Number.isFinite(t.offset.x) && Number.isFinite(t.offset.y)).toBe(true)
  })
})

import { zoomStep } from '../../src/renderer/src/canvas/camera'

describe('zoomStep', () => {
  it('passos de 10%, alinhados, entre 25% e 200%', () => {
    expect(zoomStep(1, 1)).toBeCloseTo(1.1)
    expect(zoomStep(1, -1)).toBeCloseTo(0.9)
    expect(zoomStep(0.87, 1)).toBeCloseTo(0.9)
    expect(zoomStep(0.87, -1)).toBeCloseTo(0.8)
    expect(zoomStep(0.3, -1)).toBeCloseTo(0.25)
    expect(zoomStep(0.25, -1)).toBeCloseTo(0.25)
    expect(zoomStep(1.95, 1)).toBeCloseTo(2)
    expect(zoomStep(2, 1)).toBeCloseTo(2)
  })
})
