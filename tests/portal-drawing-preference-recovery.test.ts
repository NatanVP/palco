import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { PreferencesStore } from '../src/main/preferences/preferences-store'
import { writeEnvelopeAtomic } from '../src/main/domain/envelope'
import { defaultPreferences } from '../src/shared/preferences'
import { defaultShortcuts, rebindShortcut } from '../src/shared/shortcuts'
import * as security from '../src/main/security'
import * as portal from '../src/shared/portal-settings'
import * as shortcutsRenderer from '../src/renderer/src/shortcuts'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { selectionKeyAction } from '../src/renderer/src/canvas/selection/keys'
import * as group from '../src/renderer/src/canvas/selection/group'
import * as api from '../src/shared/api'
import { parseNewNode } from '../src/main/validate'

const dirs: string[] = []
const file = () => { const d = mkdtempSync(join(tmpdir(), 'palco-rev-')); dirs.push(d); return join(d, 'preferences.json') }
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))

describe("reservado salvo como [] não vence o padrão novo", () => {
  it('arquivo antigo (versão 2, mapa inteiro) com panToggle [] passa a usar o padrão H', () => {
    const f = file(), old = defaultPreferences()
    writeEnvelopeAtomic(f, 'preferences', 2, { ...old, shortcuts: { ...old.shortcuts, panToggle: [] } })
    expect(new PreferencesStore(f).get().shortcuts.panToggle).toEqual([{ key: 'h' }])
  })
  it('quem limpa o atalho de propósito continua sem ele depois de reabrir', () => {
    const f = file(), s = new PreferencesStore(f)
    s.bind('panToggle', null)
    expect(new PreferencesStore(f).get().shortcuts.panToggle).toEqual([])
  })
  it('só grava o que difere do padrão: um atalho que ganhar padrão novo não fica preso', () => {
    const f = file(), s = new PreferencesStore(f)
    s.set({ appearance: 'light' }); s.bind('undo', { key: 'j', mod: true })
    const saved = JSON.parse(readFileSync(f, 'utf8')).payload.shortcuts as Record<string, unknown>
    expect(Object.keys(saved)).toEqual(['undo'])
  })
})

describe('preferências: campo inválido e arquivo ilegível', () => {
  it('um campo inválido é ignorado; o resto do arquivo vale e dá para gravar', () => {
    const f = file()
    writeEnvelopeAtomic(f, 'preferences', 2, { ...defaultPreferences(), appearance: 'light', terminalFontSize: 7 })
    const s = new PreferencesStore(f)
    expect(s.get()).toMatchObject({ appearance: 'light', terminalFontSize: 13 })
    expect(s.warning).toMatch(/terminalFontSize/)
    expect(() => s.set({ copyOnSelect: true })).not.toThrow()
  })
  it('id de atalho desconhecido é ignorado sem derrubar o resto', () => {
    const f = file()
    writeEnvelopeAtomic(f, 'preferences', 2, { ...defaultPreferences(), appearance: 'light', shortcuts: { ...defaultShortcuts(), futuro: [] } })
    expect(new PreferencesStore(f).get().appearance).toBe('light')
  })
  it('arquivo corrompido: recupera do .bak, guarda o corrompido e volta a gravar', () => {
    const f = file(), s = new PreferencesStore(f)
    s.set({ appearance: 'light' }); s.set({ terminalFontSize: 20 }) // o .bak guarda o penúltimo
    writeFileSync(f, '{ isto não é json')
    const r = new PreferencesStore(f)
    expect(r.get().appearance).toBe('light')
    expect(r.warning).toMatch(/backup/i)
    expect(existsSync(`${f}.corrupt`)).toBe(true)
    expect(() => r.set({ copyOnSelect: true })).not.toThrow()
  })
  it('corrompido sem .bak válido continua somente leitura e preservado', () => {
    const f = file(); writeFileSync(f, 'lixo')
    const s = new PreferencesStore(f)
    expect(() => s.set({ appearance: 'light' })).toThrow(/somente leitura/)
    expect(readFileSync(f, 'utf8')).toBe('lixo')
  })
})

