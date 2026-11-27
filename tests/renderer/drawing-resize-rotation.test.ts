import { describe, expect, it } from 'vitest'
import type { Drawing, Vec } from '../../src/shared/model'
import { groupBox, groupResizePatches, groupRotatePatches, HANDLES, isTransformable, MIN_SIZE, pointsBox, resizeBox, resizePatch, rotatePatch, rotateVec, snapAngle } from '../../src/renderer/src/canvas/draw/transform'
import { drawingGeometry } from '../../src/renderer/src/canvas/draw/geometry'

const pt = (x: number, y: number): Vec => ({ x, y })
const rect = (id: string, x: number, y: number, w: number, h: number, extra: Partial<Drawing> = {}): Drawing => ({ id, floorId: null, tool: 'rect', color: '#000', width: 3, points: [pt(x, y), pt(x + w, y + h)], ...extra })
const box = { x: 100, y: 100, w: 200, h: 100 }
const near = (v: Vec, x: number, y: number) => { expect(v.x).toBeCloseTo(x); expect(v.y).toBeCloseTo(y) }

describe('alças do desenho: caixa e redimensionamento', () => {
  it('são as oito alças do palco', () => { expect([...HANDLES]).toEqual(['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br']) })
  it('só linha e seta ficam de fora (têm alças de ponta)', () => { expect(isTransformable(rect('a', 0, 0, 1, 1))).toBe(true); expect(isTransformable(rect('a', 0, 0, 1, 1, { tool: 'pen' }))).toBe(true); expect(isTransformable(rect('a', 0, 0, 1, 1, { tool: 'line' }))).toBe(false); expect(isTransformable(rect('a', 0, 0, 1, 1, { tool: 'arrow' }))).toBe(false) })
  it('caixa dos pontos', () => { expect(pointsBox([pt(10, 40), pt(30, 5), pt(20, 60)])).toEqual({ x: 10, y: 5, w: 20, h: 55 }) })
  it('arrastar a alça move só o lado dela (canto: dois lados)', () => {
    expect(resizeBox('mr', box, 0, pt(50, 30), false)).toEqual({ x: 100, y: 100, w: 250, h: 100 })
    expect(resizeBox('tl', box, 0, pt(20, 10), false)).toEqual({ x: 120, y: 110, w: 180, h: 90 })
    expect(resizeBox('bc', box, 0, pt(99, -40), false)).toEqual({ x: 100, y: 100, w: 200, h: 60 })
  })
  it('Shift num canto mantém a proporção (pela maior variação)', () => {
    const r = resizeBox('br', box, 0, pt(100, 10), true); expect(r.w / r.h).toBeCloseTo(2); expect(r.w).toBe(300)
    const l = resizeBox('tl', box, 0, pt(-40, 0), true); expect(l.w / l.h).toBeCloseTo(2); expect(l.x + l.w).toBe(300); expect(l.y + l.h).toBe(200)
  })
  it('mínimo de 10 de lado, mantendo o lado oposto parado', () => {
    const r = resizeBox('tl', box, 0, pt(500, 500), false); expect(r.w).toBe(MIN_SIZE); expect(r.h).toBe(MIN_SIZE); expect(r.x + r.w).toBe(300); expect(r.y + r.h).toBe(200)
  })
  it('com o desenho girado, o arrasto da tela é girado de volta para o referencial dele', () => {
    const r = resizeBox('mr', box, Math.PI / 2, pt(0, 40), false)
    expect(r.w).toBeCloseTo(240); expect(r.h).toBe(100)
  })
  it('resizePatch reescala os pontos da forma e o texto acompanha a escala', () => {
    const d = rect('a', 100, 100, 200, 100, { text: 'Oi', textSize: 20 })
    const p = resizePatch(d, 'br', pt(200, 100), false)
    expect(p.points).toEqual([pt(100, 100), pt(500, 300)]); expect(p.textSize).toBe(40)
    expect(resizePatch(d, 'mr', pt(100, 0), false).textSize).toBe(20)
    expect(resizePatch(d, 'ml', pt(100, 0), false).textSize).toBe(10)
    expect(resizePatch(rect('b', 100, 100, 200, 100), 'br', pt(10, 10), false)).not.toHaveProperty('textSize')
    expect(resizePatch(rect('c', 0, 0, 200, 100, { text: 'x', textSize: 190 }), 'br', pt(400, 200), false).textSize).toBe(200)
  })
  it('traço livre: todos os pontos escalam em relação à caixa', () => {
    const d = rect('p', 0, 0, 0, 0, { tool: 'pen', points: [pt(0, 0), pt(50, 100), pt(100, 0)] })
    expect(resizePatch(d, 'br', pt(100, 100), false).points).toEqual([pt(0, 0), pt(100, 200), pt(200, 0)])
  })
})
describe('alça de rotação', () => {
  it('passo de 15° com Shift', () => { expect(snapAngle(0.3)).toBeCloseTo(Math.PI / 12); expect(snapAngle(0.05)).toBe(0); expect(snapAngle(Math.PI / 2 + 0.01)).toBeCloseTo(Math.PI / 2) })
  it('rotatePatch guarda o ângulo e não mexe nos pontos', () => { expect(rotatePatch(rect('a', 0, 0, 10, 10), 1.2)).toEqual({ rotation: 1.2 }) })
  it('rotateVec gira em torno de um centro', () => { near(rotateVec(pt(10, 0), pt(0, 0), Math.PI / 2), 0, 10); near(rotateVec(pt(5, 5), pt(5, 5), 2), 5, 5) })
  it('a forma girada desenha com rotate() em torno do centro da caixa', () => {
    const g = drawingGeometry({ ...rect('a', 0, 0, 100, 50), rotation: Math.PI / 4 } as never)
    expect(g.rotate).toEqual({ deg: 45, cx: 50, cy: 25 }); expect(drawingGeometry(rect('b', 0, 0, 100, 50) as never).rotate).toBeUndefined()
  })
})
describe('várias seleções: caixa do grupo', () => {
  const ds = [rect('a', 0, 0, 100, 100, { text: 't', textSize: 20 }), rect('b', 200, 0, 100, 100), rect('l', 0, 300, 0, 0, { tool: 'line', points: [pt(0, 300), pt(300, 300)] })]
  it('união das caixas', () => { expect(groupBox(ds)).toEqual({ x: 0, y: 0, w: 300, h: 300 }) })
  it('escala o grupo: pontos, ponto de controle e o texto pelo fator menor', () => {
    const withCtl = [...ds.slice(0, 2), { ...ds[2]!, tool: 'arrow' as const, control: pt(150, 400) }]
    const m = groupResizePatches(withCtl, 'br', pt(300, 300), false)
    expect(m.get('a')).toEqual({ points: [pt(0, 0), pt(200, 200)], textSize: 40 }); expect(m.get('b')!.points).toEqual([pt(400, 0), pt(600, 200)])
    expect(m.get('l')).toEqual({ points: [pt(0, 600), pt(600, 600)], control: pt(300, 800) })
  })
  it('gira o grupo: a forma anda para o lugar girado e soma o ângulo; a linha gira nas pontas', () => {
    const m = groupRotatePatches(ds, pt(150, 150), Math.PI / 2)
    const a = m.get('a')!; expect(a.rotation).toBeCloseTo(Math.PI / 2); near(a.points![0]!, 200, 0); near(a.points![1]!, 300, 100)
    const l = m.get('l')!; near(l.points![0]!, 0, 0); near(l.points![1]!, 0, 300); expect(l).not.toHaveProperty('rotation')
  })
})
