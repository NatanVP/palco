// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {TerminalAccountPicker} from '../src/renderer/src/dialogs/TerminalAccountPicker'
import type {TerminalNode} from '../src/shared/model'
it('troca na edição permite adiar ou reiniciar, sem mudar o processo na seleção',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const assign=vi.fn(async()=>{});Object.assign(window,{palco:{accountSettings:{list:async()=>[{id:'a',name:'Teste',agent:'claude'}],assign}}})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>{root.render(<TerminalAccountPicker node={{id:'t',agent:'claude'} as TerminalNode}/>)});await act(async()=>{const s=host.querySelector('select')!;s.value='a';s.dispatchEvent(new Event('change',{bubbles:true}))});expect(assign).not.toHaveBeenCalled();await act(async()=>{([...document.querySelectorAll('button')].find(b=>b.textContent==='Na Próxima Inicialização') as HTMLElement).click()});expect(assign).toHaveBeenCalledWith('t','a',false)
 await act(async()=>{const s=host.querySelector('select')!;s.value='';s.dispatchEvent(new Event('change',{bubbles:true}))});await act(async()=>{([...document.querySelectorAll('button')].find(b=>b.textContent==='Reiniciar Agora') as HTMLElement).click()});expect(assign).toHaveBeenLastCalledWith('t',null,true)
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
