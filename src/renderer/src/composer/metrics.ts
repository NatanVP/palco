export const COMPOSER_DEFAULT_FONT = 13
/** Medidas do compositor derivadas do tamanho da fonte: altura de linha, altura mínima (1 linha + 16) e máxima. */
export function composerMetrics(fontSize: number | null): { fontSize: number; lineHeight: number; minHeight: number; maxHeight: number } {
  const fs = fontSize ?? COMPOSER_DEFAULT_FONT, lineHeight = Math.round(fs * 20 / 13)
  return { fontSize: fs, lineHeight, minHeight: lineHeight + 16, maxHeight: Math.round(220 * lineHeight / 20) }
}
