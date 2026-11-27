// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {AccountStore} from '../src/main/accounts/account-store'
import {UsageService} from '../src/main/usage/usage-service'
import {UsageSettings,AccountsSettings} from '../src/renderer/src/settings/tabs/accounts-usage'
import {adoptPreferences} from '../src/renderer/src/settings/preferences'
import {defaultPreferences} from '../src/shared/preferences'
vi.mock('../src/renderer/src/usage/UsagePanel',()=>({UsageRings:({color}:{color:string})=><span data-ring={color}/>}))
it('persiste cor por ID, rejeita cor inválida e herda dinamicamente por qualquer CLI',()=>{
 const dir=mkdtempSync(join(tmpdir(),'palco-color-'))
 try {
  const store=new AccountStore(join(dir,'accounts.json'))
  const accounts=(['claude','claude','codex','antigravity'] as const).map((agent,i)=>store.add({name:`Conta ${i}`,agent,configDir:join(dir,`${i}`)}))
  store.patch(accounts[0]!.id,{color:'#4285F4'})
  expect(()=>store.patch(accounts[1]!.id,{color:'red'})).toThrow()
  const loaded=new AccountStore(join(dir,'accounts.json'));expect(loaded.byId(accounts[0]!.id)?.color).toBe('#4285F4')
  let providerColor='#D97757'
  const service=new UsageService({accounts:loaded,runner:vi.fn(),now:Date.now,setTimeout,color:()=>providerColor})
  expect(service.snapshot().map(u=>u.color)).toEqual(['#4285F4','#D97757','#D97757','#D97757'])
  providerColor='#10A37F';expect(service.snapshot().map(u=>u.color)).toEqual(['#4285F4','#10A37F','#10A37F','#10A37F'])
  loaded.patch(accounts[0]!.id,{color:undefined});expect(service.snapshot()[0]!.color).toBe('#10A37F');service.dispose()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
it('escolhe a cor em Uso por conta e o cartão em Contas usa a escolha',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);adoptPreferences(defaultPreferences())
 const accounts=[{id:'a',name:'Pessoal',agent:'claude',mode:'cli',status:'connected',terminalCount:0,color:'#4285F4'},{id:'b',name:'Trabalho',agent:'claude',mode:'cli',status:'connected',terminalCount:0}]
 const setColor=vi.fn(async(id:string,color:string)=>{Object.assign(accounts.find(a=>a.id===id)!,{color})})
 Object.assign(window,{palco:{accountSettings:{list:async()=>accounts,setColor,secureStorage:async()=>true,terminals:async()=>[],check:async(id:string)=>accounts.find(a=>a.id===id)},providers:{list:async()=>[{id:'claude',name:'Claude Code',enabled:true,color:'#D97757',state:'bundled',spec:{agent:'claude'},executablePath:'/test/claude'}]},usage:{get:async()=>[],onChange:()=>()=>{},setVisible:async()=>{}}}})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>{root.render(<UsageSettings/>);await new Promise(r=>setTimeout(r,0))})
  await act(async()=>{(host.querySelector('[aria-label="Cor de Trabalho"]') as HTMLElement).click()})
  await act(async()=>{(host.querySelector('[aria-label="Cor #BF5AF2"]') as HTMLElement).click()})
  expect(setColor).toHaveBeenCalledWith('b','#BF5AF2')
  await act(async()=>{(host.querySelector('[aria-label="Cor de Pessoal"]') as HTMLElement).click()})
  expect(host.querySelector('.provider-palette')?.contains(document.activeElement)).toBe(true)
  await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))})
  expect(host.querySelector('.provider-palette')).toBeNull()
  await act(async()=>{root.render(<AccountsSettings/>);await new Promise(r=>setTimeout(r,0))})
  expect([...host.querySelectorAll('[data-ring]')].map(e=>e.getAttribute('data-ring'))).toEqual(['#4285F4','#BF5AF2'])
  await act(async()=>{root.render(<UsageSettings/>);await new Promise(r=>setTimeout(r,0))})
  await act(async()=>{(host.querySelector('[aria-label="Cor de Trabalho"]') as HTMLElement).click()})
  await act(async()=>{(host.querySelector('.account-color-inherit') as HTMLElement).click()})
  expect(setColor).toHaveBeenLastCalledWith('b',null)
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
