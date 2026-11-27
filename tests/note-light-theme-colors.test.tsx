// @vitest-environment happy-dom
// no tema claro a nota inteira é pintada com a cor pastel.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noteLight } from '../src/renderer/src/nodes/note-colors'
import { NOTE_COLOR_HEX } from '../src/shared/new-item'
import { mountApp, emptyWorkspace, type Harness } from './helpers/app-harness'

const CSS = ['styles.css', 'settings/settings.css'].map((p) => readFileSync(join(process.cwd(), 'src/renderer/src', p), 'utf8').replace(/^@import.*$/gm, '')).join('\n')

describe('cores da nota no tema claro', () => {
  it.each([
    ['yellow', '#fff9c4', '#5d4037'], ['pink', '#f8bbd0', '#880e4f'], ['blue', '#bbdefb', '#0d47a1'], ['green', '#c8e6c9', '#1b5e20'], ['orange', '#ffe0b2', '#e65100'],
    ['purple', '#e1bee7', '#4a148c'], ['white', '#ffffff', '#333333'], ['charcoal', '#2d2d2d', '#ffffff'], ['slate', '#37474f', '#ffffff'], ['midnight', '#1a237e', '#ffffff']
  ] as const)('%s', (name, fill, ink) => {
    expect(noteLight(NOTE_COLOR_HEX[name])).toMatchObject({ fill, ink })
  })
  it('sem cor é amarela; cor personalizada é o próprio fundo, com o texto que contrasta', () => {
    expect(noteLight(undefined)).toMatchObject({ fill: '#fff9c4', ink: '#5d4037' })
    expect(noteLight('#FFFF00')).toMatchObject({ fill: '#FFFF00', ink: '#333333' })
    expect(noteLight('#102030')).toMatchObject({ fill: '#102030', ink: '#ffffff' })
  })
  it('o cabeçalho escurece o pastel claro e clareia o escuro', () => {
    expect(noteLight(NOTE_COLOR_HEX.yellow).shade).toBe('#0000000f')
    expect(noteLight(NOTE_COLOR_HEX.midnight).shade).toBe('#ffffff1a')
  })
})

describe('no canvas', () => {
  let app: Harness, style: HTMLStyleElement
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); style = document.createElement('style'); style.textContent = CSS; document.head.append(style) })
  afterEach(async () => { await app.unmount(); style.remove(); delete document.documentElement.dataset.appearance; vi.unstubAllGlobals() })
  const note = (id: string, color?: string) => ({ id, kind: 'note', name: id, content: 'texto', floorId: null, pos: { x: 0, y: 0 }, size: { w: 260, h: 160 }, ...(color ? { color } : {}) })
  const mount = async () => { app = await mountApp({ workspace: emptyWorkspace({ nodes: { a: note('a'), b: note('b', NOTE_COLOR_HEX.blue) } as never }) }) }
  const look = (id: string, selector: string) => { const s = getComputedStyle(app.host.querySelector(`[data-node-id="${id}"] ${selector}`)!); return [s.backgroundColor.toLowerCase(), s.color.toLowerCase()] }

  it('claro: corpo e cartão com o pastel, texto na cor da família', async () => {
    await mount(); document.documentElement.dataset.appearance = 'light'
    expect(look('a', '.note-text')).toEqual(['#fff9c4', '#5d4037'])
    expect(look('b', '.note-text')).toEqual(['#bbdefb', '#0d47a1'])
    expect(app.host.querySelector<HTMLElement>('[data-node-id="b"]')!.style.getPropertyValue('--note-fill')).toBe('#bbdefb')
    expect(getComputedStyle(app.host.querySelector('[data-node-id="b"] .node-header')!).color.toLowerCase()).toBe('#0d47a1')
  })
  it('escuro: continua como era', async () => {
    await mount(); document.documentElement.dataset.appearance = 'dark'
    expect(look('a', '.note-text')).toEqual(['#25220f', '#f1e9c4'])
  })
})
