import { PortalManager, type WebContentsLike } from '../../src/main/portal/portal-manager'
function setup() {
 const handlers=new Map<string,Function>();let attached=false
 const wc={isDestroyed:()=>false,executeJavaScript:vi.fn(async(script:string)=>script.includes('innerWidth')?JSON.stringify({width:400,height:300}):'ok'),insertText:vi.fn(async()=>{}),sendInputEvent:vi.fn(),reload:vi.fn(),getUserAgent:()=> 'original',setUserAgent:vi.fn(),on:vi.fn((name:string,fn:Function)=>{handlers.set(name,fn)}),removeListener:vi.fn(),debugger:{isAttached:()=>attached,attach:vi.fn(()=>{attached=true}),detach:vi.fn(()=>{attached=false}),sendCommand:vi.fn(async(method:string)=>method==='Runtime.evaluate'?{result:{objectId:'input'}}:{})}}
 const resizeNode=vi.fn(async()=>{}),manager=new PortalManager({fromId:()=>wc as unknown as WebContentsLike,writeFile:()=>{},resizeNode})
 manager.register('p',1);return {manager,wc,handlers,resizeNode}
}
it('key modifiers and type use guest input without shell interpolation',async()=>{
 const {manager,wc}=setup();await manager.action('p','key',['ctrl+shift+a']);await manager.action('p','type',['@e1','hello'])
 expect(wc.sendInputEvent.mock.calls.map(c=>c[0])).toEqual([{type:'keyDown',keyCode:'A',modifiers:['control','shift']},{type:'keyUp',keyCode:'A',modifiers:['control','shift']}])
 expect(wc.insertText).toHaveBeenCalledWith('hello');expect(wc.executeJavaScript.mock.calls[0]?.[0]).toContain('@e1')
 await expect(manager.action('p','key',['ctrl+invalid'])).rejects.toThrow(/tecla/)
})
it('logs subscribe once, drain, bound memory and clean up on unregister',async()=>{
 const {manager,wc,handlers}=setup();await manager.action('p','logs-start',[]);await manager.action('p','logs-start',[])
 handlers.get('console-message')!({message:'test',level:'info',lineNumber:2,sourceId:'x'})
 expect(await manager.action('p','logs',[])).toContain('test');expect(await manager.action('p','logs',[])).toBe('[]')
 expect(wc.on).toHaveBeenCalledTimes(1);manager.unregister('p');expect(wc.removeListener).toHaveBeenCalledTimes(1)
})
it('UA presets reload and desktop restores original; invalid preset leaves guest alone',async()=>{
 const {manager,wc}=setup();await manager.action('p','ua',['ios']);expect(wc.setUserAgent.mock.calls[0]?.[0]).toContain('iPhone')
 await manager.action('p','ua',['desktop']);expect(wc.setUserAgent).toHaveBeenLastCalledWith('original')
 await expect(manager.action('p','ua',['bad'])).rejects.toThrow(/preset/)
})
it('resize compensates measured viewport delta and validates dimensions',async()=>{
 const {manager,wc,resizeNode}=setup()
 wc.executeJavaScript.mockResolvedValueOnce(JSON.stringify({width:380,height:260})).mockResolvedValueOnce(JSON.stringify({width:390,height:844}))
 expect(await manager.action('p','resize',['390','844'])).toBe('viewport: 390x844')
 expect(resizeNode).toHaveBeenCalledWith('p',10,584)
 await expect(manager.action('p','resize',['NaN','20'])).rejects.toThrow(/tamanho/)
})
it('upload requires files and uses CDP without clicking, then detaches owned debugger',async()=>{
 const {manager,wc}=setup()
 await manager.action('p','upload',['@e1',__filename])
 expect(wc.debugger.sendCommand).toHaveBeenCalledWith('DOM.setFileInputFiles',{objectId:'input',files:[__filename]})
 expect(wc.debugger.detach).toHaveBeenCalledOnce()
 await expect(manager.action('p','upload',['@e1','/definitely/nonexistent'])).rejects.toThrow(/arquivo/)
})
it('borrowed debugger remains attached and upload errors still release owned attachment',async()=>{
 const {manager,wc}=setup();wc.debugger.isAttached=()=>true
 await manager.action('p','upload',['@e1',__filename]);expect(wc.debugger.attach).not.toHaveBeenCalled();expect(wc.debugger.detach).not.toHaveBeenCalled()
 const second=setup();second.wc.debugger.sendCommand.mockRejectedValueOnce(new Error('bad input'))
 await expect(second.manager.action('p','upload',['@e1',__filename])).rejects.toThrow('bad input')
 expect(second.wc.debugger.detach).toHaveBeenCalledOnce()
})
it('all UA presets are accepted; resize that never converges fails instead of claiming success',async()=>{
 const {manager}=setup()
 for(const preset of ['ios','android','chrome','firefox','desktop'])await expect(manager.action('p','ua',[preset])).resolves.toBe('ok')
 await expect(manager.action('p','resize',['390','844'])).rejects.toThrow(/não confirmou/)
})
