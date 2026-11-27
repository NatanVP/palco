// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UsageSettings } from '../src/renderer/src/settings/tabs/accounts-usage'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'

vi.mock('../src/renderer/src/usage/UsagePanel', () => ({ UsageRings: ({ color, usage }: { color: string; usage: { accountId?: string } }) => <span data-ring={usage.accountId ?? ''} data-color={color} /> }))

const providers = [
  { id: 'claude', name: 'Claude Code', state: 'bundled', enabled: true, color: '#D97757', spec: { agent: 'claude' }, executablePath: '/bin/claude' },
  { id: 'codex', name: 'Codex', state: 'bundled', enabled: true, color: '#4285F4', spec: { agent: 'codex' }, executablePath: '/bin/codex' },
  { id: 'antigravity', name: 'Antigravity', state: 'bundled', enabled: false, color: '#BF5AF2', spec: { agent: 'antigravity', usage: 'antigravity' }, executablePath: null }
]
// A ordem de cadastro intercala os provedores de propósito: a lista tem de reagrupar.
const accounts = [
  { id: 'c1', agent: 'claude', providerId: 'claude', mode: 'cli', name: 'Claude 1', plan: 'Max' },
  { id: 'x1', agent: 'codex', mode: 'cli', name: 'Codex pessoal' },
  { id: 'c2', agent: 'claude', providerId: 'claude', mode: 'cli', name: 'Claude 2', color: '#10A37F' },
  { id: 'k1', agent: 'claude', providerId: 'claude', mode: 'apiKey', name: 'Chave' }
]
let host: HTMLDivElement, root: Root
const setColor = vi.fn(async () => {})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); setColor.mockClear()
  Object.assign(window, { palco: { accountSettings: { list: async () => accounts, setColor }, providers: { list: async () => providers }, usage: {
    get: async () => [{ accountId: 'c1', agent: 'claude', lastSuccessAt: new Date(Date.now() - 125000).toISOString() }, { accountId: 'c2', agent: 'claude', error: 'Claude 2: login expirado' }], onChange: () => () => {}, setVisible: async () => {} } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const open = () => act(async () => { root.render(<UsageSettings />); await new Promise((r) => setTimeout(r, 0)) })
const group = (id: string) => host.querySelector<HTMLElement>(`[data-usage-group="${id}"]`)!
const names = (g: Element) => [...g.querySelectorAll('.usage-account-row strong')].map((e) => e.textContent)

it('cada provedor é um grupo, com a linha dele primeiro e as contas dele aninhadas embaixo', async () => {
  await open()
  expect([...host.querySelectorAll('.usage-providers > *')].map((e) => e.getAttribute('data-usage-group'))).toEqual(['claude', 'codex', 'antigravity'])
  expect(names(group('claude'))).toEqual(['Claude 1', 'Claude 2'])
  expect(names(group('codex'))).toEqual(['Codex pessoal'])
  expect(group('claude').firstElementChild!.classList.contains('usage-provider-row')).toBe(true)
  expect(group('claude').querySelector('ul.usage-accounts')!.getAttribute('aria-label')).toBe('Contas de Claude Code')
  expect(group('antigravity').querySelector('ul')).toBeNull()
})
it('nada se repete: um cartão por provedor, uma linha por conta, e a conta não repete o nome do provedor', async () => {
  await open()
  expect(host.querySelectorAll('.usage-provider-row')).toHaveLength(3)
  expect(host.querySelectorAll('.usage-account-row')).toHaveLength(3)
  for (const row of host.querySelectorAll('.usage-account-row')) expect(row.textContent).not.toContain('Claude Code')
  expect(host.textContent).not.toContain('Chave')
})
it('cada conta tem o próprio anel e cor (a dela ou a do provedor) e mostra plano, leitura ou erro', async () => {
  await open()
  const [one, two] = [...group('claude').querySelectorAll('.usage-account-row')]
  expect(one!.querySelector('[data-ring]')!.getAttribute('data-ring')).toBe('c1')
  expect(one!.querySelector('[data-ring]')!.getAttribute('data-color')).toBe('#D97757')
  expect(two!.querySelector('[data-ring]')!.getAttribute('data-color')).toBe('#10A37F')
  expect(one!.querySelector('small')!.textContent).toBe('Max · Atualizada há 2 minutos')
  expect(two!.querySelector('small')!.textContent).toBe('Login expirado')
  expect(group('codex').querySelector('.usage-account-row small')!.textContent).toBe('Ainda sem leitura de uso')
  expect(two!.querySelector('[aria-label="Cor de Claude 2"]')).toBeTruthy()
})
it('o estado da leitura fica só na conta: o provedor com contas mostra quantas são, sem copiar o erro ou a hora de uma delas', async () => {
  await open()
  const line = (id: string) => group(id).querySelector('.usage-provider-row small')!.textContent
  expect(line('claude')).toBe('2 contas'); expect(line('codex')).toBe('1 conta'); expect(line('antigravity')).toBe('CLI não encontrada')
  expect(group('claude').querySelector('.usage-provider-row')!.textContent).not.toMatch(/login expirado|Atualizada/i)
})
