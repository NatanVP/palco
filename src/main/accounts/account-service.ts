import type { AccountStatus } from './cli-auth'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Account } from '../../shared/model'
import type { AccountView, NewAccount } from '../../shared/account-settings'
import type { ProviderSpec } from '../../shared/providers'
import { AccountStore } from './account-store'
import { SecretVault } from './secret-vault'
import { ProviderLibrary } from '../providers/provider-library'
import { installAccountRuntime } from './account-runtime'
interface Ports {
 installed?(provider: ProviderSpec): boolean
 status(account: Account, provider: ProviderSpec): Promise<boolean | AccountStatus>
 login(account: Account, provider: ProviderSpec): Promise<void>
 logout(account: Account, provider: ProviderSpec): Promise<void>
 usedBy(accountId: string): number
 moveToDefault(accountId: string): Promise<void>
 switchAccount(terminalId: string, accountId: string | null, restart: boolean): Promise<void>
}
export function apiEndpoint(value: unknown): string | undefined {
 if (value === undefined || value === '') return undefined
 if (typeof value !== 'string' || value.length > 2048) throw new Error('Endpoint inválido.')
 let url: URL; try { url = new URL(value) } catch { throw new Error('Endpoint inválido.') }
 if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Use um endpoint HTTPS sem credenciais, query ou fragmento (HTTP só no localhost).')
 return url.href.replace(/\/$/,'')
}
export class AccountService {
 private identities = new Map<string, {email?: string; plan?: string}>()
 private statuses = new Map<string, AccountView['status']>()
 constructor(private readonly d: { root: string; store: AccountStore; vault: SecretVault; providers: ProviderLibrary; ports: Ports }) {}
 account(id: string): Account | undefined { return this.d.store.byId(id) }
 secureStorage(): boolean { return this.d.vault.available() }
 private required(id: string): Account { const a = this.account(id); if (!a) throw new Error('Conta não encontrada.'); return a }
 private provider(a: Account): ProviderSpec { const p = this.d.providers.get(a.providerId ?? a.agent); if (!p || p.agent !== a.agent) throw new Error('Provedor de conta indisponível.'); return p }
 private view(a: Account): AccountView {
  const mode = a.authMode ?? 'cli', keyLast4 = mode === 'apiKey' ? this.d.vault.last4(a.id) : undefined
  return { ...a, ...this.identities.get(a.id), mode, status: mode === 'apiKey' ? keyLast4 && this.d.vault.available() ? 'connected' : 'disconnected' : this.statuses.get(a.id) ?? 'unknown', terminalCount: this.d.ports.usedBy(a.id), ...(keyLast4 ? { keyLast4 } : {}) }
 }
 list(): AccountView[] { return this.d.store.list().map(a => this.view(a)) }
 add(input: NewAccount): AccountView {
  if (!input || !['cli','apiKey'].includes(input.mode) || typeof input.name !== 'string') throw new Error('Conta inválida.')
  const p = this.d.providers.get(input.providerId); if (!p) throw new Error('Provedor indisponível.')
  const endpoint = apiEndpoint(input.endpoint)
  if (input.mode === 'apiKey' && (!this.secureStorage() || !input.key)) throw new Error('Chave e armazenamento seguro são necessários.')
  if (input.mode === 'apiKey' && input.dir) throw new Error('Contas com chave usam uma pasta gerenciada própria.')
  const configDir = input.dir || join(this.d.root,'account-data',randomUUID())
  if (!isAbsolute(configDir)) throw new Error('Use um diretório absoluto.')
  if(p.agent==='antigravity'&&input.mode==='apiKey')throw new Error('Antigravity usa autenticação pela CLI.')
  const a = this.d.store.add({ name: input.name, agent: p.agent, configDir, authMode: input.mode, providerId: p.id, ...(endpoint ? { endpoint } : {}) })
  try {
   mkdirSync(a.configDir,{recursive:true,mode:0o700})
   if (input.mode === 'apiKey') {
    this.d.vault.set(a.id,input.key!)
    if (a.agent === 'codex') {
     // The value remains exclusively in safeStorage; TOML refers to its runtime environment variable.
     const url = endpoint ?? p.defaultEndpoint ?? 'https://api.openai.com/v1'
     writeFileSync(join(a.configDir,'config.toml'), `model_provider = "palco"\n[model_providers.palco]\nname = "palco"\nbase_url = ${JSON.stringify(url)}\nwire_api = "responses"\nenv_key = ${JSON.stringify(p.apiKeyEnv)}\n`, {flag:'wx',mode:0o600})
    }
   }
  } catch { this.d.store.remove(a.id); try { this.d.vault.remove(a.id) } catch {} throw new Error('Não foi possível criar a conta com segurança; nenhuma chave foi gravada em texto.') }
  return this.view(a)
 }
 async check(id: string): Promise<AccountView> {
  const a = this.required(id); if (a.authMode === 'apiKey') return this.view(a)
  if(this.d.ports.installed?.(this.provider(a))===false){this.identities.delete(id);this.statuses.set(id,'notInstalled');return this.view(a)}
  this.statuses.set(id,'checking')
  try { const result = await this.d.ports.status(a,this.provider(a)); const connected = typeof result === 'boolean' ? result : result.connected; this.identities.set(id,typeof result === 'object' && connected ? {email:result.email,plan:result.plan} : {}); this.statuses.set(id,connected ? 'connected' : 'disconnected') } catch { this.identities.delete(id); this.statuses.set(id,'unknown') }
  return this.view(a)
 }
 async login(id: string): Promise<void> { const a = this.required(id); if (a.authMode === 'apiKey') throw new Error('Substitua a chave para entrar nesta conta.'); await this.d.ports.login(a,this.provider(a)); this.statuses.set(id,'unknown') }
 async logout(id: string): Promise<void> {
  const a = this.required(id)
  if (a.authMode === 'apiKey') this.d.vault.remove(id)
  else { try { await this.d.ports.logout(a,this.provider(a)) } catch { throw new Error('Não foi possível sair pela CLI; a conta foi preservada.') } }
  this.identities.delete(id); this.statuses.set(id,'disconnected')
 }
 setColor(id: string,color: string | null): void { this.d.store.patch(id,{color:color === null ? undefined : color}) }
 rename(id: string,name: string): void { this.d.store.patch(id,{name}) }
 replaceKey(id: string,key: string): void { const a = this.required(id); if (a.authMode !== 'apiKey') throw new Error('Esta conta usa login de CLI.'); this.d.vault.set(id,key); this.d.store.patch(id,{authMode:a.authMode}) }
 async remove(id: string): Promise<void> {
  this.required(id); await this.d.ports.moveToDefault(id); this.d.vault.remove(id); this.d.store.remove(id); this.statuses.delete(id)
 }
 async assign(terminalId: string,accountId: string | null,restart: boolean): Promise<void> {
  if (typeof terminalId !== 'string' || !terminalId || typeof restart !== 'boolean') throw new Error('Troca de conta inválida.')
  if (accountId !== null) this.required(accountId)
  await this.d.ports.switchAccount(terminalId,accountId,restart)
 }
 installRuntime(): () => void {
  return installAccountRuntime(id => {
   const a = this.required(id), p = this.provider(a), env: Record<string,string> = { [p.configEnv]: a.configDir }
   if(a.agent==='antigravity'){env.XDG_CONFIG_HOME=join(a.configDir,'.config');env.JETSKI_OAUTH_TOKEN='';env.AGY_ADC_AUTH='';env.GEMINI_API_KEY=''}
   if (a.authMode === 'apiKey') {
    const key = this.d.vault.get(a.id); if (!key) throw new Error('Chave protegida indisponível.')
    env[p.apiKeyEnv] = key
    if (p.endpointEnv && a.endpoint) env[p.endpointEnv] = a.endpoint
    if (a.agent === 'claude') { env.ANTHROPIC_AUTH_TOKEN = ''; env.CLAUDE_CODE_OAUTH_TOKEN = '' }
   }
   return env
  })
 }
}
