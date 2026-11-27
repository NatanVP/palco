import {expect,it,vi} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ACCOUNT_PROVIDERS} from '../src/main/providers/provider-library'
import {accountCommand} from '../src/main/accounts/cli-auth'
import {parseAntigravityUsage} from '../src/main/usage/antigravity-usage'
import {loginTerminal} from '../src/main/accounts/login-terminal'
import type {Account} from '../src/shared/model'
it('Antigravity integrado tem HOME isolado, login sem args, status por existência e logout restrito à conta',async()=>{
 const home=mkdtempSync(join(tmpdir(),'palco-agy-'));try{
 const p=ACCOUNT_PROVIDERS.find(p=>p.id==='antigravity')!;expect(p.command).toBe('agy');const a={id:'a',name:'Agy',agent:'antigravity',configDir:home} as Account
 expect(await accountCommand(a,p,'status')).toEqual({connected:false});const token=join(home,'.gemini/antigravity-cli/antigravity-oauth-token');mkdirSync(join(home,'.gemini/antigravity-cli'),{recursive:true});writeFileSync(token,'FAKE');const other=join(home,'preservar');writeFileSync(other,'ok');expect(await accountCommand(a,p,'status')).toEqual({connected:true});await accountCommand(a,p,'logout');expect(existsSync(token)).toBe(false);expect(existsSync(other)).toBe(true)
 const terminal=loginTerminal(a,p,{cwd:home,floorId:null,name:'Login'});expect(terminal.command).toContain('HOME=');expect(terminal.command).toContain('XDG_CONFIG_HOME=');expect(terminal.command).toContain('-u JETSKI_OAUTH_TOKEN');expect(terminal.command).toMatch(/agy$/)
 }finally{rmSync(home,{recursive:true,force:true})}
})
it('lê grupos e buckets do protocolo real sem repassar a resposta bruta',async()=>{
 const run=vi.fn(async(..._args:unknown[])=>({status:'SUCCESS',command:{data:{groups:[{name:'Grupo',buckets:[{window:'5h',remaining_fraction:0.6,reset_time:'2026-11-25T20:00:00Z'},{window:'7d',remaining_fraction:0.9}]}]}}}))
 const result=parseAntigravityUsage(await run());expect(result.agent).toBe('antigravity');expect(result.session?.usedPercent).toBeCloseTo(40);expect(result.weekly?.usedPercent).toBeCloseTo(10);expect(result.meters?.[0]?.name).toBe('Grupo');expect(run.mock.calls[0]).toEqual([])
})
it('restaura somente o integrado escolhido e lista os ausentes sem alterar arquivos customizados',async()=>{
 const {ProviderLibrary}=await import('../src/main/providers/provider-library');const {readFileSync}=await import('node:fs');const home=mkdtempSync(join(tmpdir(),'palco-agy-providers-'))
 try{const lib=new ProviderLibrary(home,ACCOUNT_PROVIDERS);lib.ensure();const file=join(home,'claude.json');const original=readFileSync(file,'utf8');writeFileSync(file,original.replace('Claude Code','Meu Claude'));rmSync(join(home,'antigravity.json'));expect(lib.missing().map(p=>p.id)).toEqual(['antigravity']);lib.restoreOne('antigravity');expect(readFileSync(file,'utf8')).toContain('Meu Claude');expect(lib.get('antigravity')?.command).toBe('agy')
 }finally{rmSync(home,{recursive:true,force:true})}
})
it('terminais agy mantêm o comando sem injetar hooks de outro agente e aceitam conta isolada',async()=>{
 const {buildAgentCommand}=await import('../src/main/pty/agent-command');const {agentForCommand}=await import('../src/shared/agent-command');const {accountEnvironment}=await import('../src/main/accounts/account-store')
 expect(agentForCommand('agy')).toBe('antigravity');expect(buildAgentCommand('antigravity','agy','/bin/palco')).toBe('agy');expect(accountEnvironment({agent:'antigravity',accountId:'a'},()=>({id:'a',name:'Agy',agent:'antigravity',configDir:'/fake/home'})).env).toMatchObject({HOME:'/fake/home',XDG_CONFIG_HOME:'/fake/home/.config',GEMINI_API_KEY:''})
})
it('caminhos absolutos de CLIs personalizados são resolvidos e diretórios não passam por executável',async()=>{
 const {which}=await import('../src/main/environments/system');const {chmodSync}=await import('node:fs');const home=mkdtempSync(join(tmpdir(),'palco-which-'))
 try{const path=join(home,'custom-agy');writeFileSync(path,'#!/bin/sh\nexit 0\n');chmodSync(path,0o700);expect(which(path,'/no/path')).toBe(path);expect(which(home)).toBeNull()}finally{rmSync(home,{recursive:true,force:true})}
})
it('leituras conservam o id do provedor personalizado para que a linha correta receba os anéis',async()=>{
 const {queryProviderUsage}=await import('../src/main/usage/provider-query');const {ProviderLibrary}=await import('../src/main/providers/provider-library');const home=mkdtempSync(join(tmpdir(),'palco-custom-usage-'))
 try{const lib=new ProviderLibrary(home,[{...ACCOUNT_PROVIDERS.find(p=>p.id==='claude')!,id:'my-claude'}]);lib.ensure();const result=await queryProviderUsage({id:'a',name:'Custom',agent:'claude',providerId:'my-claude',configDir:'/fake'},lib,async()=>({response:{response:{rate_limits_available:true,rate_limits:{five_hour:{utilization:20}}}}}));expect(result.providerId).toBe('my-claude');expect(result.session?.usedPercent).toBe(20)}finally{rmSync(home,{recursive:true,force:true})}
})
