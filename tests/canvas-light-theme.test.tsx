// @vitest-environment happy-dom
// no tema claro as barras e os botões flutuantes do canvas são claros (calculado com as folhas reais).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(join(process.cwd(), 'src/renderer/src', p), 'utf8').replace(/^@import.*$/gm, '')
const CSS = [read('styles.css'), read('settings/settings.css'), read('composer/composer.css')].join('\n')

/** Cores presentes no valor, com a luminância e a opacidade. */
function colors(raw: string): Array<{ l: number; a: number }> {
  const out: Array<{ l: number; a: number }> = []
  // Um tom `color-mix(in srgb, cor P%, transparent)` vale como a cor com opacidade P.
  const value = raw.replace(/color-mix\(in srgb, (#[0-9a-f]+) (\d+)%, transparent\)/gi, (_all, color: string, pct: string) => { for (const c of colors(color)) out.push({ l: c.l, a: c.a * Number(pct) / 100 }); return '' })
  for (const [, hex] of value.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi)) {
    const full = hex!.length < 6 ? [...hex!].map((c) => c + c).join('') : hex!
    const [r, g, b, a = 255] = full.match(/../g)!.map((x) => parseInt(x, 16))
    out.push({ l: (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255, a: a / 255 })
  }
  for (const [, body] of value.matchAll(/rgba?\(([^()]+)\)/g)) {
    const [r, g, b, a = 1] = body!.split(/[ ,/]+/).filter(Boolean).map(Number)
    out.push({ l: (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255, a })
  }
  return out
}
const background = (el: Element): Array<{ l: number; a: number }> => { const s = getComputedStyle(el); return colors(`${s.background} ${s.backgroundColor} ${s.backgroundImage}`) }
const text = (el: Element): { l: number; a: number } | undefined => colors(getComputedStyle(el).color)[0]

/** Barra ou painel flutuante → um botão de dentro. */
const FLOATING: Array<[name: string, html: string]> = [
  ['pílula do canto', '<div class="top-left"><div class="glass-pill" data-box><button type="button" class="glass-btn" data-btn></button></div></div>'],
  ['dock', '<div class="dock" data-box><button class="dock-btn" data-btn></button></div>'],
  ['menu do dock', '<div class="dock-menu" data-box><button data-btn></button></div>'],
  ['barra contextual', '<div class="contextual-row"><div class="glass-bar" data-box><button class="glass-btn" data-btn></button></div></div>'],
  ['barra de zoom', '<div class="zoombar" data-box><button class="bar-btn" data-btn></button></div>'],
  ['porcentagem do zoom', '<div class="zoombar" data-box><button class="zoom-pct" data-btn></button></div>'],
  ['anéis de uso', '<div class="zoombar" data-box><button class="usage-rings" data-btn></button></div>'],
  ['indicador de andar', '<div class="floor-indicator"><button class="floor-indicator-button" data-box data-btn></button></div>'],
  ['minimapa', '<div class="minimap" data-box></div>'],
  ['barra de desenho', '<div class="draw-toolbar" data-box><button class="draw-btn" data-btn></button></div>'],
  ['popover de desenho', '<div class="draw-pop" data-box><button class="draw-row" data-btn></button></div>'],
  ['menu do topo', '<div class="top-menu" data-box><button data-btn></button></div>'],
  ['popover de conexões', '<div class="conn-pop" data-box><button class="conn-go" data-btn></button></div>'],
  ['popover da corda', '<div class="rope-popover" data-box><button class="rope-cut" data-btn></button></div>'],
  ['painel de uso', '<aside class="usage-panel" data-box></aside>'],
  ['mini barra lateral', '<div class="rail" data-box><button class="rail-item" data-btn></button></div>'],
  ['botão + da mini barra', '<div class="rail" data-box><button class="rail-plus" data-btn></button></div>'],
  ['botão redondo do topo', '<div class="round-holder" data-box><button class="round-btn" data-btn></button></div>'],
  ['compositor', '<div class="composer"><div class="composer-row" data-box></div></div>'],
  ['dica de modo', '<div class="mode-hint" data-box></div>']
]
let style: HTMLStyleElement
beforeEach(() => { style = document.createElement('style'); style.textContent = CSS; document.head.append(style) })
afterEach(() => { style.remove(); document.body.replaceChildren(); delete document.documentElement.dataset.appearance })
const mount = (appearance: 'light' | 'dark', html: string): { box: Element; button: Element | null } => {
  document.documentElement.dataset.appearance = appearance
  document.body.innerHTML = `<div class="canvas-area">${html}</div>`
  return { box: document.querySelector('[data-box]')!, button: document.querySelector('[data-btn]') }
}

describe('tema claro', () => {
  it.each(FLOATING)('%s: fundo claro', (_name, html) => {
    const solid = background(mount('light', html).box).filter((c) => c.a >= 0.4)
    expect(solid.length).toBeGreaterThan(0)
    for (const c of solid) expect(c.l).toBeGreaterThan(0.75)
  })
  it.each(FLOATING.filter(([, html]) => html.includes('data-btn')))('%s: botão com texto escuro e sem bloco próprio', (_name, html) => {
    const { box, button } = mount('light', html)
    const color = text(button!)!
    expect(color.l).toBeLessThan(0.45)
    // O botão em repouso não pinta um bloco por cima da barra (no máximo um tom leve; o indicador de andar é a própria barra).
    if (button !== box) expect(background(button!).filter((c) => c.a >= 0.5)).toEqual([])
  })
  it('o botão ativo continua destacado', () => {
    const { button } = mount('light', '<div class="dock"><button class="dock-btn active" data-btn></button></div><div data-box></div>')
    expect(background(button!).some((c) => c.a > 0.05)).toBe(true)
  })
})
describe('tema claro: selo de conexões', () => {
  it('continua azul com o número branco', () => {
    const { button } = mount('light', '<div class="glass-bar" data-box><button class="conn-badge" data-btn></button></div>')
    expect(background(button!).some((c) => c.a === 1 && c.l < 0.6)).toBe(true)
    expect(text(button!)!.l).toBeGreaterThan(0.9)
  })
})
describe('tema escuro', () => {
  it.each(FLOATING)('%s: continua escuro', (_name, html) => {
    for (const c of background(mount('dark', html).box).filter((c) => c.a >= 0.4)) expect(c.l).toBeLessThan(0.35)
  })
})
