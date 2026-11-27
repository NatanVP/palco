// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
// Estes testes exercitam controles; a geometria dos anéis é coberta em tests/usage.
vi.mock('../../src/renderer/src/usage/UsagePanel',()=>({UsageRings:()=>null}))
import { AccountsSettings, UsageSettings } from '../../src/renderer/src/settings/tabs/accounts-usage'
import { adoptPreferences } from '../../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../../src/shared/preferences'
let root: Root; Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); adoptPreferences(defaultPreferences()) })
it('Sair exige ConfirmDialog, renomeação é disponível e API sem keyring explica o bloqueio', async () => {
 const usage={get:async()=>[],onChange:()=>()=>{}}
 const logout = vi.fn(async () => {})
 Object.assign(window,{palco:{usage,accountSettings:{list:async()=>[{id:'a',name:'Minha conta',agent:'claude',mode:'cli',status:'connected',terminalCount:2}],secureStorage:async()=>false,terminals:async()=>[],logout},providers:{list:async()=>[{id:'claude',name:'Claude Code',enabled:true,state:'bundled',color:'#123456',spec:{}}]}}})
 const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
 await act(async () => root.render(createElement(AccountsSettings)))
 const button = (s:string) => [...host.querySelectorAll('button')].find(b=>b.textContent===s)!
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Ações de Minha conta"]')!.click());
 expect(host.querySelector('[role=menu]')!.textContent).toContain('Renomear…');
 await act(async()=>button('Sair').click()); expect(logout).not.toHaveBeenCalled(); expect(host.querySelector('[role=alertdialog]')).not.toBeNull()
 await act(async()=>host.querySelector<HTMLButtonElement>('[role=alertdialog] .danger')!.click()); expect(logout).toHaveBeenCalledWith('a')
 await act(async()=>button('Adicionar Conta').click());expect(host.textContent).toContain('keyring');expect(host.querySelector<HTMLOptionElement>('option[value=apiKey]')!.disabled).toBe(true)
})
it('desativar Uso confirma antes de remover provedores',async()=>{
 const setUsageEnabled=vi.fn(async()=>{})
 Object.assign(window,{palco:{usage:{get:async()=>[],onChange:()=>()=>{}},accountSettings:{setUsageEnabled},providers:{list:async()=>[]}}}); const host=document.createElement('div');document.body.append(host);root=createRoot(host)
 await act(async()=>root.render(createElement(UsageSettings)))
 await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());expect(setUsageEnabled).not.toHaveBeenCalled();expect(host.textContent).toContain('Desativar o uso dos agentes?')
 await act(async()=>host.querySelector<HTMLButtonElement>('[role=alertdialog] .danger')!.click());expect(setUsageEnabled).toHaveBeenCalledWith(false)
})
