import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { BaseActions } from '../../src/main/server/base-actions'
import type { TerminalNode } from '../../src/shared/model'
it('base actions respect team reachability, stack membership and portal restrictions', () => {
 const dir=mkdtempSync(join(tmpdir(),'palco-base-')), store=new WorkspaceStore(join(dir,'ws.json'))
 try {
 const t=store.addNode({kind:'terminal',agent:'shell',command:'',cwd:'/tmp',name:'Me',floorId:null,pos:{x:0,y:0},size:{w:400,h:300}})
 const n=store.addNode({kind:'note',name:'N',content:'x',floorId:null,pos:{x:0,y:0},size:{w:300,h:200}})
 const p=store.addNode({kind:'portal',name:'P',url:'https://example.com',floorId:null,pos:{x:0,y:0},size:{w:400,h:300}})
 store.connect(t,n);store.connect(t,p)
 const actions=new BaseActions(store,store.get().nodes[t] as TerminalNode)
 actions.stack('N','Docs');const sid=(store.get().nodes[n] as {stackId?:string}).stackId!;expect(store.get().stackNames?.[sid]).toBe('Docs');expect(actions.stackName(sid)).toBe('Docs')
 expect(()=>actions.connect('Docs','P')).toThrow(/portal/)
 expect(()=>actions.arrange({target:'N',color:'bad'})).toThrow()
 actions.arrange({target:'N',name:'Renamed',color:'#88aaff'});expect(store.get().nodes[n]!.name).toBe('Renamed')
 actions.delete('Docs',true);expect(store.get().nodes[n]).toBeUndefined()
 expect(()=>actions.target('secret')).toThrow(/não encontrado/)
 } finally {store.dispose();rmSync(dir,{recursive:true,force:true})}
})
