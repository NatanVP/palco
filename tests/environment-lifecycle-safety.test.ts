import{afterEach,expect,it,vi}from'vitest'
import{mkdtempSync,rmSync,writeFileSync,chmodSync,symlinkSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{TerminalManager}from'../src/main/pty/terminal-manager'
import{EnvironmentRuntime,type EnvironmentDeps,type Prepared}from'../src/main/environments/runtime'
import type{TerminalNode}from'../src/shared/model'
import{connectionEnvironment}from'../src/cli/session-connection'
const dirs:string[]=[];const temp=()=>{const d=mkdtempSync(join(tmpdir(),'palco-review-env-'));dirs.push(d);return d};afterEach(()=>{vi.useRealTimers();dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}))})
const node:TerminalNode={id:'t',kind:'terminal',floorId:null,name:'T',agent:'claude',command:'claude',cwd:'/srv/project',pos:{x:0,y:0},size:{w:400,h:300},environment:{kind:'ssh',host:'host',user:'user',port:22}}
const defaults=(dir:string,run:EnvironmentDeps['run']):EnvironmentDeps=>({settings:()=>({sshEnabled:true,dockerEnabled:true,sandboxEnabled:true,localTmuxEnabled:true,tunnelPort:7433,sshScriptPath:'~/.palco/bin/palco',sshAddToPath:true}),runDir:dir,run,which:p=>'/usr/bin/'+p,cliBundle:()=>null,tunnel:{listen:async()=>({ok:true})}})
const input=(n=node,token='test-token')=>({node:n,shell:'/bin/sh',env:{PALCO_TOKEN:token,PALCO_TERMINAL_ID:n.id,PALCO_NAME:n.name,PALCO_SOCKET:'/tmp/new.sock',PALCO_CLI:'/local/palco'},cwd:n.cwd,home:'/tmp'})
it("excluir durante prepare cancela a geração e limpa o resultado sem iniciar PTY",async()=>{
 let done!:(v:Prepared)=>void;const cleanup=vi.fn(),spawn=vi.fn();const tm=new TerminalManager({socketPath:'/tmp/s',palcoBin:'/local/palco',spawnPty:spawn as never,environments:{prepare:()=>new Promise(r=>{done=r})}})
 tm.spawn(node);tm.dispose(node.id);done({file:'ssh',args:[],cwd:'/tmp',env:{},cleanup});await new Promise(r=>setTimeout(r,0));expect(spawn).not.toHaveBeenCalled();expect(cleanup).toHaveBeenCalledOnce()
})
it("reanexar atualiza a ponte de credenciais, preserva o processo e não repete boot",async()=>{
 const dir=temp(),n={...node,environment:{kind:'tmux' as const}};let exists=false,bridge=''
 const rt=new EnvironmentRuntime(defaults(dir,async step=>{if(step.args.includes('has-session'))return{code:exists?0:1,out:''};if(step.args.includes('show-environment'))return{code:0,out:'PALCO_SESSION_FILE='+bridge};return{code:0,out:''}}))
 const first=await rt.prepare(input(n,'test-old'));if('error'in first)throw new Error(first.error);bridge=first.sessionFile!;expect(bridge).toBeTruthy();exists=true
 const second=await rt.prepare(input(n,'test-new'));if('error'in second)throw new Error(second.error);expect(second.reused).toBe(true);expect(second.args).toContain('attach-session');expect(connectionEnvironment({PALCO_SESSION_FILE:bridge,PALCO_TOKEN:'stale',PALCO_SOCKET:'/old'})).toMatchObject({token:'test-new',socket:'/tmp/new.sock'});await first.cleanup();expect(connectionEnvironment({PALCO_SESSION_FILE:bridge})).toMatchObject({token:'test-new'});await second.cleanup()
})
it("boot SSH usa o CLI do destino, sem caminho do checkout local",async()=>{
 vi.useFakeTimers();const writes:string[]=[],prepared:Array<{stdin?:string}>=[],rt=new EnvironmentRuntime(defaults(temp(),async step=>{prepared.push(step);return{code:0,out:''}}))
 const tm=new TerminalManager({socketPath:'/tmp/s',palcoBin:'/local/checkout/bin/palco',environments:rt,spawnPty:((_f: string,_a: string[],_o: unknown)=>({pid:123,write:(s:string)=>writes.push(s),onData:()=>{},onExit:()=>{},kill:()=>{},resize:()=>{}}))as never})
 tm.spawn(node);await vi.advanceTimersByTimeAsync(1000);expect(writes.join('')).not.toContain('/local/checkout');
 const settings=prepared.map(s=>s.stdin).find(s=>{try{return !!JSON.parse(s??'').hooks}catch{return false}})
 expect(JSON.parse(settings??'{}').hooks.Stop[0].hooks[0].command).toContain('$PALCO_CLI');expect(settings).not.toContain('/local/checkout');tm.dispose(node.id)
})
it("limpeza SSH remove o arquivo remoto mesmo se a segunda conexão não executar o script",async()=>{
 const calls:Array<{args:string[];stdin?:string}>=[],rt=new EnvironmentRuntime(defaults(temp(),async s=>{calls.push(s);return{code:0,out:''}}));const p=await rt.prepare(input());if('error'in p)throw new Error(p.error)
 await p.cleanup();expect(calls.some(s=>s.args.at(-1)?.includes('rm -f --'))).toBe(true)
})
it("anexar processo existente não digita o comando do agente novamente",async()=>{
 vi.useFakeTimers();const writes=vi.fn(),cleanup=vi.fn()
 const tm=new TerminalManager({socketPath:'/tmp/new',palcoBin:'/local/palco',environments:{prepare:async()=>({file:'tmux',args:['attach-session'],cwd:'/tmp',env:{},reused:true,cleanup})},spawnPty:(()=>({pid:123,write:writes,onData:()=>{},onExit:()=>{},kill:()=>{},resize:()=>{}}))as never})
 tm.spawn({...node,environment:{kind:'tmux'}});await vi.advanceTimersByTimeAsync(1000);expect(writes).not.toHaveBeenCalled();tm.dispose(node.id)
})
it("falha do PTY também limpa o arquivo remoto de partida",async()=>{
 const cleanup=vi.fn(),tm=new TerminalManager({socketPath:'/tmp/s',palcoBin:'/local/palco',environments:{prepare:async()=>({file:'ssh',args:[],cwd:'/tmp',env:{},cleanup})},spawnPty:(()=>{throw new Error('spawn failed')})as never})
 tm.spawn(node);await new Promise(r=>setTimeout(r,0));expect(cleanup).toHaveBeenCalledOnce()
})
it("conclusão da geração cancelada não apaga a nova preparação do mesmo nó",async()=>{
 const pending:Array<(p:Prepared)=>void>=[],cleanup=vi.fn(),spawn=vi.fn(()=>({pid:123,write:()=>{},onData:()=>{},onExit:()=>{},kill:()=>{},resize:()=>{}}))
 const tm=new TerminalManager({socketPath:'/tmp/s',palcoBin:'/local/palco',environments:{prepare:()=>new Promise(r=>pending.push(r))},spawnPty:spawn as never})
 const shell={...node,agent:'shell' as const};tm.spawn(shell);tm.dispose(shell.id);tm.spawn(shell)
 pending[0]!({file:'ssh',args:[],cwd:'/tmp',env:{},cleanup});await new Promise(r=>setTimeout(r,0));expect(spawn).not.toHaveBeenCalled();expect(cleanup).toHaveBeenCalledOnce()
 pending[1]!({file:'ssh',args:[],cwd:'/tmp',env:{},cleanup:()=>{}});await new Promise(r=>setTimeout(r,0));expect(spawn).toHaveBeenCalledOnce();tm.dispose(shell.id)
})
it("credencial da ponte nunca é lida por link nem por arquivo acessível a outros usuários",()=>{
 const dir=temp(),file=join(dir,'session'),link=join(dir,'link')
 const payload=JSON.stringify({version:1,socket:'/tmp/test.sock',token:'test-only'})
 writeFileSync(file,payload,{mode:0o644});expect(()=>connectionEnvironment({PALCO_SESSION_FILE:file})).toThrow(/Credencial/)
 chmodSync(file,0o600);symlinkSync(file,link);expect(()=>connectionEnvironment({PALCO_SESSION_FILE:link})).toThrow(/Credencial/)
 expect(connectionEnvironment({PALCO_SESSION_FILE:file})).toEqual({socket:'/tmp/test.sock',token:'test-only'})
})
