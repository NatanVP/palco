// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RAIL_INSET, railInset, railMove, railItems } from '../../src/renderer/src/sidebar/sidebar-layout'
import { WorkspaceRail } from '../../src/renderer/src/sidebar/WorkspaceRail'
import { ChatService } from '../../src/main/chat/chat-service'
import { ChatStore } from '../../src/main/chat/chat-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Sidebar } from '../../src/shared/model'

vi.mock('motion/react', () => ({ AnimatePresence: ({ children }: { children: unknown }) => children, motion: { div: (p: Record<string, unknown>) => createElement('div', { className: p.className as string }, p.children as never) }, useReducedMotion: () => true }))
const sb = (over: Partial<Sidebar> = {}): Sidebar => ({ pages: [{ id: 'inicio', name: 'Início', icon: 'home' }], activePage: 'inicio', spaces: [{ id: 'g1', name: 'Grupo', expanded: true } as never], order: ['a', 'b', 'c', 'd'], active: 'a',
  workspaces: [{ id: 'a', name: 'Alfa', spaceId: null, terminals: 2 }, { id: 'b', name: 'Beta', spaceId: null, terminals: 0, locked: true }, { id: 'c', name: 'Gama', spaceId: 'g1', terminals: 1 }, { id: 'd', name: 'Delta', spaceId: 'g1', terminals: 0 }], ...over } as Sidebar)
