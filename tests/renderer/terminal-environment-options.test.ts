// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NewTerminalDialog } from '../../src/renderer/src/dialogs/NewTerminalDialog'
import { emptyForm, toNewNode } from '../../src/renderer/src/dialogs/new-terminal'
import { agentForCommand } from '../../src/shared/agent-command'
import { OPTIONS } from '../../src/renderer/src/settings/options'
import { SettingsDialog } from '../../src/renderer/src/settings/SettingsDialog'
import { adoptPreferences, getPreferences, suspendShortcuts } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, exists: ReturnType<typeof vi.fn>, onCreate: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); suspendShortcuts(false)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); exists = vi.fn(async () => true); onCreate = vi.fn(async () => null)
  Object.assign(window, { palco: { files: { exists, mkdir: vi.fn(), pick: vi.fn() }, presets: { list: async () => [], roles: async () => [], missingDefaults: async () => [] },
    preferences: { get: async () => getPreferences(), set: vi.fn(async p => { const n = { ...getPreferences(), ...p }; adoptPreferences(n); return n }), onChange: () => () => {}, bind: vi.fn(), resetShortcuts: vi.fn() },
    environments: { status: async () => ({ tmux: '/usr/bin/tmux', ssh: '/usr/bin/ssh', docker: null, sbx: null }) }, terminal: { countAboveMemory: async () => 0, resolveAgent: vi.fn(async command => ({ agent: agentForCommand(command) })) } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const open = async () => { await act(async () => root.render(createElement(NewTerminalDialog, { sizeLabel: null, onCancel: vi.fn(), onCreate: onCreate as never }))); await flush() }
const select = () => host.querySelector<HTMLSelectElement>('select[aria-label="Executa em"]')!
const agentSelect = () => host.querySelector<HTMLSelectElement>('select[aria-label="Tipo de agente"]')!
const pick = async (v: string) => { await act(async () => { select().value = v; select().dispatchEvent(new Event('change', { bubbles: true })) }); await flush() }
const typeInto = async (label: string, v: string) => { const el = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }); await flush() }
const typeCommand = async (v: string) => { const el = host.querySelectorAll<HTMLInputElement>('.nt-form input.nt-input')[1]!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }); await flush() }
const create = async () => { await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => /^Criar$/.test(b.textContent ?? ''))!.click()); await flush() }

it('as opções de Ambientes estão ativas (WSL fica só no Windows)', () => {
  for (const k of ['sshEnabled', 'sshScriptPath', 'sshAddToPath', 'dockerEnabled', 'sandboxEnabled', 'localTmuxEnabled', 'tunnelPort']) expect(OPTIONS.find(o => o.key === k)?.ready, k).toBe(true)
  const wsl = OPTIONS.find(o => o.key === 'wslEnabled')!; expect(wsl.ready).toBe(false); expect(wsl.pending).toMatch(/Windows/)
})
it('o tipo explícito vence a inferência automática no Novo Terminal', async () => {
  await open(); await typeCommand('clauded')
  await act(async () => { agentSelect().value = 'codex'; agentSelect().dispatchEvent(new Event('change', { bubbles: true })) })
  await create()
  expect(window.palco.terminal.resolveAgent).not.toHaveBeenCalled()
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex' }))
})
it('Tipo automático usa o agente detectado e preserva o aviso do wrapper', async () => {
  const resolveAgent = window.palco.terminal.resolveAgent as ReturnType<typeof vi.fn>
  resolveAgent.mockResolvedValueOnce({ agent: 'claude', warning: 'encaminhamento indisponível' })
  await open(); await typeCommand('clauded'); await create()
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', agentWarning: 'encaminhamento indisponível' }))
})
it('Executa em: Local sempre; os demais só com a opção ligada nas Configurações', async () => {
  await open(); const opts = () => [...select().options].map(o => `${o.value}:${o.disabled ? 'off' : 'on'}`)
  expect(opts()).toEqual(['local:on', 'tmux:off', 'ssh:off', 'docker:off', 'sandbox:off'])
  await act(async () => adoptPreferences({ ...getPreferences(), sshEnabled: true, localTmuxEnabled: true })); await flush()
  expect(opts()).toEqual(['local:on', 'tmux:on', 'ssh:on', 'docker:off', 'sandbox:off'])
})
it('SSH: pede host, usuário e porta, avisa que não guarda senha e cria o nó com o ambiente validado; não confere a pasta no disco local', async () => {
  adoptPreferences({ ...defaultPreferences(), sshEnabled: true }); await open(); await pick('ssh')
  expect(host.textContent).toContain('nenhuma senha é pedida nem guardada')
  { const el = host.querySelector<HTMLInputElement>('input[placeholder^="ex. ~/projeto"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '/srv/app'); el.dispatchEvent(new Event('input', { bubbles: true })) }); await flush() }
  await typeInto('Host', 'dev.example.com'); await typeInto('Usuário', 'ana'); await create()
  expect(exists).not.toHaveBeenCalled(); expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ environment: { kind: 'ssh', host: 'dev.example.com', user: 'ana', port: 22 } }))
})
it('SSH com host que parece opção ("-oProxyCommand=…") é recusado na tela e nada é criado', async () => {
  adoptPreferences({ ...defaultPreferences(), sshEnabled: true }); await open(); await pick('ssh'); await typeInto('Host', '-oProxyCommand=touch /tmp/x'); await typeInto('Usuário', 'ana'); await create()
  expect(onCreate).not.toHaveBeenCalled(); expect(host.textContent).toMatch(/host SSH inválido/)
})
it('Docker e Sandbox mostram os campos próprios', async () => {
  adoptPreferences({ ...defaultPreferences(), dockerEnabled: true, sandboxEnabled: true }); await open()
  await pick('docker'); expect(host.querySelector('[aria-label="Contêiner Docker"]')).toBeTruthy(); await typeInto('Contêiner', 'web-1'); await create()
  expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ environment: { kind: 'docker', context: '', container: 'web-1', user: '' } }))
  await pick('sandbox'); expect(host.querySelector('[aria-label="Docker Sandbox"]')).toBeTruthy()
})
it('toNewNode: ambiente local não grava campo; remoto grava normalizado; inválido derruba', () => {
  const frame = { pos: { x: 0, y: 0 }, size: { w: 500, h: 300 } }
  expect(toNewNode(emptyForm(), frame, null, [])).not.toHaveProperty('environment')
  expect(toNewNode({ ...emptyForm(), environment: { kind: 'tmux' } }, frame, null, [])).toMatchObject({ environment: { kind: 'tmux' } })
  expect(() => toNewNode({ ...emptyForm(), environment: { kind: 'ssh', host: '-x', user: 'u', port: 22 } }, frame, null, [])).toThrow()
})
it('Geral › Ambientes mostra o que existe nesta máquina', async () => {
  await act(async () => root.render(createElement(SettingsDialog, { onClose: vi.fn() }))); await flush()
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Ambientes')!.click()); await flush()
  const list = host.querySelector('[aria-label="Programas dos ambientes"]')!.textContent!
  expect(list).toContain('tmux: encontrado em /usr/bin/tmux'); expect(list).toContain('docker: não instalado')
})
