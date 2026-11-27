// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { ContextualBar } from '../src/renderer/src/canvas/ContextualBar'
import { Composer } from '../src/renderer/src/composer/Composer'
import { composerMode, cycleComposer, setComposerMode } from '../src/renderer/src/composer/composer-mode'
import type { TerminalNode, Workspace } from '../src/shared/model'

const animate = Element.prototype.animate
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true, writable: true }) })
afterAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true }) })

it('botão do terminal abre a mesma HUD e percorre o mesmo ciclo do atalho', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const node: TerminalNode = { id: 't5', kind: 'terminal', name: 'Agente', agent: 'claude', command: 'claude', cwd: '/tmp', floorId: null, pos: { x: 0, y: 0 }, size: { w: 600, h: 300 } }
  const ws: Workspace = { id: 'w', name: 'W', nodes: { t5: node }, connections: [], floors: {}, activeFloor: null, camera: { zoom: 1, offset: { x: 0, y: 0 } } }
  Object.assign(window, { palco: { workspace: { get: async () => ws, onChange: () => () => {} }, workspaces: { sidebar: async () => ({ workspaces: [] }) }, chat: { state: async () => new Promise(() => {}), onChange: () => () => {} } } })
  setComposerMode(node.id, 'off')
  try {
    await act(async () => root.render(<><Composer node={node} /><ContextualBar ws={ws} selection={new Set([node.id])} linkFrom={null} onLink={vi.fn()} onEdit={vi.fn()} onCreateBand={vi.fn()} onFocus={vi.fn()} onCleared={vi.fn()} onError={vi.fn()} modeHint={null} /></>))
    const button = () => host.querySelector<HTMLButtonElement>('[aria-label="Prompter"]')!
    expect(button()).toBeTruthy(); expect(button().disabled).toBe(false)
    await act(async () => button().click())
    expect(composerMode(node.id)).toBe('overlay'); expect(host.querySelector('.composer.overlay')).toBeTruthy()
    expect(document.activeElement).toBe(host.querySelector('[data-composer-editor]')); expect(button().getAttribute('aria-pressed')).toBe('true')
    await act(async () => { cycleComposer(node.id) })
    expect(composerMode(node.id)).toBe('below')
    await act(async () => button().click())
    expect(composerMode(node.id)).toBe('off'); expect(host.querySelector('.composer')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); setComposerMode(node.id, 'off'); vi.unstubAllGlobals() }
})
