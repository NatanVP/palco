// @vitest-environment happy-dom
import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,expect,it,vi } from 'vitest'
import { DataTab } from '../../src/renderer/src/settings/tabs/data'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let root:Root
afterEach(async()=>{await act(async()=>root?.unmount());document.body.replaceChildren()})
it('limpar portais e apagar dados exigem confirmação antes de chamar o backend',async()=>{
 const clearGlobal=vi.fn(async()=>{}),reset=vi.fn(async()=>{}),signOutAll=vi.fn(async()=>['Conta indisponível'])
 Object.assign(window,{palco:{dataSettings:{state:async()=>({root:'/tmp/fixture',snapshots:[],backupIntervalMinutes:60}),clearGlobal,reset,signOutAll}}})
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!
 await act(async()=>root.render(createElement(DataTab,{section:'Armazenamento dos Portais'})));await act(async()=>button('Apagar Armazenamento Global…').click());expect(clearGlobal).not.toHaveBeenCalled();await act(async()=>host.querySelector<HTMLButtonElement>('[role=alertdialog] .danger')!.click());expect(clearGlobal).toHaveBeenCalledOnce()
 await act(async()=>root.render(createElement(DataTab,{section:'Armazenamento'})));await act(async()=>button('Apagar Todos os Dados…').click());expect(reset).not.toHaveBeenCalled();await act(async()=>host.querySelector<HTMLButtonElement>('[role=alertdialog] .danger')!.click());expect(signOutAll).toHaveBeenCalledOnce();expect(reset).not.toHaveBeenCalled();expect(host.textContent).toContain('Conta indisponível');await act(async()=>button('Continuar').click());expect(reset).toHaveBeenCalledOnce()
})
it('Escape em confirmação de snapshot preserva o gerenciador por baixo',async()=>{
 Object.assign(window,{palco:{dataSettings:{state:async()=>({root:'/tmp/fixture',backupIntervalMinutes:60,snapshots:[{id:'w/one.zip',workspaceId:'w',workspaceName:'Projeto',createdAt:new Date().toISOString(),size:10}]})}}})
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(DataTab,{section:'Backups'})))
 const button=(s:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===s)!
 await act(async()=>button('Gerenciar Backups…').click());await act(async()=>button('Apagar').click());await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
 expect(host.querySelector('[role=dialog][aria-label="Gerenciar Backups"]')).not.toBeNull();expect(host.querySelector('[role=alertdialog]')).toBeNull()
})
