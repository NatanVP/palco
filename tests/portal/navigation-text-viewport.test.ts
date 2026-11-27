import { PortalManager, type WebContentsLike } from '../../src/main/portal/portal-manager'
it('forward/info and element text use the existing isolated guest', async () => {
 const wc={isDestroyed:()=>false,getURL:()=> 'https://example.com',goForward:vi.fn(),executeJavaScript:vi.fn(async(_script:string)=>({ok:true,value:'text'}))}
 const manager=new PortalManager({fromId:()=>wc as unknown as WebContentsLike,writeFile:()=>{}});manager.register('p',1)
 expect(await manager.forward('p')).toBe('https://example.com');expect(wc.goForward).toHaveBeenCalledOnce()
 await manager.info('p');await manager.elementText('p','@e1')
 expect(wc.executeJavaScript).toHaveBeenCalledTimes(2)
 expect(wc.executeJavaScript.mock.calls[1]?.[0]).toContain('e1')
})
