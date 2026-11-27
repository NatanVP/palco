import { NOTE_COLOR_HEX } from '../../../shared/new-item'

/** Nota no tema claro: o cartão inteiro leva o pastel da cor e o texto fica na cor escura da mesma família. */
const PAPER: Record<keyof typeof NOTE_COLOR_HEX, [fill: string, ink: string]> = {
  yellow: ['#fff9c4', '#5d4037'], pink: ['#f8bbd0', '#880e4f'], blue: ['#bbdefb', '#0d47a1'], green: ['#c8e6c9', '#1b5e20'], orange: ['#ffe0b2', '#e65100'],
  purple: ['#e1bee7', '#4a148c'], white: ['#ffffff', '#333333'], charcoal: ['#2d2d2d', '#ffffff'], slate: ['#37474f', '#ffffff'], midnight: ['#1a237e', '#ffffff']
}
const dark = (hex: string): boolean => {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!n) return false
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n[1]!.slice(i, i + 2), 16))
  return (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255 < 0.5
}
/** `color` é o hex guardado no nó: um da paleta, um personalizado (vira o próprio fundo) ou ausente (amarela). */
export function noteLight(color?: string): { fill: string; ink: string; shade: string } {
  const name = (Object.keys(NOTE_COLOR_HEX) as Array<keyof typeof NOTE_COLOR_HEX>).find((k) => NOTE_COLOR_HEX[k] === (color ?? NOTE_COLOR_HEX.yellow).toLowerCase())
  const [fill, ink] = name ? PAPER[name] : [color!, dark(color!) ? '#ffffff' : '#333333']
  // Sombra do cabeçalho sobre o papel.
  return { fill, ink, shade: dark(fill) ? '#ffffff1a' : '#0000000f' }
}
/** Variáveis do cartão que o CSS do tema claro lê. */
export function paperVars(color?: string): Record<string, string> {
  const { fill, ink, shade } = noteLight(color)
  return { '--note-fill': fill, '--note-ink': ink, '--note-shade': shade }
}
