import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { PreferencesStore } from '../src/main/preferences/preferences-store'
import { writeEnvelopeAtomic } from '../src/main/domain/envelope'
const dirs: string[] = []
const file = () => { const d = mkdtempSync(join(tmpdir(), 'palco-prefs-')); dirs.push(d); return join(d, 'preferences.json') }
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
it('defaults tipados; aplica patch validado, persiste atomicamente e emite depois de gravar', () => {
  const f = file(), store = new PreferencesStore(f), events: unknown[] = []
  const off = store.onChange(p => { expect(JSON.parse(readFileSync(f, 'utf8')).payload.appearance).toBe(p.appearance); events.push(p) })
  expect(store.get().appearance).toBe('system')
  store.set({ appearance: 'light', terminalFontSize: 17 })
  expect(new PreferencesStore(f).get()).toMatchObject({ appearance: 'light', terminalFontSize: 17 })
  expect(events).toHaveLength(1); expect(readdirSync(dirs[0]!).some(x => x.endsWith('.tmp'))).toBe(false)
  expect(() => store.set({ terminalFontSize: -2 })).toThrow()
  expect(() => store.set({ arbitrary: true } as never)).toThrow()
  expect(events).toHaveLength(1); off()
})
it('migra v1 sem perder atalhos e mantém arquivo futuro/corrompido intacto', () => {
  const f = file(); writeEnvelopeAtomic(f, 'preferences', 1, { darkMode: false, terminalFontSize: 16 })
  const migrated = new PreferencesStore(f); expect(migrated.get().appearance).toBe('light'); migrated.set({ pointerCursors: true })
  expect(JSON.parse(readFileSync(f, 'utf8')).schemaVersion).toBe(4)
  const future = file(); writeEnvelopeAtomic(future, 'preferences', 99, { appearance: 'light' }); const bytes = readFileSync(future)
  const store = new PreferencesStore(future); expect(store.warning).toBeTruthy(); expect(() => store.set({ appearance: 'dark' })).toThrow(); expect(readFileSync(future)).toEqual(bytes)
  const bad = file(); writeFileSync(bad, '{invalid'); const broken = new PreferencesStore(bad)
  expect(broken.warning).toBeTruthy(); expect(() => broken.set({ appearance: 'light' })).toThrow(); expect(readFileSync(bad, 'utf8')).toBe('{invalid')
})
it('rebinding com conflito e reset são uma gravação/evento só', () => {
  const store = new PreferencesStore(file()); let events = 0; store.onChange(() => events++)
  const result = store.bind('undo', { key: 'l', mod: true }); expect(result.conflicts).toContain('connect'); expect(store.get().shortcuts.connect).toEqual([])
  store.resetShortcuts(); expect(store.get().shortcuts.connect).toHaveLength(1); expect(events).toBe(2)
})

it('falha de escrita não muda estado nem emite evento', () => {
  const f = file(), store = new PreferencesStore(f), before = store.get(); let events = 0
  store.onChange(() => events++)
  const dir = dirs.at(-1)!; rmSync(dir, { recursive: true }); writeFileSync(dir, 'obstáculo')
  expect(() => store.set({ appearance: 'light' })).toThrow()
  expect(store.get()).toEqual(before); expect(events).toBe(0)
})
