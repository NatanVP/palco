import { describe, expect, it } from 'vitest'
import { screenToWorld, snap, worldToScreen, zoomAt } from '../../src/renderer/src/canvas/camera'

const cam = { offset: { x: 100, y: -50 }, zoom: 1.5 }

describe('camera', () => {
  it('screenToWorld e worldToScreen são inversas', () => {
    const p = { x: 321, y: 87 }
    const back = worldToScreen(screenToWorld(p, cam), cam)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
    const w = { x: -40, y: 12 }
    const again = screenToWorld(worldToScreen(w, cam), cam)
    expect(again.x).toBeCloseTo(w.x)
    expect(again.y).toBeCloseTo(w.y)
  })

  it('zoomAt mantém o ponto sob o cursor fixo', () => {
    const p = { x: 400, y: 300 }
    const before = screenToWorld(p, cam)
    const next = zoomAt(cam, p, 1.2)
    const after = screenToWorld(p, next)
    expect(next.zoom).toBeCloseTo(1.8)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('zoomAt respeita os limites 0.25 e 2', () => {
    const p = { x: 10, y: 10 }
    expect(zoomAt(cam, p, 100).zoom).toBe(2)
    expect(zoomAt(cam, p, 0.0001).zoom).toBe(0.25)
    const capped = zoomAt({ offset: { x: 0, y: 0 }, zoom: 2 }, p, 2)
    expect(capped.offset).toEqual({ x: 0, y: 0 })
  })

  it('snap arredonda para a grade de 20', () => {
    expect(snap(29)).toBe(20)
    expect(snap(31)).toBe(40)
    expect(snap(-9) + 0).toBe(0)
    expect(snap(33, 10)).toBe(30)
  })
})
