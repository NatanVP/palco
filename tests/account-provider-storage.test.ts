import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SecretVault } from '../src/main/accounts/secret-vault'
import { AccountService } from '../src/main/accounts/account-service'
import { AccountStore, accountEnvironment } from '../src/main/accounts/account-store'
import { ProviderLibrary, ACCOUNT_PROVIDERS, USAGE_PROVIDERS } from '../src/main/providers/provider-library'
import { UsageService } from '../src/main/usage/usage-service'
import { loginTerminal } from '../src/main/accounts/login-terminal'
import { buildAgentCommand } from '../src/main/pty/agent-command'
import { normalizeAgentCommand } from '../src/main/domain/command'
import { setLocale, t } from '../src/shared/i18n/runtime'
const dirs: string[] = []; const temp = () => { const d = mkdtempSync(join(tmpdir(), 'palco-b4-')); dirs.push(d); return d }
afterEach(() => { vi.useRealTimers(); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })) })
const crypto = { available: () => true, encrypt: (v: string) => Buffer.from(v).reverse(), decrypt: (b: Buffer) => Buffer.from(b).reverse().toString() }
function setup() {
 const root = temp(), store = new AccountStore(join(root, 'accounts.json')), vault = new SecretVault(join(root, 'encrypted-keys.json'), crypto), providers = new ProviderLibrary(join(root, 'account-providers'), ACCOUNT_PROVIDERS)
 providers.ensure(); const ports = { status: vi.fn(async () => true), login: vi.fn(async () => {}), logout: vi.fn(async () => {}), usedBy: vi.fn(() => 2), moveToDefault: vi.fn(async () => {}), switchAccount: vi.fn(async () => {}) }
 const service = new AccountService({ root, store, vault, providers, ports }); return { root, store, vault, providers, ports, service }
}
it('contas: lista estado, uso por terminal, login, renomeia e sai sem expor resposta de CLI', async () => {
 const { service, ports } = setup(), a = service.add({ name: 'Teste', providerId: 'claude', mode: 'cli' })
 await service.check(a.id); expect(service.list()[0]).toMatchObject({ status: 'connected', terminalCount: 2, name: 'Teste' })
 await service.login(a.id); expect(ports.login).toHaveBeenCalledOnce(); service.rename(a.id, 'Novo'); expect(service.list()[0]?.name).toBe('Novo')
 await service.logout(a.id); expect(ports.logout).toHaveBeenCalledOnce(); expect(service.list()[0]?.status).toBe('disconnected')
})
it('API: só ciphertext no disco, últimos 4 na UI, endpoint validado, substituição e ambiente real de spawn', () => {
 const { service, root } = setup(), fake = 'TEST-ONLY-INVALID-KEY-1234'
 const a = service.add({ name: 'API', providerId: 'claude', mode: 'apiKey', key: fake, endpoint: 'https://example.test/v1' })
 expect(service.list()[0]).toMatchObject({ mode: 'apiKey', keyLast4: '1234', status: 'connected' })
 expect(readFileSync(join(root, 'encrypted-keys.json'), 'utf8')).not.toContain(fake)
 expect(JSON.stringify(service.list())).not.toContain(fake)
 const dispose = service.installRuntime(); expect(accountEnvironment({ agent: 'claude', accountId: a.id }, id => service.account(id)).env.ANTHROPIC_API_KEY).toBe(fake); dispose()
 service.replaceKey(a.id, 'TEST-ONLY-INVALID-KEY-5678'); expect(service.list()[0]?.keyLast4).toBe('5678')
 expect(() => service.add({ name: 'Bad', providerId: 'claude', mode: 'apiKey', key: fake, endpoint: 'https://user:password@example.test' })).toThrow()
})
it('sem keyring seguro recusa chave e não grava texto, nem fallback basic_text', () => {
 const root = temp(), vault = new SecretVault(join(root, 'keys.json'), { ...crypto, available: () => false })
 expect(() => vault.set('a', 'TEST-ONLY-INVALID-KEY')).toThrow(/seguro/); expect(existsSync(join(root, 'keys.json'))).toBe(false)
})
it('remover move terminais para Padrão antes de esquecer a conta; troca pode aguardar próximo início', async () => {
 const { service, ports } = setup(), a = service.add({ name: 'Teste', providerId: 'codex', mode: 'cli' })
 await service.assign('terminal', a.id, false); expect(ports.switchAccount).toHaveBeenCalledWith('terminal', a.id, false)
 await service.assign('terminal', a.id, true); expect(ports.switchAccount).toHaveBeenLastCalledWith('terminal', a.id, true)
 await service.remove(a.id); expect(ports.moveToDefault).toHaveBeenCalledWith(a.id); expect(service.list()).toEqual([])
})
it('provedores: integrado/modificado/personalizado/futuro/inválido, ativação, cor e restauração', () => {
 const root = temp(), lib = new ProviderLibrary(root, USAGE_PROVIDERS); lib.ensure(); expect(lib.list().every(p => p.state === 'bundled')).toBe(true)
 const p = JSON.parse(readFileSync(join(root, 'claude.json'), 'utf8')); p.name = 'Personalizado'; writeFileSync(join(root, 'claude.json'), JSON.stringify(p)); expect(lib.list().find(p => p.id === 'claude')?.state).toBe('modified')
 writeFileSync(join(root, 'custom.json'), JSON.stringify({ ...p, id: 'custom' })); expect(lib.list().find(p => p.id === 'custom')?.state).toBe('custom')
 writeFileSync(join(root, 'future.json'), JSON.stringify({ ...p, id: 'future', schemaVersion: 99 })); expect(lib.list().find(p => p.id === 'future')?.state).toBe('requiresNewVersion')
 writeFileSync(join(root, 'bad.json'), '{bad'); expect(lib.list().find(p => p.id === 'bad')?.state).toBe('invalid')
 lib.configure('claude', { enabled: false, color: '#123456' }); expect(lib.get('claude')).toBeUndefined()
 lib.configure('claude', { enabled: true }); expect(lib.get('claude')?.color).toBe('#123456')
 lib.restore(false); expect(lib.list().find(p => p.id === 'claude')?.state).toBe('bundled'); expect(existsSync(join(root, 'custom.json'))).toBe(true)
 lib.restore(true); expect(existsSync(join(root, 'custom.json'))).toBe(false)
})
it('uso: chave de API não tem anéis; provedor desligado e uso global desligado não consultam; cor chega ao painel', async () => {
 const { service, store } = setup(); service.add({ name: 'API', providerId: 'claude', mode: 'apiKey', key: 'TEST-ONLY-INVALID-KEY-1234' }); service.add({ name: 'CLI', providerId: 'codex', mode: 'cli' })
 let enabled = true, provider = true
 const query = vi.fn(async () => ({ agent: 'codex' as const, source: 'teste', session: { usedPercent: 10, resetsAt: null } }))
 const s = new UsageService({ accounts: store, runner: vi.fn(), now: Date.now, setTimeout, enabled: () => enabled, providerEnabled: () => provider, color: () => '#123456', query })
 await s.refresh(); expect(query).toHaveBeenCalledTimes(1); expect(s.snapshot()).toHaveLength(1); expect(s.snapshot()[0]?.color).toBe('#123456')
 provider = false; expect(s.snapshot()).toEqual([]); enabled = false; await s.refresh(); expect(query).toHaveBeenCalledTimes(1); s.dispose()
})
it('ambiente de chave ausente falha fechado em vez de usar outra autenticação herdada', () => {
 const {service}=setup(), a=service.add({name:'API',providerId:'claude',mode:'apiKey',key:'TEST-ONLY-INVALID-KEY-1234'})
 expect(()=>accountEnvironment({agent:'claude',accountId:a.id},id=>service.account(id))).toThrow(/indisponível/)
})
it('provedor com configurações malformadas não derruba o consumidor de Uso',()=>{
 const root=temp(),lib=new ProviderLibrary(join(root,'providers'),USAGE_PROVIDERS);lib.ensure();writeFileSync(join(root,'providers/_settings.json'),'{bad')
 expect(()=>lib.get('claude')).not.toThrow();expect(lib.get('claude')).toBeUndefined()
})
it('provedor integrado de revisão anterior aparece Desatualizado e restauração volta ao padrão',()=>{
 const root=temp(),lib=new ProviderLibrary(join(root,'providers'),USAGE_PROVIDERS);lib.ensure()
 const file=join(root,'providers/claude.json'),p=JSON.parse(readFileSync(file,'utf8'));p.revision=0;writeFileSync(file,JSON.stringify(p))
 expect(lib.list().find(v=>v.id==='claude')?.state).toBe('outOfDate');lib.configure('claude',{enabled:false,color:'#123456'});lib.restore(false);expect(lib.get('claude')?.color).toBe('#D97757')
})
import { restoreTerminals } from '../src/main/agents/restore'
it('conta indisponível na restauração não derruba o boot nem inicia com outra conta',()=>{
 const node={id:'a',kind:'terminal',command:'claude'} as Parameters<typeof restoreTerminals>[0][number], spawn=vi.fn(()=>{throw new Error('keyring indisponível')})
 expect(restoreTerminals([node],spawn)).toEqual(['a']);expect(spawn).toHaveBeenCalledOnce()
})

