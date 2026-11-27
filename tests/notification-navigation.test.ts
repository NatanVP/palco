// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { connectSystemNotifications } from '../src/renderer/src/settings/system-notifications'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'
describe('notificações globais', () => {
 it('atalhos navegam e abrem a lista; conclusão acompanha o nó sem editar canvas', async () => {
  adoptPreferences(defaultPreferences())
  const nextAttention = vi.fn().mockResolvedValue(null), focus = vi.fn().mockResolvedValue(undefined)
  Object.assign(window, { palco: { system: { snapshot: async () => ({ notices: [{ id: 'n', kind: 'turn', title: 'Pronto', body: 'Texto', terminalId: 't', timestamp: 1 }], badgeTerminalIds: ['t'], workingTerminalIds: [] }), onChange: () => () => {}, nextAttention, focus, dismiss: vi.fn() } } })
  const node = document.createElement('div'); node.dataset.nodeId = 't'; document.body.append(node)
  const off = connectSystemNotifications(); await new Promise(r => setTimeout(r, 40))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', ctrlKey: true, shiftKey: true, bubbles: true }))
  expect(nextAttention).toHaveBeenCalledOnce()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, altKey: true, bubbles: true }))
  await new Promise(r => setTimeout(r, 20)); expect(document.body.textContent).toContain('Pronto')
  off(); node.remove(); expect(document.querySelector('[aria-label="Notificações"]')).toBeNull()
 })
})

import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { useCompletionBadges } from '../src/renderer/src/settings/completion-badges'
describe('selo de turno concluído no card', () => {
 it('o hook entrega os terminais com selo e atualiza no evento, sem setInterval', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let push: (s: { notices: []; badgeTerminalIds: string[]; workingTerminalIds: [] }) => void = () => {}
  Object.assign(window, { palco: { system: { snapshot: async () => ({ notices: [], badgeTerminalIds: ['a'], workingTerminalIds: [] }), onChange: (cb: typeof push) => { push = cb; return () => {} } } } })
  const timers = vi.spyOn(window, 'setInterval')
  const seen: string[][] = []
  function Probe() { seen.push([...useCompletionBadges()].sort()); return null }
  const el = document.createElement('div'), root = createRoot(el)
  await act(async () => { root.render(createElement(Probe)) }); await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  expect(seen.at(-1)).toEqual(['a'])
  await act(async () => { push({ notices: [], badgeTerminalIds: ['a', 'b'], workingTerminalIds: [] }) }); expect(seen.at(-1)).toEqual(['a', 'b'])
  expect(timers).not.toHaveBeenCalled(); await act(async () => root.unmount())
 })
})
