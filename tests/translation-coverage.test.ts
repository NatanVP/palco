import { describe, expect, it } from 'vitest'
import { LOCALES, SOURCE_LOCALE, type Locale } from '../src/shared/i18n'
import { CATALOGS } from '../src/shared/i18n/runtime'
import { SHORTCUTS } from '../src/shared/shortcuts'
import { PORTAL_STORAGE_HINT, PORTAL_STORAGE_LABEL } from '../src/shared/portal-settings'
import { THEMES } from '../src/shared/terminal-themes'
import { COLORS } from '../src/renderer/src/dialogs/new-terminal'

/** Mede a cobertura das traduções e exige que o inglês cubra todas as chaves da fonte pt-BR. */
const REQUIRED: Locale[] = ['en']
const source = CATALOGS[SOURCE_LOCALE]
const keys = Object.keys(source)
const missing = (l: Locale): string[] => keys.filter((k) => !CATALOGS[l][k]?.trim())
const percent = (l: Locale): number => Math.floor(((keys.length - missing(l).length) / keys.length) * 1000) / 10

describe('cobertura de tradução', () => {
  it('mostra a porcentagem de cada idioma', () => {
    const table = LOCALES.map((l) => `${l}: ${percent(l)}% (${keys.length - missing(l).length}/${keys.length})`)
    console.log(`cobertura de tradução\n${table.join('\n')}`)
    expect(table).toHaveLength(7)
  })
  it.each(REQUIRED)('%s tem todas as chaves (cobertura completa)', (l) => { expect(missing(l)).toEqual([]) })
  it('o inglês não deixa texto em português para trás', () => {
    const allowed = new Set(['Português (Brasil)'])
    const left = Object.entries(CATALOGS.en).filter(([, v]) => /[ãõçáéíóúâêôà]|\b(não|você|para o|em breve)\b/i.test(v.replace(/Español|Français/g, '')) && !allowed.has(v)).map(([k, v]) => `${k}: ${v}`)
    expect(left).toEqual([])
  })
})

describe('textos de src/shared que a interface mostra', () => {
  it('rótulos de atalho, armazenamento de portal e temas-base têm tradução (a tela usa tr())', () => {
    const known = new Set(Object.values(source))
    const shown = [...SHORTCUTS.map((s) => s.label), ...Object.values(PORTAL_STORAGE_LABEL), ...Object.values(PORTAL_STORAGE_HINT), ...THEMES.filter((th) => th.id.startsWith('palco-')).map((th) => th.name), ...COLORS.map((c) => c.name), 'Espaço']
    expect(shown.filter((s) => !known.has(s))).toEqual([])
  })
})