it('"Entrar": o terminal de login roda de fato o comando de login da conta', () => {
 const provider = ACCOUNT_PROVIDERS.find(p => p.id === 'claude')!
 const node = loginTerminal({ id: 'a', name: 'Claude 1', agent: 'claude', configDir: "/tmp/conta d'teste" }, provider, { cwd: '/tmp', floorId: null, name: 'Entrar em Claude 1' })
 const boot = buildAgentCommand(node.agent, normalizeAgentCommand(node.agent, node.command), '/bin/palco')
 expect(boot).toBe(node.command); expect(boot).toContain('CLAUDE_CONFIG_DIR='); expect(boot).toMatch(/ claude auth login$/); expect(boot).not.toContain('--settings')
})
it('contagem de terminais da conta usa singular, plural e um texto próprio para nenhum', () => {
 try {
  setLocale('pt-BR')
  expect(t('settings.tabs.accounts-usage.usada_por_terminalcount_termin', { count: 1 })).toBe('Usada por 1 terminal')
  expect(t('settings.tabs.accounts-usage.usada_por_terminalcount_termin', { count: 3 })).toBe('Usada por 3 terminais')
  expect(t('settings.tabs.accounts-usage.terminalcount_terminais_passar', { count: 1 })).toMatch(/^1 terminal passará para Padrão\. O processo ativo será reiniciado/)
  expect(t('settings.tabs.accounts-usage.nenhum_terminal_usa_remover')).toBe('Nenhum terminal usa esta conta. A pasta da CLI será preservada.')
  setLocale('en')
  expect(t('settings.tabs.accounts-usage.usada_por_terminalcount_termin', { count: 1 })).toBe('Used by 1 terminal')
 } finally { setLocale('pt-BR') }
})
it('o cofre não guarda cópia antiga: chave substituída ou removida sai do disco, inclusive do .bak', () => {
 const { root, vault } = setup(), file = join(root, 'encrypted-keys.json')
 vault.set('a', 'chave-antiga-0001'); const old = JSON.parse(readFileSync(file, 'utf8')).payload.a.cipher as string
 const onDisk = (): string => [file, `${file}.bak`].filter(existsSync).map(f => readFileSync(f, 'utf8')).join('')
 vault.set('a', 'chave-nova-0002'); expect(onDisk()).not.toContain(old)
 const next = JSON.parse(readFileSync(file, 'utf8')).payload.a.cipher as string
 vault.remove('a'); expect(onDisk()).not.toContain(next)
})