describe('inset e reordenação', () => {
  it('62 px quando o trilho aparece, 0 quando não', () => { expect(RAIL_INSET).toBe(62); expect(railInset({ hidden: true, rail: true })).toBe(62); expect(railInset({ hidden: false, rail: true })).toBe(0); expect(railInset({ hidden: true, rail: false })).toBe(0) })
  it('Alt+seta move um passo dentro do mesmo grupo; nas pontas não faz nada', () => {
    const s = sb()
    expect(railMove(s, 'a', 1)).toEqual({ spaceId: null, index: 1 }); expect(railMove(s, 'b', -1)).toEqual({ spaceId: null, index: 0 })
    expect(railMove(s, 'a', -1)).toBeNull(); expect(railMove(s, 'b', 1)).toBeNull()
    expect(railMove(s, 'c', 1)).toEqual({ spaceId: 'g1', index: 1 }); expect(railMove(s, 'd', 1)).toBeNull(); expect(railMove(s, 'zz', 1)).toBeNull()
  })
  it('os itens do trilho trazem cadeado e atenção', () => {
    const items = railItems(sb(), { a: 3 }); expect(items.find(i => i.id === 'b')?.locked).toBe(true); expect(items.find(i => i.id === 'a')?.attention).toBe(3); expect(items.find(i => i.id === 'c')?.attention).toBe(0)
  })
})

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.assign(window, { palco: { workspaces: { loadIcon: async () => null, onIconChanged: () => () => {} } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.querySelectorAll('.rail-menu, .rail-pop').forEach(e => e.remove()); vi.unstubAllGlobals() })
const mount = async (over: Record<string, unknown> = {}) => {
  const p = { sidebar: sb(), show: true, attention: { a: 3 }, onSwitch: vi.fn(), onCreate: vi.fn(), onMove: vi.fn(), onMenu: vi.fn(), terminalsOf: vi.fn(async () => [{ id: 't1', name: 'Claude', agent: 'claude' as const }, { id: 't2', name: 'Shell', agent: 'shell' as const }]), onGoTo: vi.fn(), ...over }
  await act(async () => root.render(createElement(WorkspaceRail, p as never))); return p
}
const btn = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label^="${name}"]`)!
describe('WorkspaceRail', () => {
  it('selo de atenção com a contagem e cadeado no item travado', async () => {
    await mount(); expect(host.querySelector('[aria-label^="Alfa"] ~ .rail-attn, li:has([aria-label^="Alfa"]) .rail-attn')?.textContent).toBe('3'); expect(host.querySelector('li:has([aria-label^="Beta"]) .rail-lock')).toBeTruthy(); expect(host.querySelector('li:has([aria-label^="Gama"]) .rail-lock')).toBeNull()
  })
  it('botão direito pede o menu de contexto do item, no ponto do clique', async () => {
    const p = await mount(); await act(async () => btn('Beta').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 70, clientY: 120 })))
    expect(p.onMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), { x: 70, y: 120 })
  })
  it('segurar 350 ms abre a lista de terminais; clicar num leva até ele; soltar antes não abre; o clique depois do segurar não troca de workspace', async () => {
    const p = await mount(); const b = btn('Alfa')
    await act(async () => { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })) }); await act(async () => { await new Promise(r => setTimeout(r, 200)) }); await act(async () => { b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 400)) }); expect(document.body.querySelector('.rail-pop')).toBeNull()
    await act(async () => { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })) }); await act(async () => { await new Promise(r => setTimeout(r, 360)) })
    expect(p.terminalsOf).toHaveBeenCalledWith('a'); const pop = document.body.querySelector('.rail-pop')!; expect([...pop.querySelectorAll('button')].map(x => x.textContent)).toEqual(['Claude', 'Shell'])
    await act(async () => { b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); b.click() }); expect(p.onSwitch).not.toHaveBeenCalled()
    await act(async () => (pop.querySelector('button') as HTMLButtonElement).click()); expect(p.onGoTo).toHaveBeenCalledWith('a', 't1')
  })
  it('workspace sem terminais não abre a lista ao segurar', async () => {
    const p = await mount(); const b = btn('Delta'); await act(async () => { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })) }); await act(async () => { await new Promise(r => setTimeout(r, 400)) }); expect(p.terminalsOf).not.toHaveBeenCalled()
  })
  it('Alt+↓ e Alt+↑ reordenam; sem Alt a seta não faz nada', async () => {
    const p = await mount(); const k = (el: HTMLElement, key: string, altKey: boolean) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, altKey, bubbles: true, cancelable: true })) })
    await k(btn('Alfa'), 'ArrowDown', true); expect(p.onMove).toHaveBeenCalledWith('a', { spaceId: null, index: 1 }); await k(btn('Beta'), 'ArrowUp', true); expect(p.onMove).toHaveBeenLastCalledWith('b', { spaceId: null, index: 0 })
    p.onMove.mockClear(); await k(btn('Alfa'), 'ArrowDown', false); expect(p.onMove).not.toHaveBeenCalled()
  })
  it('o "+" pede o nome antes de criar; Esc cancela; vazio não cria', async () => {
    const p = await mount(); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Novo workspace"]')!.click())
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Nome do workspace"]')!; expect(input).toBeTruthy(); expect(p.onCreate).not.toHaveBeenCalled()
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }); expect(p.onCreate).not.toHaveBeenCalled()
    input.value = 'Meu projeto'; await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }); expect(p.onCreate).toHaveBeenCalledWith('Meu projeto')
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Novo workspace"]')!.click()); await act(async () => { host.querySelector('input[aria-label="Nome do workspace"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) }); expect(host.querySelector('input[aria-label="Nome do workspace"]')).toBeNull()
  })
})
describe('atenção vem do chat', () => {
  it('terminal com resposta não lida ou pedindo atenção entra na lista; lido ou ocioso não', async () => {
    const d = mkdtempSync(join(tmpdir(), 'palco-att-'))
    try {
      const svc = new ChatService({ store: new ChatStore(join(d, 'c')), home: d, deliver: () => {}, write: () => {}, isRunning: () => true, isAgent: () => true, onTerminalData: () => () => {}, now: () => 0, setTimer: () => 0, clearTimer: () => {}, settleMs: 1 })
      await svc.say('t1', { text: 'oi' }); expect(svc.attentionIds()).toEqual(['t1']); svc.markRead('t1'); expect(svc.attentionIds()).toEqual([])
      await svc.send('t2', { text: 'x', attachments: [] }); svc.turnEnded('t2'); expect(svc.attentionIds()).toEqual(['t2']); svc.acknowledgeAttention('t2'); expect(svc.attentionIds()).toEqual([])
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
