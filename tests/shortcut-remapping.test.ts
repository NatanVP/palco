import { describe, expect, it } from 'vitest'
import { defaultShortcuts, matchShortcut, rebindShortcut, bindingFromEvent, SHORTCUTS } from '../src/shared/shortcuts'
const key = (key: string, extra = {}) => ({ key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })
describe('registro único de atalhos', () => {
  it('preserva padrões de conectar, partituras, desenho e histórico', () => {
    const s = defaultShortcuts()
    expect(matchShortcut('connect', key('l', { ctrlKey: true }), s)).toBe(true)
    expect(matchShortcut('partituras', key('L', { metaKey: true, shiftKey: true }), s)).toBe(true)
    expect(matchShortcut('undo', key('z', { ctrlKey: true }), s)).toBe(true)
    expect(matchShortcut('redo', key('z', { metaKey: true, shiftKey: true }), s)).toBe(true)
    expect(matchShortcut('drawRectangle', key('b'), s)).toBe(true)
    expect(matchShortcut('drawThinner', key('['), s)).toBe(true)
    expect(matchShortcut('drawThicker', key(']'), s)).toBe(true)
    expect(matchShortcut('drawRectangle', key('b', { shiftKey: true }), s)).toBe(false)
    expect(matchShortcut('undo', key('z', { ctrlKey: true, metaKey: true }), s)).toBe(false)
    expect(new Set(SHORTCUTS.map(x => x.id)).size).toBe(SHORTCUTS.length)
  })
  it('grava tecla nova, detecta conflito e desaloja anterior sem mexer em scopes independentes', () => {
    const s = defaultShortcuts(), binding = bindingFromEvent(key('l', { ctrlKey: true }))!
    const result = rebindShortcut(s, 'undo', binding)
    expect(result.conflicts).toContain('connect')
    expect(result.shortcuts.connect).toEqual([])
    expect(matchShortcut('undo', key('l', { ctrlKey: true }), result.shortcuts)).toBe(true)
    expect(matchShortcut('undo', key('z', { ctrlKey: true }), result.shortcuts)).toBe(false)
    expect(defaultShortcuts().connect).not.toEqual([])
    expect(bindingFromEvent(key('Control', { ctrlKey: true }))).toBeNull()
    expect(bindingFromEvent(key('Escape'))).toBeNull()
  })
  it('permite limpar e restaurar padrões e registra zoom como modificador', () => {
    const empty = rebindShortcut(defaultShortcuts(), 'undo', null).shortcuts
    expect(matchShortcut('undo', key('z', { ctrlKey: true }), empty)).toBe(false)
    expect(defaultShortcuts().undo).toHaveLength(1)
    expect(SHORTCUTS.find(x => x.id === 'zoomWheel')?.kind).toBe('modifier')
  })
})
it('conflito por código físico independe do caractere do layout', () => {
  const s = defaultShortcuts(); s.connect = [{ key: ';', code: 'Semicolon', mod: true }]
  expect(rebindShortcut(s, 'undo', { key: 'ç', code: 'Semicolon', mod: true }).conflicts).toContain('connect')
})
it('teclas do laço vivem no registro: copiar, colar, duplicar, apagar e pan com padrões e remapeamento', () => {
  const s = defaultShortcuts()
  expect(matchShortcut('copy', key('c', { ctrlKey: true }), s)).toBe(true)
  expect(matchShortcut('paste', key('v', { metaKey: true }), s)).toBe(true)
  expect(matchShortcut('duplicate', key('d', { ctrlKey: true }), s)).toBe(true)
  expect(matchShortcut('panToggle', key('h'), s)).toBe(true)
  expect(matchShortcut('panHold', key('Control', { ctrlKey: true }), s)).toBe(true)
  const r = rebindShortcut(s, 'duplicate', { key: 'j', mod: true })
  expect(matchShortcut('duplicate', key('d', { ctrlKey: true }), r.shortcuts)).toBe(false)
  expect(matchShortcut('duplicate', key('j', { ctrlKey: true }), r.shortcuts)).toBe(true)
})
