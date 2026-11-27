// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {UsageSettings} from '../src/renderer/src/settings/tabs/accounts-usage'
import {adoptPreferences} from '../src/renderer/src/settings/preferences'
import {defaultPreferences} from '../src/shared/preferences'
vi.mock('../src/renderer/src/usage/UsagePanel',()=>({UsageRings:()=> <span data-ring/>}))
let host:HTMLDivElement,root:ReturnType<typeof createRoot>
const configure=vi.fn(async()=>{}),refresh=vi.fn(async()=>[]),writeText=vi.fn(async()=>{})
const providers=[{id:'claude',name:'Claude Code',state:'bundled',enabled:true,color:'#D97757',spec:{agent:'claude'},executablePath:'/test/bin/claude'},{id:'codex',name:'Codex',state:'bundled',enabled:true,color:'#10A37F',spec:{agent:'codex'},executablePath:null}]
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();adoptPreferences(defaultPreferences());host=document.createElement('div');document.body.append(host);root=createRoot(host);Object.assign(window,{palco:{accountSettings:{list:async()=>[{id:'a',agent:'claude'}],setUsageEnabled:vi.fn(async()=>{})},providers:{list:async()=>providers,configure,path:async()=>'/test/usage-providers',showFolder:vi.fn()},usage:{get:async()=>[{accountId:'a',agent:'claude',lastSuccessAt:new Date(Date.now()-125000).toISOString(),session:{usedPercent:40}}],refresh,onChange:()=>()=>{},setVisible:vi.fn(async()=>{})}}});Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const open=async()=>act(async()=>{root.render(<UsageSettings/>);await new Promise(r=>setTimeout(r,0))})
it('cartão mostra telemetria real, caminho, selo e ausência da CLI; atualizar só consulta as contas do provedor',async()=>{await open();const rows=host.querySelectorAll('.usage-provider-row');expect(rows.length).toBe(2);expect(rows[0]!.textContent).toContain('há 2 minutos');expect(rows[0]!.textContent).toContain('/test/bin/claude');expect(rows[0]!.textContent).toContain('Integrado');expect(rows[1]!.textContent).toContain('CLI não encontrada');await act(async()=>{(rows[0]!.querySelector('button') as HTMLElement).click()});expect(refresh).toHaveBeenCalledWith('a');expect(host.textContent).not.toContain('Recarregar');expect(host.textContent).not.toContain('Restaurar Padrão')})
it('toggle e paleta gravam escolhas; rodapé copia caminho e atualiza tudo',async()=>{await open();await act(async()=>{(host.querySelector('.usage-provider-row [role=switch]') as HTMLElement).click()});expect(configure).toHaveBeenCalledWith('usage','claude',{enabled:false});await act(async()=>{(host.querySelector('[aria-label="Cor de Claude Code"]') as HTMLElement).click()});const color=host.querySelector('[aria-label="Cor #4285F4"]');expect(color).toBeTruthy();await act(async()=>{(color as HTMLElement).click()});expect(configure).toHaveBeenCalledWith('usage','claude',{color:'#4285F4'});await act(async()=>{([...host.querySelectorAll('button')].find(b=>b.textContent==='Copiar Caminho') as HTMLElement).click()});expect(writeText).toHaveBeenCalledWith('/test/usage-providers');await act(async()=>{([...host.querySelectorAll('button')].find(b=>b.textContent==='Atualizar Tudo') as HTMLElement).click()});expect(refresh).toHaveBeenLastCalledWith()})
it("seção de uso não herda classe do botão do painel",async()=>{await open();expect(host.querySelector('section')!.classList.contains('usage-settings')).toBe(false)})
it("paleta recebe foco e Escape fecha só a paleta dentro das Configurações",async()=>{
 const {SettingsDialog}=await import('../src/renderer/src/settings/SettingsDialog');const close=vi.fn()
 await act(async()=>{root.render(<SettingsDialog at={{tab:'agents',section:'Uso'}} onClose={close}/>);await new Promise(r=>setTimeout(r,0))})
 await act(async()=>{(host.querySelector('[aria-label="Cor de Claude Code"]') as HTMLElement).click()});expect(host.querySelector('.provider-palette')!.contains(document.activeElement)).toBe(true)
 await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))});expect(close).not.toHaveBeenCalled();expect(host.querySelector('.provider-palette')).toBeNull()
})
