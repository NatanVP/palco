import { describe, expect, it } from 'vitest'
import * as layout from '../src/renderer/src/sidebar/sidebar-layout'
import * as menu from '../src/renderer/src/canvas/top-menu'
import type { Sidebar } from '../src/shared/model'

describe('alternar a mini barra lateral', () => {
  const t = layout.toggleRail
  it('barra aberta: liga o modo mini e recolhe (vira o trilho)', () => {
    expect(t?.({ hidden: false, rail: false })).toEqual({ hidden: true, rail: true })
    expect(t?.({ hidden: false, rail: true })).toEqual({ hidden: true, rail: true })
  })
  it('barra recolhida: só inverte o modo mini (trilho ⇄ nada)', () => {
    expect(t?.({ hidden: true, rail: true })).toEqual({ hidden: true, rail: false })
    expect(t?.({ hidden: true, rail: false })).toEqual({ hidden: true, rail: true })
  })
  it('o trilho aparece só com a barra recolhida e o modo mini ligado; o item do menu marca nesse caso', () => {
    expect(layout.railVisible?.({ hidden: true, rail: true })).toBe(true)
    expect(layout.railVisible?.({ hidden: false, rail: true })).toBe(false)
    expect(layout.railVisible?.({ hidden: true, rail: false })).toBe(false)
  })
})

describe('persistência do modo mini', () => {
  const store = (): Storage => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage }
  it("lê e grava; vem ligado", () => {
    const s = store()
    expect(layout.readSidebarRail?.(s)).toBe(true)
    layout.writeSidebarRail?.(s, false)
    expect(layout.readSidebarRail?.(s)).toBe(false)
    expect(layout.SIDEBAR_RAIL_KEY).toBe('palco.miniSidebar')
  })
})

describe('itens do trilho', () => {
  const sb = {
    pages: [{ id: 'inicio', name: 'Início', icon: 'house' }, { id: 'p2', name: 'Outro', icon: 'star' }], activePage: 'inicio', spaces: [],
    workspaces: [
      { id: 'a', name: 'Loja', spaceId: null, icon: 'rocket', color: '#ff0000', terminals: 2 },
      { id: 'b', name: 'Fora', spaceId: null, pageId: 'p2', terminals: 0 },
      { id: 'c', name: 'Blog', spaceId: 'g1', terminals: 1 }
    ], order: ['c', 'a', 'b'], active: 'a'
  } as unknown as Sidebar
  it('só o Espaço ativo, na ordem da barra, com o ativo marcado', () => {
    expect(layout.railItems?.(sb)).toEqual([
      { id: 'c', name: 'Blog', icon: undefined, color: undefined, terminals: 1, active: false, locked: false, attention: 0 },
      { id: 'a', name: 'Loja', icon: 'rocket', color: '#ff0000', terminals: 2, active: true, locked: false, attention: 0 }
    ])
  })
  it('dica do item: nome e quantidade de terminais', () => {
    expect(layout.railHint?.('Loja', 2)).toEqual({ text: 'Loja', detail: '2 terminais' })
    expect(layout.railHint?.('Loja', 1)).toEqual({ text: 'Loja', detail: '1 terminal' })
    expect(layout.railHint?.('', 0)).toEqual({ text: 'Sem título', detail: null })
  })
})

describe('menu "…" da pílula do topo', () => {
  it('só três itens, nesta ordem: Configurações, Rotinas, Alternar Mini Barra Lateral', () => {
    expect(menu.TOP_MENU_ITEMS?.map((i) => i.label)).toEqual(['Configurações', 'Rotinas', 'Alternar Mini Barra Lateral'])
  })
  it('atalho no formato do palco: "Ctrl + ," (Linux/Windows) e "⌘ ," (macOS)', () => {
    expect(menu.menuShortcut?.({ key: ',', mod: true }, false)).toBe('Ctrl + ,')
    expect(menu.menuShortcut?.({ key: ',', mod: true }, true)).toBe('⌘ ,')
    expect(menu.menuShortcut?.({ key: 'p', mod: true, shift: true }, false)).toBe('Ctrl + Shift + P')
    expect(menu.menuShortcut?.(undefined, false)).toBe('')
  })
})
