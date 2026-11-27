// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OPTIONS } from '../../src/renderer/src/settings/options'
import { OptionRow } from '../../src/renderer/src/settings/controls/OptionRow'
import { adoptPreferences, getPreferences } from '../../src/renderer/src/settings/preferences'
import { useLocale } from '../../src/renderer/src/i18n'
import { defaultPreferences } from '../../src/shared/preferences'
import { getLocale } from '../../src/shared/i18n/runtime'

const def = () => OPTIONS.find(o => o.key === 'appLanguage')!
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  adoptPreferences(defaultPreferences())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Object.assign(window, { palco: { preferences: { set: vi.fn(async patch => { const next = { ...getPreferences(), ...patch }; adoptPreferences(next); return next }) } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); adoptPreferences(defaultPreferences()); vi.unstubAllGlobals() })
function Row() { useLocale(); return createElement(OptionRow, { def: def() }) }
const select = () => host.querySelector('select')!
const choose = async (value: string) => { await act(async () => { select().value = value; select().dispatchEvent(new Event('change', { bubbles: true })) }) }

it('Idioma está ligado: Padrão do Sistema, Português (Brasil) e English, com nomes nativos', async () => {
  await act(async () => root.render(createElement(Row)))
  expect(def().ready).toBe(true); expect(select().disabled).toBe(false)
  expect([...select().options].map(o => [o.value, o.textContent])).toEqual([['', 'Padrão do Sistema'], ['pt-BR', 'Português (Brasil)'], ['en', 'English']])
})
it('escolher troca na hora, com <html lang>; Padrão do Sistema volta ao idioma do sistema', async () => {
  await act(async () => root.render(createElement(Row)))
  await choose('en')
  expect(window.palco.preferences.set).toHaveBeenLastCalledWith({ appLanguage: 'en' })
  expect(getLocale()).toBe('en'); expect(document.documentElement.lang).toBe('en'); expect(host.textContent).toContain('Language')
  expect([...select().options].map(o => o.textContent)).toEqual(['System Default', 'Português (Brasil)', 'English'])
  await choose('')
  expect(window.palco.preferences.set).toHaveBeenLastCalledWith({ appLanguage: null })
  expect(getLocale()).toBe('pt-BR'); expect(document.documentElement.lang).toBe('pt-BR'); expect(host.textContent).toContain('Idioma')
})
it('idioma que o app ainda não oferece (preferência antiga ou do sistema) cai no inglês', () => {
  adoptPreferences({ ...defaultPreferences(), appLanguage: 'fr' }); expect(getLocale()).toBe('en')
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE'); adoptPreferences(defaultPreferences()); expect(getLocale()).toBe('en')
  vi.restoreAllMocks()
})
