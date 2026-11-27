import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ProviderSpec, ProviderView } from '../../shared/providers'
import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'
const spec = (agent: 'claude' | 'codex'): ProviderSpec => ({ schemaVersion: 1, revision: 1, id: agent, name: agent === 'claude' ? 'Claude Code' : 'Codex', agent, command: agent, configEnv: agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME', loginArgs: agent === 'claude' ? ['auth','login'] : ['login'], logoutArgs: agent === 'claude' ? ['auth','logout'] : ['logout'], statusArgs: agent === 'claude' ? ['auth','status','--json'] : ['login','status'], apiKeyEnv: agent === 'claude' ? 'ANTHROPIC_API_KEY' : 'PALCO_ACCOUNT_API_KEY', endpointEnv: agent === 'claude' ? 'ANTHROPIC_BASE_URL' : undefined, defaultEndpoint: agent === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1', usage: agent, color: agent === 'claude' ? '#D97757' : '#10A37F' })
export const ACCOUNT_PROVIDERS = [spec('claude'), spec('codex'), { ...spec('codex'), id:'antigravity', name:'Antigravity', agent:'antigravity' as const, command:'agy', configEnv:'HOME', loginArgs:[], logoutArgs:[], statusArgs:[], apiKeyEnv:'GEMINI_API_KEY', endpointEnv:undefined, usage:'antigravity' as const, color:'#4285F4' }]
export const USAGE_PROVIDERS = ACCOUNT_PROVIDERS.map(p => ({ ...p }))
const ID = /^[a-z][a-z0-9-]{0,63}$/, ENV = /^[A-Z][A-Z0-9_]{0,79}$/
const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
function validate(p: ProviderSpec): void {
 if (!p || !ID.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120 || !['claude','codex','antigravity'].includes(p.agent) || typeof p.command !== 'string' || !p.command || /[\0\r\n]/.test(p.command) || !ENV.test(p.configEnv) || !ENV.test(p.apiKeyEnv) || p.endpointEnv !== undefined && !ENV.test(p.endpointEnv) || !['claude','codex','antigravity','json'].includes(p.usage) || !color(p.color)) throw new Error('Definição inválida.')
 for (const args of [p.loginArgs,p.logoutArgs,p.statusArgs,p.usageArgs ?? []]) if (!Array.isArray(args) || args.length > 100 || args.some(v => typeof v !== 'string' || v.length > 8192 || v.includes('\0'))) throw new Error('Argumentos inválidos.')
}
const canonical = (p: ProviderSpec): string => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b))))
/** Declarative local JSON, never eval/require. Commands are executed with argument arrays and no shell. */
export class ProviderLibrary {
 private listeners = new Set<() => void>()
 constructor(readonly dir: string, private readonly bundled: readonly ProviderSpec[]) {}
 onChange(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
 private changed(): void { for (const cb of this.listeners) cb() }
 private safe(): void { if (existsSync(this.dir) && lstatSync(this.dir).isSymbolicLink()) throw new Error('A pasta de provedores não pode ser um link.') }
 ensure(): void {
  this.safe(); mkdirSync(this.dir,{recursive:true,mode:0o700})
  const marker=join(this.dir,'_builtins.json'), files=readdirSync(this.dir)
  if(files.includes('_builtins.json')&&lstatSync(marker).isSymbolicLink())throw new Error('A pasta de provedores não pode ser um link.')
  const recorded=readEnvelope<string[]>(marker,'provider-builtins',1)
  if(recorded.readOnly||recorded.payload!==null&&(!Array.isArray(recorded.payload)||recorded.payload.some(id=>typeof id!=='string'||!ID.test(id))))throw new Error('Configuração de provedores somente leitura.')
  // Pre-manifest installations already knew Claude/Codex; missing old files may be deliberate deletions.
  const seen=new Set(recorded.payload??(files.some(n=>/^[a-z][a-z0-9-]*\.json$/.test(n))?['claude','codex']:[]))
  for(const p of this.bundled){if(!seen.has(p.id)&&!files.includes(`${p.id}.json`))this.restoreOne(p.id);seen.add(p.id)}
  writeEnvelopeAtomic(marker,'provider-builtins',1,[...seen].sort())
 }
 list(): ProviderView[] {
  this.safe(); if (!existsSync(this.dir)) return []
  const settings = this.settings(), list: ProviderView[] = []
  for (const file of readdirSync(this.dir).filter(n => /^[a-z][a-z0-9-]*\.json$/.test(n))) {
   const id = file.slice(0,-5), path = join(this.dir,file), base = this.bundled.find(p => p.id === id)
   try {
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).size > 256*1024) throw new Error('Arquivo inválido ou maior que 256 KB.')
    const p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path))) as ProviderSpec
    if (p.id !== id) throw new Error('O id precisa corresponder ao nome do arquivo.')
    if (p.schemaVersion > 1) { list.push({ id, name: typeof p.name === 'string' ? p.name : id, state: 'requiresNewVersion', enabled: false, color: '#888888', problem: 'Requer uma versão mais recente.' }); continue }
    if (p.schemaVersion !== 1) throw new Error('Versão inválida.')
    validate(p); const config = settings[id]
    list.push({ id, name: p.name, state: !base ? 'custom' : (p.revision ?? 0) < (base.revision ?? 0) ? 'outOfDate' : canonical(p) === canonical(base) ? 'bundled' : 'modified', enabled: config?.enabled !== false, color: config?.color ?? p.color, spec: p })
   } catch { list.push({ id, name: id, state: 'invalid', enabled: false, color: '#888888', problem: 'Não foi possível carregar este provedor; arquivo preservado.' }) }
  }
  return list.sort((a,b) => a.name.localeCompare(b.name))
 }
 get(id: string): (ProviderSpec & { color: string }) | undefined { try { const entry = this.list().find(p => p.id === id); return entry?.enabled && entry.spec ? { ...entry.spec, color: entry.color } : undefined } catch { return undefined } }
 private settings(): Record<string, { enabled?: boolean; color?: string }> {
  const e = readEnvelope<Record<string, { enabled?: boolean; color?: string }>>(join(this.dir,'_settings.json'),'provider-settings',1)
  if (e.readOnly || e.payload !== null && (typeof e.payload !== 'object' || Array.isArray(e.payload))) throw new Error('Configuração de provedores somente leitura.')
  for (const v of Object.values(e.payload ?? {})) if (!v || typeof v !== 'object' || v.enabled !== undefined && typeof v.enabled !== 'boolean' || v.color !== undefined && !color(v.color)) throw new Error('Configuração de provedores inválida.')
  return e.payload ?? {}
 }
 configure(id: string, patch: { enabled?: boolean; color?: string }): void {
  this.safe(); if (!ID.test(id) || !this.list().some(p => p.id === id && p.spec) || !patch || patch.enabled !== undefined && typeof patch.enabled !== 'boolean' || patch.color !== undefined && !color(patch.color)) throw new Error('Configuração inválida.')
  const settings = this.settings(); settings[id] = { ...settings[id], ...patch }; writeEnvelopeAtomic(join(this.dir,'_settings.json'),'provider-settings',1,settings); this.changed()
 }
 restore(all: boolean): void {
  this.safe(); mkdirSync(this.dir,{ recursive:true, mode:0o700 })
  if (all) for (const file of readdirSync(this.dir)) if (/^[a-z][a-z0-9-]*\.json$/.test(file) || file === '_settings.json' || file === '_settings.json.bak') rmSync(join(this.dir,file),{ force:true })
  if (!all) { const settings = this.settings(); for (const p of this.bundled) delete settings[p.id]; if (existsSync(join(this.dir,'_settings.json'))) writeEnvelopeAtomic(join(this.dir,'_settings.json'),'provider-settings',1,settings) }
  for (const p of this.bundled) { const file = join(this.dir,`${p.id}.json`), tmp = file + '.' + randomUUID() + '.tmp'; try { writeFileSync(tmp,JSON.stringify(p,null,2)+'\n',{flag:'wx',mode:0o600}); renameSync(tmp,file) } finally { rmSync(tmp,{force:true}) } }
  this.changed()
 }
 missing(): ProviderView[] { const present=new Set(this.list().map(p=>p.id));return this.bundled.filter(p=>!present.has(p.id)).map(p=>({id:p.id,name:p.name,state:'bundled',enabled:false,color:p.color,spec:{...p},missing:true})) }
 restoreOne(id:string):void {
  this.safe();const p=this.bundled.find(p=>p.id===id);if(!p)throw new Error('Provedor integrado não encontrado.')
  mkdirSync(this.dir,{recursive:true,mode:0o700});const target=join(this.dir,`${id}.json`),tmp=target+'.'+randomUUID()+'.tmp'
  try{writeFileSync(tmp,JSON.stringify(p,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,target)}finally{rmSync(tmp,{force:true})}this.changed()
 }
 removeAll(): void { this.safe(); rmSync(this.dir,{recursive:true,force:true}); this.changed() }
 reload(): void { this.list(); this.changed() }
}
