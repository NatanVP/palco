/** Aparência de um preset ou de um terminal: tudo opcional; ausente = herda o global das Configurações. */
export interface Appearance {
  icon?: string; color?: string
  /** Tema do terminal (id de `terminal-themes`, `system`, `dark`, `light`) e, com par claro/escuro, o tema escuro. */
  themeId?: string; darkThemeId?: string
  fontFamily?: string; fontSize?: number
  chatFontFamily?: string; chatFontSize?: number
}
export const APPEARANCE_KEYS = ['icon', 'color', 'themeId', 'darkThemeId', 'fontFamily', 'fontSize', 'chatFontFamily', 'chatFontSize'] as const
const FONT_BAD = /[;{}<>\n]/
const THEME = /^[a-z0-9-]{1,64}$/
const check: Record<(typeof APPEARANCE_KEYS)[number], (v: unknown) => boolean> = {
  icon: v => typeof v === 'string' && v.trim() !== '' && (/^[a-z0-9-]{1,48}$/.test(v) || [...v].length <= 8),
  color: v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v),
  themeId: v => typeof v === 'string' && THEME.test(v), darkThemeId: v => typeof v === 'string' && THEME.test(v),
  fontFamily: v => typeof v === 'string' && v.trim() !== '' && v.length <= 200 && !FONT_BAD.test(v),
  fontSize: v => typeof v === 'number' && Number.isInteger(v) && v >= 8 && v <= 40,
  chatFontFamily: v => typeof v === 'string' && v.trim() !== '' && v.length <= 200 && !FONT_BAD.test(v),
  chatFontSize: v => typeof v === 'number' && Number.isInteger(v) && v >= 8 && v <= 32
}
/** Valida e devolve só os campos conhecidos; qualquer valor ruim derruba tudo (nada pela metade). */
export function validateAppearance(raw: unknown): Appearance {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('aparência inválida')
  const o = raw as Record<string, unknown>, out: Record<string, unknown> = {}
  for (const k of Object.keys(o)) {
    if (!(APPEARANCE_KEYS as readonly string[]).includes(k)) throw new Error(`campo de aparência desconhecido: ${k}`)
    if (o[k] === undefined) continue
    if (!check[k as keyof typeof check](o[k])) throw new Error(`${k} inválido`)
    out[k] = o[k]
  }
  if (out.darkThemeId !== undefined && out.themeId === undefined) throw new Error('o par claro/escuro precisa do tema claro (themeId)')
  return out as Appearance
}
export const isValidAppearanceField = (k: (typeof APPEARANCE_KEYS)[number], v: unknown): boolean => check[k](v)
