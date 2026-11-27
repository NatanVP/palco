// @vitest-environment happy-dom
import { pageAction } from '../../src/main/portal/page-actions'
import { parsePortal } from '../../src/cli/portal-args'
it('parses all new portal arities without accepting extras', () => {
 for(const [verb,args] of Object.entries({type:['@e1','x'],key:['ctrl+a'],selectall:[],clear:[],hover:['@e1'],focus:['@e1'],select:['@e1','B'],check:['@e1'],uncheck:['@e1'],upload:['@e1','a','b'],scroll:['down','300','@e1'],scrollintoview:['@e1'],html:[],evaluate:['1+1'],'logs-start':[],logs:[],resize:['390','844'],ua:['ios']})) expect(parsePortal(['portal',verb,'P',...args]).action).toBe(verb)
})
it('uses refs, CSS and focused elements and dispatches form events', () => {
 document.body.innerHTML='<input data-palco-ref="e1" value="abc"><input type="checkbox" id="c"><select><option>A</option><option value="b">B</option></select>'
 const input=document.querySelector('input')!, events:string[]=[];input.addEventListener('input',()=>events.push('input'))
 pageAction(document,'focus','@e1');pageAction(document,'selectall','');expect(input.selectionEnd).toBe(3)
 pageAction(document,'clear','');expect(input.value).toBe('');expect(events).toEqual(['input'])
 pageAction(document,'select','select','B');expect(document.querySelector('select')!.value).toBe('b')
 pageAction(document,'check','#c');pageAction(document,'check','#c');expect(document.querySelector<HTMLInputElement>('#c')!.checked).toBe(true)
 pageAction(document,'uncheck','#c');expect(document.querySelector<HTMLInputElement>('#c')!.checked).toBe(false)
 expect(()=>pageAction(document,'focus','#missing')).toThrow(/encontrado/)
})
it('html and targeted scrolling run as serialized page code', () => {
 document.body.innerHTML='<div id="scroll"><button data-palco-ref="e9">B</button></div>'
 const box=document.querySelector<HTMLElement>('#scroll')!, button=document.querySelector('button')!
 box.style.overflowY='auto'
 Object.defineProperty(box,'scrollHeight',{value:1000,configurable:true});Object.defineProperty(box,'clientHeight',{value:100,configurable:true})
 const scrollBy=vi.fn(),scrollIntoView=vi.fn();box.scrollBy=scrollBy;button.scrollIntoView=scrollIntoView
 expect(String(pageAction(document,'html'))).toContain('data-palco-ref="e9"')
 const fn=new Function('document',`return (${pageAction.toString()})(document,'scroll','@e9','down',300)`)
 expect(fn(document)).toBe('ok');expect(scrollBy).toHaveBeenCalledWith({top:300,left:0})
 pageAction(document,'scrollintoview','@e9');expect(scrollIntoView).toHaveBeenCalled()
})
