import { accountRuntime } from './account-runtime'
import { randomUUID } from 'node:crypto'
import { statSync, lstatSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import type { Account, TerminalNode } from '../../shared/model'
import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'

export class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
const validText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v)
function validate(value: unknown): Account {
  const a = value as Partial<Account> | null
  if (!a || !validText(a.id, 120) || !validText(a.name, 120) || !['claude', 'codex', 'antigravity'].includes(a.agent ?? '')
      || !validText(a.configDir, 4096) || !isAbsolute(a.configDir)) throw new AccountError(400, 'conta inválida: use nome, agente claude/codex e diretório absoluto')
  if (a.authMode !== undefined && !['cli','apiKey'].includes(a.authMode) || a.providerId !== undefined && (!validText(a.providerId,64) || !/^[a-z][a-z0-9-]*$/.test(a.providerId)) || a.endpoint !== undefined && !validText(a.endpoint,2048)) throw new AccountError(400,'conta inválida')
  if (a.color !== undefined && (typeof a.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(a.color))) throw new AccountError(400, 'cor inválida (use #RRGGBB)')
  return { ...(a.color ? { color: a.color.toUpperCase() } : {}), id: a.id, name: a.name.trim(), agent: a.agent!, configDir: normalize(a.configDir), ...(a.authMode ? { authMode: a.authMode } : {}), ...(a.providerId ? { providerId: a.providerId } : {}), ...(a.endpoint ? { endpoint: a.endpoint } : {}) }
}
export class AccountStore {
  private entries: Account[] = []
  private initialized = false
  private readOnly = false
  private listeners = new Set<() => void>()
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  warning?: string
  constructor(private readonly file: string) {
    try {
      const loaded = readEnvelope<unknown>(file, 'accounts', 1)
      this.readOnly = loaded.readOnly
      if (loaded.payload !== null) {
        this.initialized = true
        if (!Array.isArray(loaded.payload)) throw new Error('formato inválido')
        const entries = loaded.payload.map(validate)
        if (new Set(entries.map(a => a.id)).size !== entries.length || new Set(entries.map(a => a.name.toLowerCase())).size !== entries.length) throw new Error('contas duplicadas')
        this.entries = entries
      }
      if (this.readOnly) this.warning = 'contas de versão futura: somente leitura'
    } catch {
      this.initialized = true; this.readOnly = true
      this.warning = 'não foi possível abrir accounts.json; arquivo preservado, contas somente leitura'
    }
  }
  list(): Account[] { return this.entries.map(a => ({ ...a })) }
  byId(id: string): Account | undefined { const a = this.entries.find(a => a.id === id); return a && { ...a } }
  byName(name: string): Account | undefined { return this.list().find(a => a.name.toLowerCase() === name.toLowerCase()) }
  add(input: Omit<Account, 'id'>): Account {
    const a = validate({ ...input, id: randomUUID() })
    if (this.byName(a.name)) throw new AccountError(409, 'conta já existe')
    this.save([...this.entries, a]); return { ...a }
  }
  patch(id: string, patch: Pick<Partial<Account>, 'name' | 'authMode' | 'providerId' | 'endpoint' | 'color'>): Account {
    const current = this.byId(id); if (!current) throw new AccountError(404,'conta inexistente')
    const next = validate({ ...current, ...patch })
    if (this.entries.some(a => a.id !== id && a.name.toLowerCase() === next.name.toLowerCase())) throw new AccountError(409,'conta já existe')
    this.save(this.entries.map(a => a.id === id ? next : a)); return next
  }
  remove(id: string): void {
    if (!this.byId(id)) throw new AccountError(404, 'conta inexistente')
    this.save(this.entries.filter(a => a.id !== id))
  }
  seed(home: string): void {
    if(this.readOnly)return
    const marker=this.file+'.seeded'
    try{if(lstatSync(marker).isSymbolicLink())throw new AccountError(409,'contas somente leitura')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
    const seeded=readEnvelope<string[]>(marker,'account-defaults',1)
    if(seeded.readOnly||seeded.payload!==null&&(!Array.isArray(seeded.payload)||seeded.payload.some(v=>typeof v!=='string')))throw new AccountError(409,'contas somente leitura')
    const inputs: Array<Omit<Account, 'id'>> = [{ name: 'Claude 1', agent: 'claude', configDir: join(home, '.claude') }]
    try { if (statSync(join(home, '.claude-sonnet')).isDirectory()) inputs.push({ name: 'Claude 2', agent: 'claude', configDir: join(home, '.claude-sonnet') }) } catch { /* pasta opcional */ }
    inputs.push({ name: 'Codex', agent: 'codex', configDir: join(home, '.codex') })
    if(!this.initialized)this.save(inputs.map(a => validate({ ...a, id: randomUUID() })))
    if(!seeded.payload?.includes('antigravity')){
      if(!this.entries.some(a=>a.agent==='antigravity'&&a.configDir===normalize(home))){let name='Antigravity',n=2;while(this.byName(name))name=`Antigravity ${n++}`;this.add({name,agent:'antigravity',providerId:'antigravity',configDir:home})}
      writeEnvelopeAtomic(marker,'account-defaults',1,[...new Set([...(seeded.payload??[]),'antigravity'])])
    }
  }
  private save(entries: Account[]): void {
    if (this.readOnly) throw new AccountError(409, 'contas somente leitura')
    writeEnvelopeAtomic(this.file, 'accounts', 1, entries)
    this.entries = entries; this.initialized = true
    for (const cb of this.listeners) cb()
  }
}

/** Não abre a pasta: só seleciona a variável que o CLI usa. */
export function accountEnvironment(node: Pick<TerminalNode, 'agent' | 'accountId'>, resolve: (id: string) => Account | undefined): { env: Record<string, string>; warning?: string } {
  if (!node.accountId) return { env: {} }
  const a = resolve(node.accountId)
  if (!a || a.agent !== node.agent) return { env: {}, warning: 'conta ausente ou incompatível; terminal iniciado com a conta padrão' }
  try { const runtime = accountRuntime(a.id); if (runtime) return { env: runtime } } catch { throw new AccountError(409,'Não foi possível abrir a conta selecionada; confira o provedor e o keyring do sistema.') }
  if (a.authMode === 'apiKey') throw new AccountError(409,'Chave de API indisponível; abra Configurações › Contas.')
  if(a.agent==='antigravity')return {env:{HOME:a.configDir,XDG_CONFIG_HOME:join(a.configDir,'.config'),JETSKI_OAUTH_TOKEN:'',AGY_ADC_AUTH:'',GEMINI_API_KEY:''}}
  return { env: { [a.agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: a.configDir } }
}
