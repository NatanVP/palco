import type { Size, Vec } from '../../../../shared/model'
interface Framed { id: string; pos: Vec; size: Size }

/**
 * Encaixe magnético ("Modificador de encaixe magnético"): com o modificador apertado, a moldura que está sendo arrastada cola a borda
 * (esquerda, direita, topo ou base) na borda mais próxima de um vizinho, quando a distância é menor que o limite. Cada eixo é independente.
 */
export function snapFrame(moving: Framed, others: readonly Framed[], threshold = 12): Framed {
  const best = (own: number[], theirs: number[]): number => {
    let delta = 0, distance = threshold + 1
    for (const a of own) for (const b of theirs) { const d = Math.abs(b - a); if (d < distance) { distance = d; delta = b - a } }
    return distance <= threshold ? delta : 0
  }
  const xs = others.flatMap(o => [o.pos.x, o.pos.x + o.size.w]), ys = others.flatMap(o => [o.pos.y, o.pos.y + o.size.h])
  const dx = best([moving.pos.x, moving.pos.x + moving.size.w], xs), dy = best([moving.pos.y, moving.pos.y + moving.size.h], ys)
  return { ...moving, pos: { x: moving.pos.x + dx, y: moving.pos.y + dy } }
}
