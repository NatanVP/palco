// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountsSettings } from '../src/renderer/src/settings/tabs/accounts-usage'
import { SETTINGS_TABS } from '../src/renderer/src/settings/catalog'
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
vi.mock('../src/renderer/src/usage/UsagePanel',()=>({UsageRings:()=> <span data-ring/>}))
const account = { id:'a', name:'Teste', agent:'claude', providerId:'claude', mode:'cli', status:'connected', terminalCount:0, email:'t***@example.test', plan:'Pro' }
const api = { list:vi.fn(async()=>[account]),secureStorage:vi.fn(async()=>true),terminals:vi.fn(async()=>[]),check:vi.fn(async()=>account),login:vi.fn(async()=>{}),rename:vi.fn(async()=>{}) }
beforeEach(()=>{ vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);Object.assign(window,{palco:{accountSettings:api,providers:{list:async()=>[{id:'claude',name:'Claude Code',enabled:true,color:'#D97757',state:'bundled',executablePath:'/test/claude',spec:{agent:'claude'}},{id:'codex',name:'Codex',enabled:true,color:'#10A37F',state:'bundled',executablePath:null,spec:{agent:'codex'}}],path:async()=>'/test/providers',showFolder:vi.fn()},usage:{get:async()=>[],onChange:()=>()=>{}}}}) })
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const open=async()=>act(async()=>{root.render(<AccountsSettings/>);await new Promise(r=>setTimeout(r,0))})
it('mostra CLIs em dois painéis e conta em cartão; ações ficam no menu',async()=>{await open();expect(host.querySelector('[aria-orientation="vertical"]')).toBeTruthy();expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Teste');expect(host.textContent).toContain('t***@example.test');expect(host.textContent).toContain('Pro');expect(host.textContent).not.toContain('Trocar a Conta de um Terminal');expect(host.querySelector('[role="menu"]')).toBeNull();await act(async()=>{(host.querySelector('[aria-label="Ações de Teste"]') as HTMLElement).click()});expect(host.querySelector('[role="menu"]')?.textContent).toContain('Verificar');expect(host.querySelector('[role="menu"]')?.textContent).toContain('Renomear');expect(host.textContent).toContain('Copiar Caminho')})
it('seleção por teclado mostra somente a CLI escolhida e não oferece adicionar para CLI ausente',async()=>{await open();await act(async()=>{host.querySelector('[aria-orientation="vertical"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))});expect(host.querySelector('[role="tabpanel"]')?.textContent).not.toContain('Teste');expect(host.textContent).toContain('Não instalado')})
it('não oferece a sub-aba Controle',()=>{expect(SETTINGS_TABS.find(t=>t.id==='agents')!.sections).not.toContain('Controle')})
it("menu recebe foco, navega com setas e Escape não fecha Configurações",async()=>{
 const {SettingsDialog}=await import('../src/renderer/src/settings/SettingsDialog');const close=vi.fn()
 await act(async()=>{root.render(<SettingsDialog at={{tab:'agents',section:'Contas'}} onClose={close}/>);await new Promise(r=>setTimeout(r,0))})
 await act(async()=>{(host.querySelector('[aria-label="Ações de Teste"]') as HTMLElement).click()})
 const menu=host.querySelector('[role=menu]')!;expect(menu.contains(document.activeElement)).toBe(true)
 const first=document.activeElement;await act(async()=>{first!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))});expect(document.activeElement).not.toBe(first)
 await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))});expect(close).not.toHaveBeenCalled();expect(host.querySelector('[role=menu]')).toBeNull()
})
