import { availableLocale, resolveLocale, type Locale, type Params } from '../shared/i18n'
import { renderMessage, localizeMessage as translateMessage } from '../shared/i18n/messages'

/**
 * Idioma do que o main mostra ao usuário. Os módulos continuam escrevendo em pt-BR (é o que o CLI palco e os agentes leem); a tradução
 * acontece só na saída para a janela (IPC) e nos textos nativos, pelas chaves `main.*` do catálogo (`shared/i18n/messages`).
 */
let source: () => { preference: Locale | null; system: string } = () => ({ preference: null, system: 'pt-BR' })
export function setMainLocaleSource(next: typeof source): void { source = next }
export function mainLocale(): Locale { const s = source(); return availableLocale(resolveLocale(s.preference, s.system)) }

/** Uma mensagem pronta em pt-BR no idioma pedido (o da janela, por padrão). */
export const localizeMessage = (text: string, locale: Locale = mainLocale()): string => translateMessage(text, locale)

/** Texto nativo (menu, bandeja, diálogo, notificação), escrito em pt-BR com `{p1}`. */
export const mt = (text: string, params?: Params): string => renderMessage(text, mainLocale(), params)

/** Os campos de um retorno do IPC que carregam mensagem do main. O resto (nomes, notas, chat) é conteúdo do usuário e não muda. */
const MESSAGE_FIELDS = new Set(['reason', 'error', 'warning', 'problem', 'detail', 'source'])
export function localizeResult<T>(value: T, locale: Locale = mainLocale()): T {
  if (locale === 'pt-BR' || !value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => localizeResult(v, locale)) as T
  if (Object.getPrototypeOf(value) !== Object.prototype) return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'string' && MESSAGE_FIELDS.has(k) ? localizeMessage(v, locale) : localizeResult(v, locale)])) as T
}

/** O mesmo erro com a mensagem no idioma da janela (o nome da classe fica: o renderer o tira do começo do texto). */
export function localizeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const message = localizeMessage(error.message)
  if (message === error.message) return error
  const out = new Error(message, { cause: error })
  out.name = error.name
  return out
}

/** Envelope de um handler de IPC: traduz o retorno e o erro, tanto síncronos quanto assíncronos. */
export function localized(run: () => unknown): unknown {
  let out: unknown
  try { out = run() } catch (error) { throw localizeError(error) }
  return out instanceof Promise ? out.then((v) => localizeResult(v), (error) => { throw localizeError(error) }) : localizeResult(out)
}
