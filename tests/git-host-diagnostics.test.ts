import{afterEach,expect,it,vi}from'vitest'
import{mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync}from'node:fs'
import{join}from'node:path'
import{tmpdir}from'node:os'
import{GitHosts}from'../src/main/git-hosts/git-hosts'
import{Diagnostics}from'../src/main/diagnostics'
const dirs:string[]=[];const temp=()=>{const d=mkdtempSync(join(tmpdir(),'palco-about-'));dirs.push(d);return d};afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})))
it('Git: lista JSON integrado, verifica conta, consulta PR real e normaliza GitHub/GitLab sem guardar tokens',async()=>{
 const run=vi.fn(async(cmd:string,args:string[])=>{if(args.includes('status'))return'Logged in';if(cmd==='gh')return JSON.stringify([{number:1,title:'PR',state:'OPEN',updatedAt:'2026-11-25',url:'https://example.test/1'}]);return JSON.stringify([{iid:2,title:'MR',state:'opened',updated_at:'2026-11-25',web_url:'https://example.test/2'}])})
 const s=new GitHosts(temp(),run);s.ensure();expect(s.list().every(x=>x.state==='bundled')).toBe(true);expect((await s.check('github')).state).toBe('connected')
 expect(await s.pullRequests('/tmp/project','github')).toMatchObject([{number:1,title:'PR'}]);expect(await s.pullRequests('/tmp/project','gitlab')).toMatchObject([{number:2,state:'OPENED'}])
})
it('Git: modificado, ausente, futuro, recarregar e restaurar por digest preservam arquivos personalizados',()=>{
 const dir=temp(),s=new GitHosts(dir,vi.fn());s.ensure();const file=join(dir,'github.json'),p=JSON.parse(readFileSync(file,'utf8'));p.name='Mudou';writeFileSync(file,JSON.stringify(p));const entry=s.list().find(x=>x.id==='github')!;expect(entry.state).toBe('modified')
 writeFileSync(file,JSON.stringify({...p,name:'Mudou outra vez'}));expect(()=>s.restore('github',entry.digest!)).toThrow(/mudou/)
 const latest=s.list().find(x=>x.id==='github')!;s.restore('github',latest.digest!);expect(s.list().find(x=>x.id==='github')?.state).toBe('bundled')
 rmSync(join(dir,'gitlab.json'));expect(s.missing()).toEqual(['gitlab']);s.restoreMissing();expect(existsSync(join(dir,'gitlab.json'))).toBe(true)
 writeFileSync(join(dir,'future.json'),JSON.stringify({...p,id:'future',schemaVersion:99}));s.reload();expect(s.list().find(x=>x.id==='future')?.state).toBe('requiresNewVersion')
})
it('Git: provedor personalizado é consumidor de PRs e erro/saída de autenticação nunca vaza',async()=>{
 const dir=temp(),run=vi.fn(async(_command:string,_args:string[])=>JSON.stringify([{number:3,title:'Own',state:'open',updatedAt:'x',url:'https://example.test/3'}])),s=new GitHosts(dir,run);s.ensure()
 const p=JSON.parse(readFileSync(join(dir,'github.json'),'utf8'));writeFileSync(join(dir,'custom.json'),JSON.stringify({...p,id:'custom',name:'Custom',protocol:'json',command:'own-cli'}))
 expect(await s.pullRequests('/tmp/project','custom')).toMatchObject([{number:3}]);expect(run.mock.calls[0]?.[0]).toBe('own-cli')
 const bad=new GitHosts(dir,async()=>{throw new Error('TEST-ONLY-INVALID-SECRET')});expect(JSON.stringify(await bad.check('github'))).not.toContain('TEST-ONLY');expect((await bad.check('github')).state).toBe('unknown')
})
it('Sobre: diagnóstico usa allowlist, versão real e contagens; onboarding persiste e pode ser reaberto',()=>{
 const dir=temp(),s=new Diagnostics(join(dir,'onboarding.json'),()=>({appVersion:'0.1.0',electron:'45',chrome:'1',node:'26',platform:'linux',arch:'x64',release:'test',memoryMB:1000,cpuCount:2,workspaceCount:2,terminalCount:3}))
 expect(s.report()).toContain('Electron: 45');expect(s.report()).toContain('Terminais: 3');expect(s.report()).not.toContain(dir);expect(s.onboardingCompleted()).toBe(false);s.completeOnboarding();expect(new Diagnostics(join(dir,'onboarding.json'),()=>({}as never)).onboardingCompleted()).toBe(true);s.reopenOnboarding();expect(s.onboardingCompleted()).toBe(false)
})
it('JSON integrado quebrado pode ser restaurado com confirmação de digest sem executá-lo',()=>{
 const dir=temp(),s=new GitHosts(dir,vi.fn());s.ensure();writeFileSync(join(dir,'github.json'),'{bad');const entry=s.list().find(p=>p.id==='github')!
 expect(entry.digest).toBeDefined();s.restore('github',entry.digest!);expect(s.list().find(p=>p.id==='github')?.state).toBe('bundled')
})
