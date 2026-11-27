import { PortalManager, type WebContentsLike } from '../../src/main/portal/portal-manager'
it('popups inherit parent reachability, keep the actual guest and disappear when closed',async()=>{
 const wc={isDestroyed:()=>false,executeJavaScript:vi.fn(async()=> 'popup actual'),close:vi.fn()}
 const manager=new PortalManager({fromId:()=>wc as unknown as WebContentsLike,writeFile:()=>{},nameOf:id=>id==='parent'?'Docs':undefined})
 manager.register('parent',7)
 const id=manager.registerPopup(7,8)
 expect(manager.popups()).toEqual([{id,parentId:'parent',name:'[Docs] #2'}])
 expect(await manager.text(id)).toBe('popup actual')
 manager.closePopup(id);expect(wc.close).toHaveBeenCalledOnce();expect(manager.popups()).toEqual([])
})
it('can register before parent dom-ready, resolves nested popups and cleans descendants',()=>{
 const manager=new PortalManager({fromId:()=>({isDestroyed:()=>false,close:vi.fn()}) as unknown as WebContentsLike,writeFile:()=>{}})
 const id=manager.registerPopup(7,8);expect(manager.popups()).toEqual([])
 manager.register('parent',7);const nested=manager.registerPopup(8,9)
 expect(manager.popups().map(p=>p.parentId)).toEqual(['parent','parent'])
 manager.unregister('parent');expect(manager.popups()).toEqual([])
 expect(()=>manager.closePopup(nested)).not.toThrow();expect(()=>manager.closePopup(id)).not.toThrow()
})
it('nested popup names do not collide with siblings and destroying contents cleans logs',async()=>{
 const wc={isDestroyed:()=>false,on:vi.fn(),removeListener:vi.fn(),close:vi.fn()}
 const manager=new PortalManager({fromId:()=>wc as unknown as WebContentsLike,writeFile:()=>{}})
 manager.register('root',1);const a=manager.registerPopup(1,2);manager.registerPopup(2,3);manager.registerPopup(1,4)
 expect(new Set(manager.popups().map(p=>p.name)).size).toBe(3)
 await manager.action(a,'logs-start',[]);manager.unregisterContents(1)
 expect(manager.popups()).toEqual([]);expect(wc.removeListener).toHaveBeenCalledOnce()
 manager.dispose()
})
it('popup policy isolates guest windows and rejects active URL schemes',async()=>{
 const {popupWindowPolicy}=await import('../../src/main/portal/popup-policy')
 for(const url of ['javascript:alert(1)','data:text/html,x','ftp://example.com'])expect(popupWindowPolicy(url)).toEqual({action:'deny'})
 const policy=popupWindowPolicy('https://example.com')
 expect(policy.action).toBe('allow')
 if(policy.action==='allow')expect(policy.overrideBrowserWindowOptions.webPreferences).toMatchObject({nodeIntegration:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,preload:undefined})
})
