// @vitest-environment happy-dom
import{act,createElement}from'react'
import{createRoot,type Root}from'react-dom/client'
import{afterEach,expect,it,vi}from'vitest'
import{AboutTab}from'../../src/renderer/src/settings/tabs/about'
import{GitSettings}from'../../src/renderer/src/settings/tabs/git'
import{connectOnboarding}from'../../src/renderer/src/settings/onboarding'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let root:Root;let off:(()=>void)|undefined
afterEach(async()=>{off?.();off=undefined;await act(async()=>root?.unmount());document.body.replaceChildren()})
it('Sobre gera prévia, baixa e reabre tour; sem contato público a seção some',async()=>{
 const saveReport=vi.fn(async()=>true),reopenOnboarding=vi.fn(async()=>{});Object.assign(window,{palco:{about:{info:async()=>({version:'0.1.0',contact:null,onboardingCompleted:true}),report:async()=>'Relatório seguro',saveReport,reopenOnboarding}}})
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(AboutTab)))
 const button=(s:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===s)!
 await act(async()=>button('Relatar um problema...').click());await act(async()=>button('Prévia...').click());expect(host.textContent).toContain('Relatório seguro');await act(async()=>button('Baixar...').click());expect(saveReport).toHaveBeenCalledOnce()
 await act(async()=>button('Fechar').click());await act(async()=>button('Mostrar Novamente').click());expect(reopenOnboarding).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('Contato')
})
it('Git restaura só depois de confirmar e encaminha o digest observado',async()=>{
 const restore=vi.fn(async()=>{});Object.assign(window,{palco:{gitHosts:{state:async()=>({directory:'/tmp/providers',missing:[],providers:[{id:'github',name:'GitHub',state:'modified',digest:'abc',command:'gh'}]}),restore}}})
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(GitSettings)))
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Restaurar Padrão…')!.click());expect(restore).not.toHaveBeenCalled();await act(async()=>host.querySelector<HTMLButtonElement>('[role=alertdialog] .danger')!.click());expect(restore).toHaveBeenCalledWith('github','abc')
})
it('onboarding tem consumidor independente do App e persiste Concluído',async()=>{
 const completeOnboarding=vi.fn(async()=>{});Object.assign(window,{palco:{about:{info:async()=>({onboardingCompleted:false}),onOnboarding:()=>()=>{},completeOnboarding}}})
 off=connectOnboarding();await new Promise(r=>setTimeout(r,0));expect(document.body.textContent).toContain('Bem-vindo ao palco');for(let n=0;n<2;n++)([...document.querySelectorAll('button')].find(b=>b.textContent==='Próximo')as HTMLButtonElement).click();([...document.querySelectorAll('button')].find(b=>b.textContent==='Concluído')as HTMLButtonElement).click();await new Promise(r=>setTimeout(r,0));expect(completeOnboarding).toHaveBeenCalledOnce();expect(document.querySelector('[aria-label="Boas-vindas ao palco"]')).toBeNull()
})