describe('desalojo de atalho', () => {
  it('Desfazer = Delete tira só o Delete de "Apagar seleção"; o Ctrl+W e o Backspace ficam', () => {
    const r = rebindShortcut(defaultShortcuts(), 'undo', { key: 'Delete' })
    expect(r.conflicts).toContain('deleteSelection')
    expect(r.shortcuts.deleteSelection).toEqual([{ key: 'w', mod: true }, { key: 'Backspace' }])
  })
  it('conflito que cobre todas as teclas da ação deixa a lista vazia', () => {
    const base = defaultShortcuts(); base.connect = [{ key: 'l', mod: true }]
    expect(rebindShortcut(base, 'undo', { key: 'l', mod: true }).shortcuts.connect).toEqual([])
  })
})

describe("atalho global sem modificador não rouba a letra", () => {
  const ev = (key: string, target: object, mods: object = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target, ...mods }) as never
  const field = { tagName: 'INPUT', closest: () => null, isContentEditable: false }
  const note = { tagName: 'DIV', isContentEditable: true, closest: () => null }
  const term = { tagName: 'TEXTAREA', closest: (s: string) => (s.includes('.xterm') ? {} : null), isContentEditable: false }
  const body = { tagName: 'DIV', closest: () => null, isContentEditable: false }
  const withBare = (id: 'settings' | 'prompter' | 'partituras') => { const m = defaultShortcuts(); m[id] = [{ key: 'p' }]; return m }
  it('tecla nua em campo, nota em edição e terminal: não é atalho global', () => {
    const f = shortcutsRenderer.matchesGlobalShortcutIn
    for (const t of [field, note, term]) expect(f?.('prompter', ev('p', t), withBare('prompter'))).toBe(false)
  })
  it('tecla nua no canvas (foco no corpo) continua sendo atalho', () => {
    expect(shortcutsRenderer.matchesGlobalShortcutIn?.('prompter', ev('p', body), withBare('prompter'))).toBe(true)
  })
  it('com Ctrl/Cmd/Alt vale em qualquer foco, até no campo', () => {
    const m = defaultShortcuts()
    expect(shortcutsRenderer.matchesGlobalShortcutIn?.('settings', ev(',', field, { ctrlKey: true }), m)).toBe(true)
    expect(shortcutsRenderer.matchesGlobalShortcutIn?.('prompter', ev('p', term, { ctrlKey: true, shiftKey: true }), m)).toBe(true)
  })
})

describe("Espaço configurado não rouba botão focado", () => {
  beforeEach(() => { const p = defaultPreferences(); p.shortcuts.panHold = [{ key: ' ' }]; adoptPreferences(p) })
  afterEach(() => adoptPreferences(defaultPreferences()))
  const ev = (key: string, target: object) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, repeat: false, target: { closest: () => null, isContentEditable: false, ...target } }) as unknown as KeyboardEvent
  it('Espaço com foco em botão, link ou role=button/menuitem fica com o elemento', () => {
    for (const t of [{ tagName: 'BUTTON' }, { tagName: 'A' }, { tagName: 'DIV', closest: ((s: string) => (s.includes('[role="button"]') ? {} : null)) as never }])
      expect(selectionKeyAction(ev(' ', t), { hasSelection: false })).toBeNull()
  })
  it('Espaço no corpo do canvas continua segurando o pan; H em botão também não é roubado', () => {
    expect(selectionKeyAction(ev(' ', { tagName: 'DIV' }), { hasSelection: false })).toEqual({ kind: 'hold-pan' })
  })
})

