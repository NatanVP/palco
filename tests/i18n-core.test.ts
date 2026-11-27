import { describe, expect, it, vi } from 'vitest'
import { createTranslator, detectLocale, formatters, interpolate, LOCALES, LOCALE_NAMES, lookup, paramsOf, resolveLocale, SOURCE_LOCALE, type Catalog, type Locale } from '../src/shared/i18n'
import { applyLanguage, CATALOGS, fmt, getLocale, setLocale, subscribeLocale, t } from '../src/shared/i18n/runtime'

describe('idiomas', () => {
  it('são os sete do palco, cada um com o nome na própria língua', () => {
    expect([...LOCALES].sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt-BR', 'zh-Hans']); expect(LOCALE_NAMES['pt-BR']).toBe('Português (Brasil)'); expect(LOCALE_NAMES.ja).toBe('日本語'); expect(LOCALE_NAMES['zh-Hans']).toBe('简体中文')
    expect(SOURCE_LOCALE).toBe('pt-BR')
  })
  it('detecta o idioma do sistema: igual, pelo primeiro segmento, ou inglês', () => {
    expect(detectLocale('pt-BR')).toBe('pt-BR'); expect(detectLocale('pt-PT')).toBe('pt-BR'); expect(detectLocale('pt')).toBe('pt-BR'); expect(detectLocale('zh-CN')).toBe('zh-Hans'); expect(detectLocale('zh')).toBe('zh-Hans')
    expect(detectLocale('en-US')).toBe('en'); expect(detectLocale('de_DE')).toBe('de'); expect(detectLocale('ja-JP')).toBe('ja'); expect(detectLocale('ru-RU')).toBe('en'); expect(detectLocale(undefined)).toBe('en'); expect(detectLocale('ES')).toBe('es')
  })
  it('a preferência vence; null segue o sistema', () => { expect(resolveLocale('fr', 'pt-BR')).toBe('fr'); expect(resolveLocale(null, 'de-AT')).toBe('de'); expect(resolveLocale('xx' as never, 'ja')).toBe('ja') })
})
describe('texto: interpolação, plural e reserva', () => {
  it('interpola {nome}; o que falta fica visível', () => { expect(interpolate('Olá, {nome}! {n} itens', { nome: 'Ana', n: 3 })).toBe('Olá, Ana! 3 itens'); expect(interpolate('Olá, {nome}', {})).toBe('Olá, {nome}'); expect(interpolate('sem parâmetro')).toBe('sem parâmetro'); expect(paramsOf('{b} e {a} e {b}')).toEqual(['a', 'b']) })
  const cat = (o: Record<string, string>): Catalog => o
  it('plural por categoria do idioma, com _other de reserva', () => {
    const cats: Partial<Record<Locale, Catalog>> = {
      'pt-BR': cat({ k_one: '{count} item', k_other: '{count} itens' }), en: cat({ k_one: '{count} item', k_other: '{count} items' }), ja: cat({ k_other: '{count}件' }),
      fr: cat({ k_one: '{count} élément', k_other: '{count} éléments' })
    }
    let loc: Locale = 'pt-BR'; const tr = createTranslator<string>(cats, () => loc)
    expect(tr('k', { count: 1 })).toBe('1 item'); expect(tr('k', { count: 3 })).toBe('3 itens'); expect(tr('k', { count: 0 })).toBe('0 item') // CLDR: no pt, 0 é singular
    loc = 'en'; expect(tr('k', { count: 1 })).toBe('1 item'); expect(tr('k', { count: 2 })).toBe('2 items')
    loc = 'ja'; expect(tr('k', { count: 1 })).toBe('1件'); expect(tr('k', { count: 5 })).toBe('5件')
    loc = 'fr'; expect(tr('k', { count: 0 })).toBe('0 élément'); expect(tr('k', { count: 2 })).toBe('2 éléments')
  })
  it('chave que falta no idioma cai no inglês e depois no pt-BR; chave desconhecida volta a própria chave', () => {
    const cats: Partial<Record<Locale, Catalog>> = { 'pt-BR': cat({ a: 'A pt', b: 'B pt', c: 'C pt' }), en: cat({ a: 'A en', b: 'B en' }), de: cat({ a: 'A de' }) }
    const tr = createTranslator<string>(cats, () => 'de')
    expect(tr('a')).toBe('A de'); expect(tr('b')).toBe('B en'); expect(tr('c')).toBe('C pt'); expect(tr('zzz')).toBe('zzz'); expect(lookup(cats, 'de', 'zzz')).toBeUndefined()
  })
})
describe('formatadores (Intl com o idioma da interface)', () => {
  const when = Date.UTC(2026, 10, 25, 15, 30)
  it('data, hora, número e lista mudam com o idioma', () => {
    expect(formatters('en').number(1234567.5)).toBe('1,234,567.5'); expect(formatters('pt-BR').number(1234567.5)).toBe('1.234.567,5'); expect(formatters('de').number(1234.5)).toBe('1.234,5')
    expect(formatters('en').list(['A', 'B', 'C'])).toBe('A, B, and C'); expect(formatters('pt-BR').list(['A', 'B', 'C'])).toBe('A, B e C'); expect(formatters('pt-BR').list(['A', 'B'])).toBe('A e B')
    expect(formatters('en').date(when)).toMatch(/Nov 25, 2026/); expect(formatters('pt-BR').date(when)).toMatch(/25 de nov\. de 2026/); expect(formatters('ja').date(when)).toMatch(/2026/)
  })
  it('relativo e tamanho', () => {
    expect(formatters('en').relative(-300)).toBe('5 minutes ago'); expect(formatters('pt-BR').relative(-300)).toBe('há 5 minutos'); expect(formatters('en').relative(-90000)).toBe('yesterday'); expect(formatters('pt-BR').relative(10)).toBe('em 10 segundos')
    expect(formatters('en').bytes(1500)).toBe('1.5 kB'); expect(formatters('en').bytes(12)).toBe('12 byte'); expect(formatters('pt-BR').bytes(2_500_000)).toMatch(/2,5\s?MB/)
  })
})
describe('runtime: troca na hora', () => {
  it('setLocale avisa os ouvintes uma vez e t() passa a responder no novo idioma', () => {
    const seen = vi.fn(), off = subscribeLocale(seen)
    setLocale('pt-BR'); const before = getLocale(); expect(t('i18n.language')).toBe('Idioma')
    setLocale('en'); expect(seen).toHaveBeenCalledTimes(1); expect(t('i18n.language')).toBe('Language'); setLocale('en'); expect(seen).toHaveBeenCalledTimes(1)
    expect(applyLanguage(null, 'pt-PT')).toBe('pt-BR'); expect(t('i18n.language')).toBe('Idioma'); expect(fmt().number(1.5)).toBe('1,5')
    off(); setLocale(before)
  })
})
describe('catálogos: o que vale para todas as línguas', () => {
  const source = CATALOGS['pt-BR']
  it('nenhuma língua tem chave que o pt-BR não tem, e os parâmetros {x} de cada texto são os mesmos', () => {
    for (const l of LOCALES) for (const [k, v] of Object.entries(CATALOGS[l])) {
      expect(k in source, `${l}: chave fora da fonte: ${k}`).toBe(true)
      expect(paramsOf(v), `${l}: parâmetros de ${k}`).toEqual(paramsOf(source[k]!))
    }
  })
  it('chave de plural tem sempre a forma _other', () => {
    for (const l of LOCALES) { const c = CATALOGS[l]; for (const k of Object.keys(c)) { const m = /^(.*)_(zero|one|two|few|many)$/.exec(k); if (m) expect(`${m[1]}_other` in c, `${l}: ${k} sem _other`).toBe(true) } }
  })
})
