/** Segmentos acesos numa barra de `total`: arredonda, satura em 100% e acende ao menos 1 quando há uso. */
export function segmentsLit(fraction: number, total = 36): number {
  if (!(fraction > 0)) return 0
  return Math.max(1, Math.round(Math.min(fraction, 1) * total))
}
