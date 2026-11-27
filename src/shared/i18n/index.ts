import { LANGUAGES } from '../preferences'

/** Idiomas suportados. pt-BR é a fonte; `en` é a língua de reserva. */
export const LOCALES = LANGUAGES
export type Locale = (typeof LOCALES)[number]
export const SOURCE_LOCALE: Locale = 'pt-BR'
export const FALLBACK_LOCALE: Locale = 'en'
/** A interface oferece pt-BR e en; os demais códigos de idioma usam en como fallback. */
export const AVAILABLE_LOCALES: readonly Locale[] = ['pt-BR', 'en']
export const availableLocale = (l: Locale): Locale => (AVAILABLE_LOCALES.includes(l) ? l : FALLBACK_LOCALE)
/** Cada idioma escrito na própria língua (o select das Configurações). */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', 'pt-BR': 'Português (Brasil)', es: 'Español', fr: 'Français', de: 'Deutsch', ja: '日本語', 'zh-Hans': '简体中文' }

export type Params = Record<string, string | number>
/** Um catálogo é plano: chave com pontos → texto. Plural: `chave_one`, `chave_other` (categorias do Intl.PluralRules). */
export type Catalog = Readonly<Record<string, string>>

const SCRIPT_DEFAULT: Record<string, Locale> = { pt: 'pt-BR', zh: 'zh-Hans' }
/** O idioma do sistema ("pt-BR", "pt-PT", "zh-CN", "en-US"…) → um dos sete: igual, ou pelo primeiro segmento; senão inglês. */
export function detectLocale(tag: string | null | undefined): Locale {
  if (!tag) return FALLBACK_LOCALE
  const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase())
  if (exact) return exact
  const base = tag.split(/[-_]/)[0]!.toLowerCase()
  return SCRIPT_DEFAULT[base] ?? LOCALES.find((l) => l.split('-')[0]!.toLowerCase() === base) ?? FALLBACK_LOCALE
}
/** A preferência (null = padrão do sistema) e o idioma do sistema dão o idioma em uso. */
export const resolveLocale = (pref: Locale | null | undefined, system: string | null | undefined): Locale => (pref && (LOCALES as readonly string[]).includes(pref) ? pref : detectLocale(system))

const PARAM = /\{(\w+)\}/g
/** Troca `{nome}` pelo valor; parâmetro que falta fica como está (aparece no texto, para o erro não passar batido). */
export function interpolate(template: string, params?: Params): string {
  return params ? template.replace(PARAM, (m, name: string) => (name in params ? String(params[name]) : m)) : template
}
/** Os nomes de parâmetro de um texto (para conferir que todas as línguas usam os mesmos). */
export const paramsOf = (template: string): string[] => [...new Set([...template.matchAll(PARAM)].map((m) => m[1]!))].sort()

const rules = new Map<Locale, Intl.PluralRules>()
const pluralRules = (l: Locale): Intl.PluralRules => { let r = rules.get(l); if (!r) { r = new Intl.PluralRules(l); rules.set(l, r) } return r }

/** Procura o texto: no idioma, depois no inglês e na fonte; com `count`, tenta a forma do plural do idioma e cai em `_other`. */
export function lookup(catalogs: Partial<Record<Locale, Catalog>>, locale: Locale, key: string, count?: number): string | undefined {
  for (const l of [locale, FALLBACK_LOCALE, SOURCE_LOCALE]) {
    const c = catalogs[l]
    if (!c) continue
    if (count !== undefined) {
      const hit = c[`${key}_${pluralRules(l).select(count)}`] ?? c[`${key}_other`]
      if (hit !== undefined) return hit
    }
    if (c[key] !== undefined) return c[key]
  }
  return undefined
}

export type Translate<K extends string = string> = (key: K, params?: Params) => string
/** O tradutor de um conjunto de catálogos: `count` em `params` escolhe o plural; chave desconhecida volta a própria chave. */
export function createTranslator<K extends string>(catalogs: Partial<Record<Locale, Catalog>>, locale: () => Locale): Translate<K> {
  return (key, params) => {
    const l = locale()
    const text = lookup(catalogs, l, key, typeof params?.count === 'number' ? params.count : undefined)
    return text === undefined ? key : interpolate(text, params)
  }
}

/** Formatadores de data, número, lista e tamanho com o idioma da interface (sempre pelo `Intl`). */
export function formatters(locale: Locale) {
  const bytes = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']
  return {
    dateTime: (ms: number | Date): string => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms),
    date: (ms: number | Date): string => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(ms),
    time: (ms: number | Date): string => new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(ms),
    number: (n: number): string => new Intl.NumberFormat(locale).format(n),
    list: (items: readonly string[]): string => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items),
    /** "há 5 minutos" / "ontem": a diferença em segundos até agora (negativa = passado). */
    relative: (deltaSeconds: number): string => {
      const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), s = Math.abs(deltaSeconds)
      const steps: Array<[number, number, Intl.RelativeTimeFormatUnit]> = [[60, 1, 'second'], [3600, 60, 'minute'], [86400, 3600, 'hour'], [2592000, 86400, 'day'], [31536000, 2592000, 'month']]
      for (const [limit, div, unit] of steps) if (s < limit) return f.format(Math.round(deltaSeconds / div), unit)
      return f.format(Math.round(deltaSeconds / 31536000), 'year')
    },
    bytes: (n: number): string => {
      let v = n, i = 0
      while (v >= 1000 && i < bytes.length - 1) { v /= 1000; i++ }
      return new Intl.NumberFormat(locale, { style: 'unit', unit: bytes[i]!, unitDisplay: 'short', maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)
    }
  }
}
