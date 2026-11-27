import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SessionStore} from '../src/main/system/sessions'
import {AccountStore} from '../src/main/accounts/account-store'
import {ProviderLibrary,ACCOUNT_PROVIDERS} from '../src/main/providers/provider-library'
import {AccountService} from '../src/main/accounts/account-service'
import {SecretVault} from '../src/main/accounts/secret-vault'
import {parseArgs} from '../src/cli/args'
import {createAgentRoutes} from '../src/main/agents/routes'
import {RoleStore} from '../src/main/agents/roles'
import {AgentCatalog,PresetStore} from '../src/main/agents/presets'
import {WorkspaceStore} from '../src/main/domain/workspace-store'
import type {TerminalNode} from '../src/shared/model'
import {queryAntigravityUsage} from '../src/main/usage/antigravity-usage'
const dirs:string[]=[];const temp=()=>{const d=mkdtempSync(join(tmpdir(),'palco-account-upgrade-'));dirs.push(d);return d}
afterEach(()=>{dirs.forEach(d=>rmSync(d,{recursive:true,force:true}));dirs.length=0})
it("outra conta, inclusive Padrão, inicia sessão nova; mesma conta pode retomar",()=>{
 const file=join(temp(),'sessions.json'),s=new SessionStore(file),node={id:'t',agent:'claude',command:'claude',cwd:'/tmp',accountId:'a'} as TerminalNode
 s.remember(node,'session-a');expect(s.forAccountSwitch(node,'a',true).command).toContain('--resume session-a')
 expect(s.forAccountSwitch(node,'b',true).command).toBe('claude');expect(new SessionStore(file).forRelaunch(node,true).command).toBe('claude')
 s.remember(node,'session-a');expect(s.forAccountSwitch(node,null,true).command).toBe('claude')
})
it("upgrade instala Antigravity uma vez, preserva customizações e exclusões posteriores",()=>{
 const root=temp();for(const p of ACCOUNT_PROVIDERS.filter(p=>p.id!=='antigravity'))writeFileSync(join(root,p.id+'.json'),JSON.stringify({...p,name:'Custom '+p.name}))
 const lib=new ProviderLibrary(root,ACCOUNT_PROVIDERS);const before=readFileSync(join(root,'claude.json'),'utf8');lib.ensure();expect(existsSync(join(root,'antigravity.json'))).toBe(true);expect(readFileSync(join(root,'claude.json'),'utf8')).toBe(before)
 rmSync(join(root,'antigravity.json'));new ProviderLibrary(root,ACCOUNT_PROVIDERS).ensure();expect(existsSync(join(root,'antigravity.json'))).toBe(false)
})
it("semeia conta padrão no upgrade só uma vez e mostra CLI ausente sem chamar status",async()=>{
 const root=temp(),home=join(root,'home');mkdirSync(home);const file=join(root,'accounts.json'),store=new AccountStore(file);store.add({name:'Claude',agent:'claude',configDir:home});store.seed(home)
 const defaultAccount=store.list().find(a=>a.agent==='antigravity');expect(defaultAccount?.configDir).toBe(home)
 const providers=new ProviderLibrary(join(root,'providers'),ACCOUNT_PROVIDERS);providers.ensure();const status=vi.fn(async()=>true)
 const service=new AccountService({root,store,providers,vault:new SecretVault(join(root,'vault'),{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),ports:{installed:()=>false,status,login:async()=>{},logout:async()=>{},usedBy:()=>0,moveToDefault:async()=>{},switchAccount:async()=>{}}})
 expect((await service.check(defaultAccount!.id)).status).toBe('notInstalled');expect(status).not.toHaveBeenCalled();store.remove(defaultAccount!.id);new AccountStore(file).seed(home);expect(new AccountStore(file).list().some(a=>a.agent==='antigravity')).toBe(false)
})
it("CLI aceita conta, preset e recruta Antigravity",()=>{
 expect(parseArgs(['account','add','Agy','--agent','antigravity','--dir','/fake/home'])).toMatchObject({cmd:'account-add',agent:'antigravity'})
 expect(parseArgs(['preset','create','Agy','--agent','antigravity','--command','agy','--account','Agy'])).toMatchObject({cmd:'preset-create',agent:'antigravity',account:'Agy'})
 expect(parseArgs(['recruit','Agy','--agent','antigravity','--account','Agy'])).toMatchObject({cmd:'recruit',agent:'antigravity',account:'Agy'})
})
it("preset com conta passa pelo handler real de agentes",()=>{
 const root=temp(),roles=new RoleStore(join(root,'roles')),catalog=new AgentCatalog(new PresetStore(join(root,'presets'),roles),roles),store=new WorkspaceStore(join(root,'ws')),accounts=new AccountStore(join(root,'accounts'))
 accounts.add({name:'Agy',agent:'antigravity',configDir:'/fake/home'});const routes=createAgentRoutes(catalog,store,undefined,undefined,{accounts});const result=routes['POST /preset/create']!({caller:{} as TerminalNode,url:new URL('http://palco'),body:{name:'Agy',agent:'antigravity',command:'agy',account:'Agy'}})
 expect(JSON.parse(result.body)).toMatchObject({account:'Agy',accounts:['Default','Agy']})
})
it('risco: consultar uso Antigravity nunca executa um prompt enquanto consumo de cota não foi descartado',async()=>{
 const run=vi.fn(async()=>({}));const result=await queryAntigravityUsage('/fake/home',{run,timeoutMs:90000});expect(run).not.toHaveBeenCalled();expect(result.error).toBeTruthy();expect(result.session).toBeUndefined()
})
it("recrutar resolve conta Antigravity pelo mesmo resolver usado no servidor e recusa outra CLI",async()=>{
 const {resolveAccountId}=await import('../src/main/accounts/routes');const store=new AccountStore(join(temp(),'accounts'));const account=store.add({name:'Agy',agent:'antigravity',configDir:'/fake/home'})
 expect(resolveAccountId('Agy','antigravity',store)).toBe(account.id);expect(resolveAccountId('Default','antigravity',store)).toBeUndefined();expect(()=>resolveAccountId('Agy','codex',store)).toThrow();expect(()=>resolveAccountId('Agy','shell',store)).toThrow()
})
it("registros de migração não seguem links para fora do armazenamento",async()=>{
 const {symlinkSync}=await import('node:fs');const root=temp(),outside=join(root,'preservar');writeFileSync(outside,'{"schemaVersion":1,"type":"account-defaults","payload":[]}');const providerDir=join(root,'providers');mkdirSync(providerDir);symlinkSync(outside,join(providerDir,'_builtins.json'))
 expect(()=>new ProviderLibrary(providerDir,ACCOUNT_PROVIDERS).ensure()).toThrow();expect(readFileSync(outside,'utf8')).toBe('{"schemaVersion":1,"type":"account-defaults","payload":[]}')
 const file=join(root,'accounts.json');symlinkSync(outside,file+'.seeded');expect(()=>new AccountStore(file).seed(root)).toThrow();expect(readFileSync(outside,'utf8')).toBe('{"schemaVersion":1,"type":"account-defaults","payload":[]}')
})
