import { interpolate, type Locale, type Params } from './index'
import { CATALOGS } from './runtime'

/**
 * Mensagens que o código escreve em pt-BR (erros de domínio e de validação) levadas para outro idioma. Cada uma é uma chave `main.*` do
 * catálogo, e o texto pt-BR dela é o molde que reconhece a mensagem pronta (`o floor '{p1}' já existe`).
 */
interface Pattern { key: string; regex: RegExp; names: string[]; weight: number }
let exact: Map<string, string> | null = null
let patterns: Pattern[] = []
const PARAM = /\{(\w+)\}/g
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function index(): Map<string, string> {
  if (exact) return exact
  exact = new Map()
  for (const [key, text] of Object.entries(CATALOGS['pt-BR'])) {
    if (!key.startsWith('main.')) continue
    const names = [...text.matchAll(PARAM)].map((m) => m[1]!)
    if (!names.length) { exact.set(text, key); continue }
    const parts = text.split(/\{\w+\}/)
    patterns.push({ key, names, regex: new RegExp(`^${parts.map(escape).join('([\\s\\S]*?)')}$`), weight: parts.join('').length })
  }
  // O molde com mais texto fixo ganha: "payload inválido: {p1}" antes de "{p1} inválido".
  patterns.sort((a, b) => b.weight - a.weight)
  return exact
}

const render = (key: string, locale: Locale, params?: Params): string => interpolate(CATALOGS[locale][key] ?? CATALOGS['pt-BR'][key]!, params)

/** Uma mensagem pronta em pt-BR no idioma pedido; os pedaços capturados também são traduzidos. Texto desconhecido volta como veio. */
export function localizeMessage(text: string, locale: Locale): string {
  if (locale === 'pt-BR' || !text) return text
  const direct = index().get(text)
  if (direct) return render(direct, locale)
  for (const p of patterns) {
    const m = p.regex.exec(text)
    if (m) return render(p.key, locale, Object.fromEntries(p.names.map((n, i) => [n, localizeMessage(m[i + 1]!, locale)])))
  }
  return text
}

/** A mensagem de um molde pt-BR no idioma pedido, com os parâmetros dados. */
export function renderMessage(template: string, locale: Locale, params?: Params): string {
  const key = index().get(template) ?? patterns.find((p) => CATALOGS['pt-BR'][p.key] === template)?.key
  return key ? render(key, locale, params) : interpolate(template, params)
}
