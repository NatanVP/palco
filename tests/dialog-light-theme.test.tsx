// @vitest-environment happy-dom
// no tema claro os diálogos, folhas, menus e campos são claros e legíveis (calculado com as folhas reais).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(join(process.cwd(), 'src/renderer/src', p), 'utf8').replace(/^@import.*$/gm, '')
// Na ordem em que o app as junta: a base primeiro.
const CSS = ['styles.css', 'settings/settings.css', 'composer/composer.css', 'partituras/partituras.css'].map(read).join('\n')

type Rgba = [number, number, number, number]
/** A primeira cor do valor computado (`#hex`, `rgb()` ou `color-mix(… transparent)`). */
function color(value: string): Rgba | undefined {
  const mix = /color-mix\(in srgb, (#[0-9a-f]+) (\d+)%, transparent\)/i.exec(value)
  if (mix) { const c = color(mix[1]!)!; return [c[0], c[1], c[2], c[3] * Number(mix[2]) / 100] }
  const hex = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/i.exec(value)?.[1]
  if (hex) {
    const [r, g, b, a = 255] = (hex.length < 6 ? [...hex].map((c) => c + c).join('') : hex).match(/../g)!.map((x) => parseInt(x, 16))
    return [r!, g!, b!, a / 255]
  }
  const body = /rgba?\(([^()]+)\)/.exec(value)?.[1]
  if (body) { const [r, g, b, a = 1] = body.split(/[ ,/]+/).filter(Boolean).map(Number); return [r!, g!, b!, a] }
  return undefined
}
const own = (el: Element): Rgba | undefined => { const s = getComputedStyle(el); return color(s.background) ?? color(s.backgroundColor) }
const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as Rgba
/** O que se vê atrás do elemento: os fundos dele e dos pais, sobre o canvas. */
function backdrop(el: Element): Rgba {
  const chain: Element[] = []
  for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e)
  return chain.reduce<Rgba>((under, e) => { const c = own(e); return c ? over(c, under) : under }, [240, 241, 244, 1])
}
const luminance = (c: Rgba): number => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const ratio = (a: Rgba, b: Rgba): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const readability = (el: Element): number => { const fg = color(getComputedStyle(el).color)!, bg = backdrop(el); return ratio(over(fg, bg), bg) }

// data-surface: fundo claro · data-field: campo claro · data-text: legível (4,5) · data-accent: cor de destaque legível (3)
// data-plain: botão sem bloco próprio · data-seen: separador ou trilho visível
const SCENES: Array<[string, string]> = [
  ['novo e editar terminal', `<div class="modal-back nt-back"><div class="nt-sheet" data-surface><header class="nt-titlebar"><button class="nt-textbtn" data-accent data-plain>Cancelar</button><div class="nt-title"><strong data-text>Novo Terminal</strong><span class="nt-size" data-text>800×500</span></div><button class="nt-textbtn strong" data-accent data-plain>Criar</button></header>
    <div class="nt-quick"><span class="nt-caps" data-text>Início rápido</span><div class="nt-quick-grid"><button class="nt-tile" data-plain><span data-text>Codex</span></button><button class="nt-tile active"><span data-text>Claude</span></button></div></div>
    <div class="nt-tabs"><button class="nt-tab active" data-text data-surface>Detalhes</button><button class="nt-tab" data-text data-plain>Agente</button></div>
    <form class="nt-form"><label class="nt-field"><span class="nt-label" data-text>Nome</span><input class="nt-input" data-field></label>
    <div class="nt-row"><span class="nt-label" data-text>Executa em</span><select class="nt-select" data-field><option>Local</option></select></div>
    <div class="nt-dir"><input class="nt-input" data-field><button class="nt-browse" data-text data-seen>Procurar…</button></div>
    <div class="nt-toggle"><span class="nt-toggle-text"><span class="nt-label" data-text>Maestro</span><span class="nt-hint" data-text>explicação</span></span><button class="nt-switch" data-seen><span></span></button></div>
    <div class="nt-icons" data-surface><button class="nt-icon" data-plain data-text>★</button><input class="nt-emoji" data-field></div>
    <div class="nt-stepper"><button data-text data-seen>−</button><span data-text>13</span></div>
    <p class="nt-hint warn" data-text>aviso</p><div class="nt-error" data-text>erro</div>
    <div class="nt-roles" data-surface><button class="nt-role" data-plain><strong data-text>Revisor</strong><span data-text>texto</span></button></div>
    <div class="nt-ask" data-surface><p data-text>criar a pasta?</p></div></form></div></div>`],
  ['novo e editar portal', `<div class="modal-back nt-back"><div class="np-sheet" data-surface><h2 class="np-title" data-text>Novo Portal</h2><div class="np-ua-row"><select class="nt-input np-select" data-field><option>Padrão</option></select></div><div class="np-info-pop" data-surface><p data-text>sobre</p><p class="np-warn" data-text>cuidado</p></div></div></div>`],
  ['editar portal (modal) e renomear', `<div class="modal-back"><form class="modal" data-surface><label><span data-text>Endereço</span><input data-field></label><p class="modal-text" data-text>texto</p></form></div><input class="rename" data-field>`],
  ['barra do portal e avisos', `<div class="node"><div class="portal-bar"><input data-field></div><div class="portal-problem" data-text>falhou</div></div><div class="warning" data-text>aviso do app</div><span class="file-flag" data-text>grande</span>`],
  ['menu da barra lateral', `<div class="ctx-back"><div class="ctx-menu" data-surface><button data-text data-plain>Renomear</button><button class="danger" data-accent data-plain>Excluir</button></div></div>`],
  ['menu do canvas', `<div class="cmenu-menu" data-surface><button class="cmenu-item" data-text data-plain>Colar</button><div class="cmenu-sep" data-seen></div><button class="cmenu-item danger" data-accent data-plain>Apagar</button></div>`],
  ['novo espaço', `<div class="space-bar"><div class="space-pop" data-surface><h2 data-text>Novo espaço</h2><input class="nt-input small" data-field><button class="space-delete" data-accent data-plain>Apagar</button></div></div>`],
  ['busca', `<div class="modal-back"><div class="modal batuta" data-surface><input data-field><ul><li class="active"><span class="batuta-kind" data-text>Elemento</span><span class="batuta-label" data-text>Alfa</span></li></ul></div></div>`],
  ['confirmações dentro do nó', `<div class="node"><div class="chat-face"><div class="chat-confirm"><p data-text>Limpar o tópico?</p><div><button data-text>Cancelar</button><button class="danger" data-accent>Limpar</button></div></div></div></div><div class="node"><div class="tree-confirm"><p data-text>Mover para a lixeira?</p></div></div>`],
  ['terminal encerrado e arquivo', `<div class="node"><div class="terminal-exited" data-text>encerrado</div></div><div class="filebox" data-surface><div class="file-bar" data-text>a.txt</div><pre class="file-text" data-text>conteúdo</pre></div>`],
  ['painel de partituras', `<section class="partitura-panel" data-surface><header><button data-plain data-text>×</button></header><strong data-text>Nenhuma</strong></section>`],
  ['confirmação perigosa', `<div class="modal-back"><div class="modal" data-surface><div class="modal-actions"><button class="danger" data-accent>Remover</button></div></div></div>`]
]

let style: HTMLStyleElement
beforeEach(() => { style = document.createElement('style'); style.textContent = CSS; document.head.append(style) })
afterEach(() => { style.remove(); document.body.replaceChildren(); delete document.documentElement.dataset.appearance })
const mount = (appearance: 'light' | 'dark', html: string): void => { document.documentElement.dataset.appearance = appearance; document.body.innerHTML = html }
const all = (attr: string): Element[] => [...document.querySelectorAll(`[${attr}]`)]
const name = (el: Element): string => `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''} "${el.textContent?.trim().slice(0, 20)}"`

describe('tema claro', () => {
  it.each(SCENES)('%s', (_name, html) => {
    mount('light', html)
    const problems: string[] = []
    for (const el of all('data-surface')) if (luminance(backdrop(el)) < 0.7) problems.push(`fundo escuro: ${name(el)}`)
    for (const el of all('data-field')) {
      if (luminance(backdrop(el)) < 0.75) problems.push(`campo escuro: ${name(el)}`)
      if (readability(el) < 4.5) problems.push(`texto do campo ${readability(el).toFixed(2)}: ${name(el)}`)
    }
    for (const [attr, min] of [['data-text', 4.5], ['data-accent', 3]] as const) for (const el of all(attr)) if (readability(el) < min) problems.push(`contraste ${readability(el).toFixed(2)}: ${name(el)}`)
    for (const el of all('data-plain')) if ((own(el)?.[3] ?? 0) > 0.05) problems.push(`bloco no botão: ${name(el)}`)
    for (const el of all('data-seen')) {
      const behind = backdrop(el.parentElement!), self = backdrop(el), border = color(getComputedStyle(el).border) ?? color(getComputedStyle(el).borderColor)
      if (ratio(self, behind) < 1.15 && !(border && ratio(over(border, behind), behind) >= 1.15)) problems.push(`não se vê: ${name(el)}`)
    }
    expect(problems).toEqual([])
  })
})
describe('tema claro: véus', () => {
  it.each(['modal-back', 'floor-stage-scrim'])('.%s escurece pouco o canvas', (name) => {
    mount('light', `<div class="${name}"></div>`)
    expect(own(document.querySelector(`.${name}`)!)![3]).toBeLessThan(0.35)
  })
})
describe('tema escuro continua escuro', () => {
  it.each(SCENES.filter(([, html]) => html.includes('data-surface')))('%s', (_name, html) => {
    mount('dark', html)
    // A aba ativa é um tom mais claro de propósito; as demais superfícies seguem escuras.
    for (const el of all('data-surface')) expect(luminance(backdrop(el)), name(el)).toBeLessThan(0.25)
  })
})
