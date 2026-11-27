import { createRope, stepRope, ropePath } from '../../src/renderer/src/canvas/rope'
const a = { x: 0, y: 0 }, b = { x: 400, y: 0 }
it('settles below the endpoints within five percent of rest length and stops spending energy', () => {
  const rope = createRope(a, b)
  let energy = 0
  for (let i = 0; i < 1800; i++) energy = stepRope(rope, a, b, 1 / 60)
  expect(rope.points).toHaveLength(21)
  expect(rope.points[12]!.y).toBeGreaterThan(10)
  const length = rope.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - rope.points[i]!.x, p.y - rope.points[i]!.y), 0)
  expect(length).toBeGreaterThan(420 * .95)
  expect(length).toBeLessThan(420 * 1.05)
  expect(energy).toBeLessThan(.05)
  expect(ropePath(rope)).toMatch(/^M .* C /)
})
it('survives rapid endpoint teleports and large elapsed frames, then settles', () => {
  const rope = createRope(a, b)
  let end = b
  for (let i = 0; i < 80; i++) {
    end = { x: (i % 2 ? -1 : 1) * 2000 * (i + 1), y: i * 2000 }
    expect(Number.isFinite(stepRope(rope, a, end, i % 3 ? 1 / 60 : 10))).toBe(true)
    expect(rope.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  }
  let energy = 0
  for (let i = 0; i < 2400; i++) energy = stepRope(rope, a, b, 1 / 60)
  expect(energy).toBeLessThan(.05)
})
it('handles coincident endpoints without NaN', () => {
  const rope = createRope(a, a)
  for (let i = 0; i < 120; i++) stepRope(rope, a, a, 1 / 60)
  expect(ropePath(rope)).not.toMatch(/NaN|Infinity/)
})
