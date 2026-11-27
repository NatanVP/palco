import { availableLocale, createTranslator, formatters, resolveLocale, type Catalog, type Locale, type Params } from './index'
import { ptBR } from './catalogs/pt-BR'
import { en } from './catalogs/en'
import { es } from './catalogs/es'
import { fr } from './catalogs/fr'
import { de } from './catalogs/de'
import { ja } from './catalogs/ja'
import { zhHans } from './catalogs/zh-Hans'

type Strip<K> = K extends `${infer B}_one` ? B : K extends `${infer B}_other` ? B : K
/** As chaves do catálogo-fonte (as formas de plural contam como uma só): `t()` só aceita chave que existe. */
export type MessageKey = Strip<keyof typeof ptBR>

export const CATALOGS: Record<Locale, Catalog> = { 'pt-BR': ptBR, en, es, fr, de, ja, 'zh-Hans': zhHans }

let current: Locale = 'pt-BR'
const listeners = new Set<() => void>()
export const getLocale = (): Locale => current
/** Troca o idioma em uso e avisa quem escuta (a interface atualiza na hora). */
export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  for (const l of [...listeners]) l()
}
/** O idioma em uso a partir da preferência (null = sistema) e do idioma do sistema. */
export const applyLanguage = (pref: Locale | null, system: string | null | undefined): Locale => { const l = availableLocale(resolveLocale(pref, system)); setLocale(l); return l }
export function subscribeLocale(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb) } }

const translate = createTranslator<MessageKey>(CATALOGS, getLocale)
/** O texto da chave no idioma em uso; `{nome}` interpola e `count` escolhe o plural. */
export const t = (key: MessageKey, params?: Params): string => translate(key, params)
let reverse: Map<string, string> | null = null
/**
 * Texto de interface que é também identidade no código (nome de seção, opção de um select, rótulo de ação): `tr('Sistema')` procura o
 * texto no catálogo-fonte (pt-BR) e devolve o do idioma em uso; texto que não está no catálogo volta como veio.
 */
export function tr(source: string): string {
  if (!reverse) { reverse = new Map(); for (const [k, v] of Object.entries(ptBR)) if (!reverse.has(v)) reverse.set(v, k) }
  const key = reverse.get(source)
  return key ? t(key as MessageKey) : source
}
/** Data, número, lista, relativo e tamanho no idioma em uso. */
export const fmt = () => formatters(current)
