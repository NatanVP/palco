import {afterEach,expect,it,vi}from'vitest'
import{mkdtempSync,mkdirSync,existsSync,rmSync}from'node:fs'
import{join}from'node:path'
import{tmpdir}from'node:os'
vi.mock('electron',()=>({dialog:{},shell:{}}))
import{attachData,dataArea}from'../src/main/ipc/data'
import{DataRoot}from'../src/main/data/data-root'
import{DataService}from'../src/main/data/data-service'
import type{IpcAreaContext}from'../src/main/ipc/area'
let dir:string;afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true})})
it('operação pendente mantém referência ao backend após limpar o IPC e valida antes de encerrar',()=>{
 dir=mkdtempSync(join(tmpdir(),'palco-data-ipc-'));const root=join(dir,'data');mkdirSync(root);const backend=new DataService({roots:new DataRoot(join(dir,'locator.json'),root),flush:()=>{},clearGlobal:async()=>{},signOutAll:async()=>[],workspaces:()=>[]}),registry={},channels=new Map<string,(...args:unknown[])=>unknown>()
 let operation:(()=>void|Promise<void>)|undefined;const restart=vi.fn((fn:()=>void|Promise<void>)=>{operation=fn})
 const off=attachData(registry,{data:backend,restart,reset:async()=>backend.reset()});dataArea({deps:{registry},handle:(c:string,fn:(...args:unknown[])=>unknown)=>channels.set(c,fn)}as unknown as IpcAreaContext)
 expect(()=>channels.get('palco:data:moveRoot')!(root)).toThrow();expect(restart).not.toHaveBeenCalled()
 channels.get('palco:data:moveRoot')!(join(dir,'next'));off();operation!();expect(existsSync(join(dir,'next/.palco-data-root'))).toBe(true)
})
