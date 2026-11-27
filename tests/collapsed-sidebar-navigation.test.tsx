// @vitest-environment happy-dom
// com a barra lateral recolhida, a pílula do workspace atual ao lado do menu e a coluna com workspaces e Espaços.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSidebarRail, SIDEBAR_RAIL_KEY, writeSidebarRail } from '../src/renderer/src/sidebar/sidebar-layout'
import { mountApp, type Harness } from './helpers/app-harness'
import type { Sidebar } from '../src/shared/model'

const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8').replace(/^@import.*$/gm, '')
const sidebar = {
  pages: [{ id: 'inicio', name: 'Espaços de Trabalho', icon: 'music' }, { id: 'p2', name: 'Clientes', icon: 'folder', color: '#ff0000' }], activePage: 'inicio', spaces: [],
  workspaces: [{ id: 'ws1', name: 'Códigos', spaceId: null, icon: 'folder', color: '#a855f7', terminals: 1 }, { id: 'outro', name: 'Outro', spaceId: null, pageId: 'p2', terminals: 0 }],
  order: ['ws1', 'outro'], active: 'ws1'
} as unknown as Sidebar

let app: Harness, style: HTMLStyleElement
const switchPage = vi.fn(async () => {})
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); switchPage.mockClear(); style = document.createElement('style'); style.textContent = css; document.head.append(style) })
afterEach(async () => { await app?.unmount(); style.remove(); vi.unstubAllGlobals() })
const open = async (hidden = true) => {
  localStorage.setItem('palco.sidebarHidden', hidden ? '1' : '0')
  app = await mountApp({ api: { 'workspaces.sidebar': async () => sidebar, 'pages.switch': switchPage as never, 'workspaces.loadIcon': async () => null, 'rail.attention': async () => ({}) } })
}
const click = (el: Element) => act(async () => { (el as HTMLElement).click() })
const pill = () => app.host.querySelector<HTMLButtonElement>('.top-left .ws-pill')
const rail = () => app.host.querySelector<HTMLElement>('nav.rail')
const toggleMini = async () => { await click(app.host.querySelector('[aria-label="Mais"]')!); await click([...app.host.querySelectorAll('[role=menuitemcheckbox]')].find((e) => e.textContent!.includes('Mini Barra'))!) }

describe('barra recolhida', () => {
  it('a mini barra vem ligada e a escolha é lembrada', () => {
    localStorage.clear()
    expect([SIDEBAR_RAIL_KEY, readSidebarRail(localStorage)]).toEqual(['palco.miniSidebar', true])
    writeSidebarRail(localStorage, false)
    expect(readSidebarRail(localStorage)).toBe(false)
  })

  it('mostra ao lado do menu a pílula do workspace atual, com o ícone dele na cor dele', async () => {
    await open()
    expect(pill()!.textContent).toBe('Códigos')
    const icon = pill()!.querySelector('svg')!
    expect(icon.classList.contains('lucide-folder')).toBe(true)
    expect(pill()!.querySelector('.ws-pill-icon')!.getAttribute('style')).toContain('#a855f7')
    // A pílula e o menu ficam no canto: o recuo da coluna não os empurra.
    app.host.querySelector<HTMLElement>('.app')!.style.setProperty('--rail-inset', '62px')
    expect(getComputedStyle(app.host.querySelector('.top-left')!).left).toBe('12px')
  })

  it('a coluna lista os workspaces do Espaço atual, um divisor e os Espaços, com o atual destacado', async () => {
    await open()
    const buttons = [...rail()!.querySelectorAll('.rail-list button')].map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-current')])
    expect(buttons).toEqual([['Códigos', 'true']])
    const pages = [...rail()!.querySelectorAll('.rail-pages button')].map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-current'), b.querySelector('svg')!.getAttribute('class')!.includes('lucide-music')])
    expect(pages).toEqual([['Espaço Espaços de Trabalho', 'true', true], ['Espaço Clientes', null, false]])
    expect([...rail()!.children].map((c) => c.className.split(' ')[0])).toEqual(['rail-list', 'rail-sep', 'rail-pages', 'rail-add'])
  })

  it('clicar num Espaço troca para ele; no atual, nada', async () => {
    await open()
    await click(rail()!.querySelector('[aria-label="Espaço Espaços de Trabalho"]')!)
    expect(switchPage).not.toHaveBeenCalled()
    await click(rail()!.querySelector('[aria-label="Espaço Clientes"]')!)
    expect(switchPage).toHaveBeenCalledWith('p2')
  })

  it.each(['dark', 'light'])('no tema %s os outros Espaços ficam apagados e menores que os workspaces', async (appearance) => {
    await open()
    document.documentElement.dataset.appearance = appearance
    const [current, other] = [...rail()!.querySelectorAll('.rail-pages button')].map((b) => getComputedStyle(b))
    expect(other!.color).not.toBe(current!.color)
    expect([other!.height, getComputedStyle(rail()!.querySelector('.rail-list button')!).height]).toEqual(['24px', '32px'])
    delete document.documentElement.dataset.appearance
  })

  it('o "+" continua na coluna, aparecendo ao passar o mouse ou focar', async () => {
    await open()
    expect(rail()!.querySelector('[aria-label="Novo workspace"]')).toBeTruthy()
    expect(getComputedStyle(rail()!.querySelector('.rail-add')!).opacity).toBe('0')
    expect(css).toMatch(/\.rail:hover \.rail-add, \.rail:focus-within \.rail-add \{[^}]*opacity: 1/)
  })

  it('desligar a mini barra esconde a coluna e mantém a pílula; a pílula abre a barra', async () => {
    await open()
    await toggleMini()
    expect([rail(), pill() !== null]).toEqual([null, true])
    await click(pill()!)
    expect([pill(), rail()]).toEqual([null, null])
  })

  it('com a barra aberta não há pílula nem coluna', async () => {
    await open(false)
    expect([pill(), rail()]).toEqual([null, null])
  })
})
