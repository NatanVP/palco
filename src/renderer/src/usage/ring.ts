import type { Vec } from '../../../shared/model'

/** Ângulo do uso em graus; acima de 100% volta ao início (a volta extra aparece pela sombra da ponta). */
function sweepDeg(fraction: number): number {
  const f = Math.max(0, fraction)
  const deg = (f > 1 ? f % 1 : f) * 360
  return f > 1 && deg === 0 ? 360 : Math.round(deg * 100) / 100
}

/** Preenchimento do anel: do topo, a cor a 70% esmaecendo até a cor cheia no ângulo do uso; depois transparente. */
export function ringGradient(fraction: number, color: string): string {
  const deg = sweepDeg(fraction)
  return `conic-gradient(from 0deg, color-mix(in srgb, ${color} 70%, transparent) 0deg, ${color} ${deg}deg, transparent ${deg}deg)`
}

/** Centro da ponta arredondada do anel, a partir do centro do círculo (0 = topo, sentido horário). */
export function ringEndpoint(fraction: number, radius: number): Vec {
  const a = (sweepDeg(fraction) / 360) * 2 * Math.PI
  return { x: Math.sin(a) * radius, y: -Math.cos(a) * radius }
}

/** Medidas dos anéis de uso: painel (72), pílula da barra (20). */
export const RING_PANEL = { size: 72, lineWidth: 8, spacing: 2 } as const
export const RING_PILL = { size: 20, lineWidth: 2.4, spacing: 0.9 } as const

/** Anéis concêntricos: o de dentro perde `2*(espessura+espaço)` por nível e só existe enquanto passar de 1,5 espessura. */
export function ringLayout(size: number, lineWidth: number, spacing: number, count: number): Array<{ size: number; inset: number }> {
  const out: Array<{ size: number; inset: number }> = []
  for (let i = 0; i < count; i++) {
    const step = i * (lineWidth + spacing)
    const s = Math.round((size - 2 * step) * 100) / 100
    if (s <= lineWidth * 1.5) break
    out.push({ size: s, inset: step })
  }
  return out
}

/**
 * Pontas do arco formadas por meios discos. O começo é a metade esquerda de um disco (só enquanto
 * 0 < uso < 1) e a ponta é a metade direita (um cap arredondado) girada pelo ângulo; com 100% ou mais a ponta ganha sombra.
 */
export function ringCaps(fraction: number, lineWidth: number): {
  startVisible: boolean; startClip: string; endVisible: boolean; endClip: string; endRotation: number; endShadow: string
} {
  const f = Math.max(0, fraction)
  const shadow = `${Math.round(lineWidth * 0.2 * 100) / 100}px 0 ${Math.round(lineWidth * 0.25 * 100) / 100}px rgb(0 0 0 / 0.3)`
  return {
    startVisible: f > 0 && f < 1, startClip: 'inset(0 50% 0 0)',
    endVisible: f > 0, endClip: 'inset(0 0 0 calc(50% - 1px))',
    endRotation: Math.round((f % 1) * 360 * 100) / 100,
    endShadow: f >= 1 ? shadow : 'none'
  }
}