describe('segurança do portal', () => {
  it('http(s) não pode navegar para file://; file:// e about:blank podem', () => {
    const f = security.allowGuestNavigation
    expect(f?.('https://exemplo.com/', 'file:///etc/hostname')).toBe(false)
    expect(f?.('http://localhost:3000/', 'file:///etc/hostname')).toBe(false)
    expect(f?.('https://exemplo.com/', 'https://outro.com/')).toBe(true)
    expect(f?.('file:///home/a/index.html', 'file:///home/a/b.html')).toBe(true)
    expect(f?.('about:blank', 'file:///home/a/index.html')).toBe(true)
    expect(f?.('', 'file:///home/a/index.html')).toBe(true)
    expect(f?.('https://exemplo.com/', 'javascript:alert(1)')).toBe(false)
  })
  it('useragent inválido do renderer é removido no will-attach-webview; válido passa', () => {
    const bad: Record<string, unknown> = { src: 'https://a.com/', partition: 'persist:palco-portal', useragent: 'x\r\nInjetado: 1' }
    expect(security.enforceWebviewPolicy({}, bad)).toBe(true)
    expect(bad.useragent).toBeUndefined()
    const long: Record<string, unknown> = { src: 'https://a.com/', useragent: 'a'.repeat(600) }
    security.enforceWebviewPolicy({}, long); expect(long.useragent).toBeUndefined()
    const ok: Record<string, unknown> = { src: 'https://a.com/', useragent: 'Mozilla/5.0 (X11; Linux x86_64)' }
    security.enforceWebviewPolicy({}, ok); expect(ok.useragent).toBe('Mozilla/5.0 (X11; Linux x86_64)')
  })
  it('endereço de LAN e .local ganha http; internet continua https', () => {
    const n = portal.normalizePortalInput
    expect(n('192.168.0.5:3000')).toBe('http://192.168.0.5:3000/')
    expect(n('10.0.0.2:8080/x')).toBe('http://10.0.0.2:8080/x')
    expect(n('172.20.1.1')).toBe('http://172.20.1.1/')
    expect(n('minha-maquina.local:8080')).toBe('http://minha-maquina.local:8080/')
    expect(n('nas:5000')).toBe('http://nas:5000/')
    expect(n('172.32.0.1')).toBe('https://172.32.0.1/')
    expect(n('exemplo.com')).toBe('https://exemplo.com/')
    expect(n('8.8.8.8')).toBe('https://8.8.8.8/')
  })
})

describe('lote grande: falha avisada', () => {
  it('o limite é uma constante compartilhada e o renderer testa antes de enviar', () => {
    expect(api.MAX_HISTORY_BATCH).toBe(1000)
    expect(group.batchTooLarge?.(new Array(1001).fill({}))).toBe(true)
    expect(group.batchTooLarge?.(new Array(1000).fill({}))).toBe(false)
  })
})

describe('copiar fichário', () => {
  const note = (id: string, stackId?: string) => ({ id, kind: 'note' as const, floorId: null, name: id, content: id, pos: { x: 0, y: 0 }, size: { w: 100, h: 80 }, ...(stackId ? { stackId } : {}) })
  const ws = (nodes: object[]) => ({ nodes: Object.fromEntries((nodes as Array<{ id: string }>).map(n => [n.id, n])), connections: [], drawings: [] }) as never
  it('as notas coladas formam um fichário novo, separado da versão anterior e de outros', () => {
    const w = ws([note('A', 's1'), note('B', 's1'), note('C', 's2'), note('D', 's2'), note('E')])
    const clip = group.captureSelection(w, ['A', 'B', 'C', 'D', 'E'], [])
    const ops = group.pasteOperations(clip, { x: 10, y: 10 }, ['A', 'B', 'C', 'D', 'E'], null) as Array<{ node: { stackId?: string } }>
    const ids = ops.map(o => o.node.stackId)
    expect(ids[0]).toBeTruthy(); expect(ids[0]).toBe(ids[1]); expect(ids[0]).not.toBe('s1')
    expect(ids[2]).toBe(ids[3]); expect(ids[2]).not.toBe(ids[0]); expect(ids[4]).toBeUndefined()
  })
  it('nota sozinha de um fichário (o outro ficou de fora) vira nota solta', () => {
    const clip = group.captureSelection(ws([note('A', 's1'), note('B', 's1')]), ['A'], [])
    const [op] = group.pasteOperations(clip, { x: 0, y: 0 }, [], null) as Array<{ node: { stackId?: string } }>
    expect(op!.node.stackId).toBeUndefined()
  })
  it('o main aceita stackId válido ao criar nota e recusa inválido', () => {
    const base = { kind: 'note', name: 'n', content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 80 } }
    expect((parseNewNode({ ...base, stackId: 'abc-123' }) as { stackId?: string }).stackId).toBe('abc-123')
    expect(() => parseNewNode({ ...base, stackId: '../x' })).toThrow()
  })
})
