/** Cores com nome aceitas pelo CLI (`--color blue`); `#RRGGBB` também vale. Mesma paleta das bolinhas da interface. */
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  blue: '#007AFF', azul: '#007AFF',
  red: '#FF3B30', vermelho: '#FF3B30',
  green: '#34C759', verde: '#34C759',
  orange: '#FF9500', laranja: '#FF9500',
  purple: '#AF52DE', roxo: '#AF52DE',
  pink: '#FF2D55', rosa: '#FF2D55',
  cyan: '#5AC8FA', ciano: '#5AC8FA',
  yellow: '#FFCC00', amarelo: '#FFCC00'
}

/** `blue` ou `#RRGGBB` → `#RRGGBB`; `none` → null; inválida → lança com a lista. */
export function resolveColor(text: string): string | null {
  const t = text.trim().toLowerCase()
  if (t === 'none') return null
  if (/^#[0-9a-f]{6}$/.test(t)) return t.toUpperCase()
  const hex = NAMED_COLORS[t]
  if (hex === undefined) throw new Error(`cor inválida: ${text} (use ${Object.keys(NAMED_COLORS).filter((_, i) => i % 2 === 0).join(', ')}, #RRGGBB ou none)`)
  return hex
}
