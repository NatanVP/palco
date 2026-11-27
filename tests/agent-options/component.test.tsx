// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentOptions } from '../../src/renderer/src/dialogs/AgentOptions'
import { setLocale } from '../../src/shared/i18n/runtime'
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); setLocale('pt-BR'); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLocale('pt-BR'); vi.unstubAllGlobals() })
function Form({ initial = 'claude', agent = 'claude' }: { initial?: string; agent?: 'claude' | 'codex' | 'shell' }) {
  const [command, setCommand] = useState(initial)
  return <><input aria-label="Comando" value={command} onChange={e => setCommand(e.target.value)} /><AgentOptions agent={agent} command={command} onChange={setCommand} /></>
}
const input = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
const type = async (label: string, value: string) => act(async () => { const el = input(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
const click = async (el: HTMLElement) => act(async () => el.click())
it('a seção começa recolhida, busca pelo nome e mantém o comando e interruptores sincronizados', async () => {
  await act(async () => root.render(<Form />))
  expect(host.querySelector('details')?.open).toBe(false)
  await click(host.querySelector('summary')!)
  await type('Buscar opção', 'verbose')
  expect(host.querySelectorAll('[role=switch]')).toHaveLength(1)
  await click(input('--verbose'))
  expect(input('Comando').value).toBe('claude --verbose')
  await type('Comando', 'claude --model sonnet')
  expect(input('--verbose').checked).toBe(false)
  await type('Buscar opção', 'model')
  expect(input('--model').checked).toBe(true)
  await click(input('--model'))
  expect(input('Comando').value).toBe('claude')
})
it('ligar uma opção de texto revela seu campo e protege os valores com aspas', async () => {
  await act(async () => root.render(<Form />))
  await click(input('--model'))
  await type('Valor de --model', 'modelo com espaço')
  expect(input('Comando').value).toBe("claude --model 'modelo com espaço'")
})
it('mostra escolhas completas, selo de perigo por valor e dica acessível', async () => {
  await act(async () => root.render(<Form agent="codex" initial="codex -s danger-full-access" />))
  expect(input('--sandbox').checked).toBe(true)
  expect(host.querySelector('[data-flag="--sandbox"]')?.textContent).toContain('Perigo')
  const choice = input('Valor de --sandbox') as unknown as HTMLSelectElement
  expect([...choice.options].map(o => o.value)).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
  await click(host.querySelector('[aria-label="Sobre --sandbox"]')!)
  const info = host.querySelector('[aria-label="Sobre --sandbox"]')!
  expect(info.getAttribute('aria-describedby')).toBe(host.querySelector('[role=tooltip]')?.id)
  expect(host.querySelector('[role=tooltip]')?.textContent).toContain('remove o isolamento')
})
it('usa o agente efetivo recebido, omite opções reservadas e não mostra catálogo para shell', async () => {
  await act(async () => root.render(<Form initial="meu-wrapper" agent="codex" />))
  expect(input('--sandbox')).toBeTruthy()
  expect(input('--settings')).toBeNull()
  expect(input('--config')).toBeNull()
  await act(async () => root.render(<Form agent="shell" />))
  expect(host.querySelector('details')).toBeNull()
})
it.each([['en', 'Command options'], ['es', 'Opciones del comando']] as const)('traduz a seção e as explicações para %s', async (locale, title) => {
  setLocale(locale)
  await act(async () => root.render(<Form />))
  expect(host.querySelector('summary')?.textContent).toBe(title)
  await click(host.querySelector('[aria-label="'+(locale==='en'?'About':'Acerca de')+' --verbose"]')!)
  expect(host.querySelector('[role=tooltip]')?.textContent).toBe(locale==='en'?'Show more detailed information during the session.':'Muestra información más detallada durante la sesión.')
})

it('mudar a escolha atualiza o comando e desligar esconde o campo', async () => {
  await act(async () => root.render(<Form initial="claude --effort=high" />))
  const select = input('Valor de --effort') as unknown as HTMLSelectElement
  expect(select.value).toBe('high')
  await act(async () => { select.value = 'max'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(input('Comando').value).toBe('claude --effort max')
  await click(input('--effort'))
  expect(input('Valor de --effort')).toBeNull()
})
