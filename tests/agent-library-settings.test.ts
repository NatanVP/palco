// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PromptsSettings, RolesSettings, SkillsSettings } from '../src/renderer/src/settings/tabs/agent-libraries'
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren() })
it('mostra bibliotecas reais, filtros e ações sem placeholders', async () => {
 const list = vi.fn(async () => ({ items: [{ id: 'r', name: 'Revisão', description: 'diff', workspaceId: null }], problems: [{ id: 'bad', reason: 'UTF-8 inválido' }] }))
 Object.assign(window, { palco: { workspaces: { sidebar: async () => ({ workspaces: [{ id: 'w', name: 'Projeto' }] }), onSidebar: () => () => {} }, prompts: { list, read: vi.fn(), showFolder: vi.fn() }, roles: { list: async () => [{ name: 'r', displayName: 'Revisor', text: 'Leia', workspaceId: null }] }, skills: { list: async () => [{ id: 'x', name: 'Codex', path: '/tmp/skills', enabled: true }] } } })
 const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
 await act(async () => root!.render(createElement(PromptsSettings))); expect(host.textContent).toContain('Revisão'); expect(host.textContent).toContain('UTF-8 inválido'); expect(host.querySelector('input[placeholder="Buscar prompts…"]')).not.toBeNull()
 await act(async () => root!.render(createElement(RolesSettings))); expect(host.textContent).toContain('Revisor'); expect(host.textContent).not.toContain('Descobrir Responsabilidades')
 await act(async () => root!.render(createElement(SkillsSettings))); expect(host.textContent).toContain('/tmp/skills'); expect(host.querySelector('[role="checkbox"]')?.hasAttribute('disabled')).toBe(false)
})
import { SettingsDialog } from '../src/renderer/src/settings/SettingsDialog'
it('editor é modal e Escape cancela só o editor, preservando Configurações', async () => {
 const close = vi.fn()
 Object.assign(window, { palco: { workspaces: { sidebar: async () => ({ workspaces: [] }), onSidebar: () => () => {} }, prompts: { list: async () => ({ items: [], problems: [] }) } } })
 const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
 await act(async () => root!.render(createElement(SettingsDialog, { onClose: close, at: { tab: 'agents', section: 'Prompts' } })))
 const add = [...host.querySelectorAll('button')].find(b => b.textContent === 'Novo prompt')!
 await act(async () => add.click()); expect(host.querySelector('[role="dialog"][aria-label="Novo prompt"]')).not.toBeNull()
 await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
 expect(close).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"][aria-label="Novo prompt"]')).toBeNull()
})
