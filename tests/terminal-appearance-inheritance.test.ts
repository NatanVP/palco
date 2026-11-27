import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateAppearance } from '../src/shared/appearance'
import { PresetStore } from '../src/main/agents/presets'
import { RoleStore } from '../src/main/agents/roles'
import { invalidTerminalExtras, pickTerminalExtras } from '../src/main/domain/terminal-extras'
import { emptyForm, quickTileForm, toNewNode } from '../src/renderer/src/dialogs/new-terminal'
import { terminalLook, chatLook } from '../src/renderer/src/nodes/look'
import { facesOf, type LocalFont } from '../src/renderer/src/settings/controls/font-faces'
import { defaultPreferences } from '../src/shared/preferences'

const full = { icon: 'rocket', color: '#33AAFF', themeId: 'dracula', darkThemeId: 'tokyo-night', fontFamily: 'Fira Code', fontSize: 15, chatFontFamily: 'Georgia', chatFontSize: 16 }
describe('aparência (preset e terminal): tudo opcional, vazio = herdar do global', () => {
  it('aceita um subconjunto válido e devolve só os campos conhecidos', () => {
    expect(validateAppearance(full)).toEqual(full); expect(validateAppearance({})).toEqual({}); expect(validateAppearance(undefined)).toEqual({}); expect(validateAppearance({ color: '#000000' })).toEqual({ color: '#000000' })
  })
  it('recusa cor, tema, fonte e tamanho inválidos e campo desconhecido', () => {
    for (const bad of [{ color: 'red' }, { themeId: 'Tema Ruim!' }, { darkThemeId: '' }, { fontFamily: 'a;b' }, { fontFamily: 'x'.repeat(300) }, { fontSize: 7 }, { fontSize: 41 }, { chatFontSize: 7 }, { chatFontSize: 33 }, { icon: '' }, { hack: 1 }, 'x', [1]]) expect(() => validateAppearance(bad as never), JSON.stringify(bad)).toThrow()
  })
  it('par claro/escuro só com o tema claro definido', () => { expect(() => validateAppearance({ darkThemeId: 'nord' })).toThrow(/par/) })
})
describe('PresetStore guarda a aparência', () => {
  const dirs: string[] = []; afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
  const mk = () => { const d = mkdtempSync(join(tmpdir(), 'palco-pa-')); dirs.push(d); return { d, s: new PresetStore(join(d, 'presets.json'), new RoleStore(join(d, 'roles'))) } }
  it('cria, relê do disco, troca e limpa', () => {
    const { d, s } = mk(); s.create({ name: 'Rev', command: 'claude', appearance: full })
    expect(new PresetStore(join(d, 'presets.json'), new RoleStore(join(d, 'roles'))).list()[0]?.appearance).toEqual(full)
    expect(s.set('Rev', { appearance: { color: '#112233' } }).appearance).toEqual({ color: '#112233' }); expect(s.set('Rev', { appearance: {} }).appearance).toBeUndefined()
  })
  it('aparência inválida recusa o preset sem gravar', () => { const { s } = mk(); expect(() => s.create({ name: 'X', command: 'claude', appearance: { color: 'nope' } as never })).toThrow(); expect(s.list()).toEqual([]) })
})
describe('campos novos do nó terminal', () => {
  it('validados e gravados', () => {
    expect(invalidTerminalExtras({ themeId: 'dracula', darkThemeId: 'nord', fontFamily: 'Fira Code', chatFontFamily: 'Georgia', chatFontSize: 14 })).toEqual([])
    expect(invalidTerminalExtras({ themeId: 'a b', fontFamily: 'x;y', chatFontSize: 99 }).sort()).toEqual(['chatFontSize', 'fontFamily', 'themeId'])
    expect(pickTerminalExtras({ themeId: 'dracula' })).toEqual({ themeId: 'dracula' })
  })
})
describe('do preset para o terminal novo', () => {
  const frame = { pos: { x: 0, y: 0 }, size: { w: 500, h: 300 } }
  it('o atalho do preset preenche o formulário e o nó nasce com a aparência', () => {
    const form = quickTileForm({ id: 'x', name: 'Rev', command: 'claude', icon: 'sparkles', preset: { name: 'Rev', agent: 'claude', command: 'claude', appearance: full } }, [])
    expect(form).toMatchObject({ icon: 'rocket', color: '#33AAFF', fontSize: 15, themeId: 'dracula', darkThemeId: 'tokyo-night', fontFamily: 'Fira Code', chatFontFamily: 'Georgia', chatFontSize: 16 })
    expect(toNewNode({ ...emptyForm(), command: 'claude', ...form }, frame, null, [])).toMatchObject({ icon: 'rocket', color: '#33AAFF', fontSize: 15, themeId: 'dracula', fontFamily: 'Fira Code', chatFontSize: 16 })
  })
  it('sem aparência no preset nada de novo vai para o nó', () => { const n = toNewNode({ ...emptyForm(), command: 'claude' }, frame, null, []); for (const k of ['themeId', 'darkThemeId', 'fontFamily', 'chatFontFamily', 'chatFontSize']) expect(n).not.toHaveProperty(k) })
})
describe('o que o terminal e o chat usam: o do nó, senão o global', () => {
  const p = defaultPreferences(), node = (o = {}) => ({ id: 't', kind: 'terminal', name: 'A', agent: 'claude', command: '', cwd: '/', floorId: null, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 }, ...o }) as never
  it('terminal', () => {
    expect(terminalLook(node(), p, false)).toMatchObject({ fontFamily: p.terminalFontFamily, fontSize: p.terminalFontSize, theme: expect.objectContaining({ id: 'palco-dark' }) })
    expect(terminalLook(node({ fontFamily: 'Fira Code', fontSize: 18, themeId: 'dracula' }), p, false)).toMatchObject({ fontFamily: 'Fira Code', fontSize: 18, theme: expect.objectContaining({ id: 'dracula' }) })
    const pair = node({ themeId: 'gruvbox-light', darkThemeId: 'gruvbox-dark' }); expect(terminalLook(pair, p, true).theme.id).toBe('gruvbox-light'); expect(terminalLook(pair, p, false).theme.id).toBe('gruvbox-dark')
  })
  it('chat', () => { expect(chatLook(node(), p)).toEqual({ fontFamily: '', fontSize: 13 }); expect(chatLook(node({ chatFontFamily: 'Georgia', chatFontSize: 17 }), p)).toEqual({ fontFamily: 'Georgia', fontSize: 17 }) })
})
describe('Estilo da face da fonte', () => {
  const fonts: LocalFont[] = [{ family: 'Fira Code', fullName: 'Fira Code Regular', postscriptName: 'FiraCode-Regular', style: 'Regular' }, { family: 'Fira Code', fullName: 'Fira Code Bold', postscriptName: 'FiraCode-Bold', style: 'Bold' }, { family: 'Mono Um', fullName: 'Mono Um', postscriptName: 'MonoUm', style: 'Regular' }]
  it('lista as faces da família, só quando há mais de uma', () => {
    expect(facesOf(fonts, 'Fira Code')).toEqual([{ value: 'FiraCode-Regular', label: 'Regular' }, { value: 'FiraCode-Bold', label: 'Bold' }]); expect(facesOf(fonts, 'Mono Um')).toEqual([]); expect(facesOf(fonts, 'Outra')).toEqual([])
  })
  it('família guardada como postscriptName ainda acha as faces (e a face atual)', () => { expect(facesOf(fonts, 'FiraCode-Bold')).toHaveLength(2) })
})
