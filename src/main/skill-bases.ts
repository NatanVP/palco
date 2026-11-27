import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, parse, relative } from 'node:path'
import type { AgentKind } from '../shared/model'
import type { SkillBase, SkillDraft } from '../shared/agent-libraries'
import { readEnvelope, writeEnvelopeAtomic } from './domain/envelope'
import { installSkills, isInstalled, isManaged, skillConflicts } from './skills-install'
export function validateSkillPath(value: unknown): string {
 if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || value.includes('..') || !/^[\p{L}\p{N}/._ -]+$/u.test(value) || value.includes(' ') || normalize(value) === parse(value).root) throw new Error("Caminho inválido: use caminho absoluto, só letras, dígitos e / . _ -, sem '..'.")
 const path = normalize(value)
 for (let p = path; p !== dirname(p); p = dirname(p)) if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error('O caminho não pode conter links simbólicos.')
 return path
}
/** Os locais padrão do palco, relativos ao HOME. Não há um só do Codex: ele lê `~/.agents/skills`. */
function defaultBases(home: string): SkillBase[] {
 const base = (id: string, name: string, path: string, icon: string, builtin?: 'claude' | 'codex'): SkillBase => ({ id, name, path: join(home, path), enabled: true, icon, ...(builtin ? { builtin } : {}) })
 // `builtin` diz a qual CLI a base serve, inclusive nas pastas das contas (`<configDir>/skills`).
 return [base('claude', 'Claude Code', '.claude/skills', 'badge-check', 'claude'), base('agents', 'Agent Skills', '.agents/skills', 'file-text', 'codex'), base('hermes', 'Hermes', '.hermes/skills', 'send'), base('antigravity', 'Antigravity', '.gemini/config/skills', 'sparkle')]
}
/** Only directories installed by this app (with version marker) are removed; never remove user skills. */
function uninstall(target: string): void {
 validateSkillPath(target); if (!existsSync(target)) return
 for (const name of readdirSync(target)) {
  const dir = join(target, name)
  if (name.startsWith('palco') && isManaged(dir)) rmSync(dir, { recursive: true })
 }
}
export class SkillBases {
 private entries: SkillBase[]
 private readOnly = false
 /** Sem lista própria gravada: vale o padrão. */
 private untouched = false
 constructor(private readonly file: string, private readonly source: string, private readonly home: string, private readonly accountDirs: (agent: 'claude' | 'codex') => string[] = () => []) {
  this.entries = defaultBases(home)
  try {
   const e = readEnvelope<SkillBase[]>(file, 'skill-bases', 1); this.readOnly = e.readOnly; this.untouched = e.payload === null
   if (e.payload !== null) { if (!Array.isArray(e.payload)) throw new Error('invalid'); const ids = new Set<string>(), paths = new Set<string>(); for (const b of e.payload) { this.validate(b); if (typeof b.id !== 'string' || ids.has(b.id) || paths.has(b.path) || b.builtin !== undefined && !['claude','codex'].includes(b.builtin)) throw new Error('invalid'); ids.add(b.id); paths.add(b.path) }; this.entries = e.payload }
  } catch { this.readOnly = true }
 }
 list(): SkillBase[] { if (this.readOnly) throw new Error('Bases de skills em modo somente leitura: arquivo inválido ou de versão futura.'); return this.entries.map(b => ({ ...b, display: this.display(b.path), ...(b.enabled ? this.diagnose(b) : {}) })) }
 /** Por que as skills de um local ligado não estão todas lá: o caminho é recusado, ou há pastas que não são do palco. */
 private diagnose(base: SkillBase): { conflicts?: string[]; unavailable?: true } {
  try { const conflicts = [...new Set(this.paths(base).flatMap(path => skillConflicts(this.source, path)))]; return conflicts.length ? { conflicts } : {} } catch { return { unavailable: true } }
 }
 /** Todos os destinos da base estão com todas as skills, conferidas? */
 private complete(base: SkillBase): boolean { try { return this.paths(base).every(path => isInstalled(this.source, path)) } catch { return false } }
 /** Os caminhos que alguma base ligada ainda usa (um a um: um recusado não esconde os outros). */
 private inUse(entries: SkillBase[]): Set<string> { return new Set(entries.filter(b => b.enabled).flatMap(b => [b.path, ...this.accountsOf(b)]).map(path => normalize(path))) }
 private display(path: string): string { const inside = relative(this.home, path); return inside && !inside.startsWith('..') && !isAbsolute(inside) ? `~/${inside}` : path }
 /** Aceita `~/pasta` ou um caminho relativo ao HOME. Com `..` segue como veio, para a validação recusar. */
 private expand(value: unknown): string {
  if (typeof value !== 'string') return value as never
  const path = value.trim()
  if (!path || path.includes('..') || isAbsolute(path) || path.startsWith('~') && !path.startsWith('~/')) return path
  return join(this.home, path.replace(/^~\//, ''))
 }
 /**
  * As contas (`<configDir>/skills`) que a base também atende. `~/.agents/skills` fica no HOME e toda conta Codex já a lê:
  * copiar também para o CODEX_HOME faria o Codex ver cada skill duas vezes.
  */
 private accountsOf(base: SkillBase): string[] { return !base.builtin || base.id === 'agents' ? [] : this.accountDirs(base.builtin).map(dir => join(dir, 'skills')) }
 private paths(base: SkillBase): string[] { return [...new Set([base.path, ...this.accountsOf(base)].map(path => this.target(path)))] }
 private target(value: string): string {
  const path = validateSkillPath(value), fromSource = relative(this.source, path), toSource = relative(path, this.source)
  if (!fromSource || !fromSource.startsWith('..') || !toSource || !toSource.startsWith('..')) throw new Error('O caminho não pode conter os recursos do próprio app nem ficar dentro deles.')
  return path
 }
 private validate(d: SkillDraft): void { if (!d || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 120 || typeof d.enabled !== 'boolean' || d.icon !== undefined && (typeof d.icon !== 'string' || d.icon.length > 80)) throw new Error('Base de skills inválida.'); this.target(d.path) }
 private persist(next: SkillBase[]): void { if (this.readOnly) throw new Error('Bases de skills em modo somente leitura: arquivo inválido ou de versão futura.'); writeEnvelopeAtomic(this.file, 'skill-bases', 1, next); this.entries = next; this.untouched = false }
 save(draft: SkillDraft): SkillBase {
  const d = draft && { ...draft, path: this.expand(draft.path) }
  this.validate(d); if (this.readOnly) throw new Error('Bases de skills em modo somente leitura.')
  const old = d.id ? this.entries.find(x => x.id === d.id) : undefined
  if (d.id && !old) throw new Error('Base não encontrada.')
  const path = this.target(d.path)
  if (this.entries.some(x => x.id !== d.id && x.path === path)) throw new Error('Outra entrada já usa este caminho.')
  const entry: SkillBase = { id: old?.id ?? randomUUID(), name: d.name.trim(), path, enabled: d.enabled, ...(d.icon ? { icon: d.icon } : {}), ...(old?.builtin ? { builtin: old.builtin } : {}) }
  if (entry.enabled) for (const target of this.paths(entry)) installSkills(this.source, target)
  const next = old ? this.entries.map(x => x.id === old.id ? entry : x) : [...this.entries, entry]
  // Desligar remove as cópias. Mudar o caminho só remove as antigas depois de o destino novo estar completo.
  if (old?.enabled && (!entry.enabled || this.complete(entry))) { const keep = this.inUse(next); for (const target of this.paths(old)) if (!keep.has(target)) uninstall(target) }
  this.persist(next); return entry
 }
 remove(id: string): void {
  const old = this.entries.find(x => x.id === id); if (!old) throw new Error('Base não encontrada.'); if (this.readOnly) throw new Error('Bases somente leitura.')
  const next = this.entries.filter(x => x.id !== id)
  if (old.enabled) { const keep = this.inUse(next); for (const target of this.paths(old)) if (!keep.has(target)) uninstall(target) }
  this.persist(next)
 }
 reorder(ids: string[]): void { if (!Array.isArray(ids) || ids.length !== this.entries.length || new Set(ids).size !== ids.length || ids.some(id => !this.entries.some(x => x.id === id))) throw new Error('Ordem inválida.'); this.persist(ids.map(id => this.entries.find(x => x.id === id)!)) }
 /** Volta à lista padrão: instala nos locais padrão e remove as cópias gerenciadas dos que saíram. */
 reset(): void {
  if (this.readOnly) throw new Error('Bases somente leitura.')
  const next = defaultBases(this.home), keep = new Set(next.flatMap(b => this.paths(b)))
  for (const target of keep) installSkills(this.source, target)
  // A base antiga do Codex tem substituta (Agent Skills): só sai com a nova completa.
  const replaced = this.complete(next.find(b => b.id === 'agents')!)
  for (const old of this.entries) if (old.enabled && (replaced || old.builtin !== 'codex' || old.id === 'agents')) for (const target of this.paths(old)) if (!keep.has(target)) uninstall(target)
  this.persist(next)
 }
 /** Cada local por si: um que falhe (um link, sem permissão) não impede os outros; o erro sobe no fim. */
 apply(): void {
  if (this.readOnly) return
  let failure: unknown
  const attempt = (job: () => void): void => { try { job() } catch (e) { failure ??= e } }
  for (const b of this.entries) if (b.enabled) attempt(() => { for (const target of this.paths(b)) attempt(() => { installSkills(this.source, target) }) })
  this.retireLegacyCodex()
  if (failure) throw failure
 }
 /**
  * O antigo padrão do Codex (`~/.codex/skills` e as contas Codex) saiu: sem lista própria, as cópias do palco saem de lá
  * para o Codex não ver cada skill duas vezes, mas só depois de Agent Skills estar completa e conferida.
  */
 private retireLegacyCodex(): void {
  const agents = this.entries.find(b => b.id === 'agents')
  if (!this.untouched || !agents?.enabled || !this.complete(agents)) return
  const keep = this.inUse(this.entries)
  for (const path of [join(this.home, '.codex/skills'), ...this.accountDirs('codex').map(dir => join(dir, 'skills'))]) {
   if (keep.has(normalize(path))) continue
   try { uninstall(path) } catch { /* um link no caminho é do usuário: não mexe */ }
  }
 }
 targets(agent: AgentKind, accountDir?: string): string[] {
  if (this.readOnly || !['claude','codex'].includes(agent)) return []
  // Hermes e Antigravity são de outros agentes: o apply() já os mantém, um terminal Claude ou Codex não precisa deles.
  const enabled = this.entries.filter(b => b.enabled && (b.builtin ? b.builtin === agent : b.id !== 'hermes' && b.id !== 'antigravity'))
  const wanted = enabled.map(b => b.path)
  if (accountDir && enabled.some(b => b.builtin === agent && b.id !== 'agents')) wanted.push(join(accountDir, 'skills'))
  // Um local recusado fica de fora; não pode impedir o terminal de abrir.
  return [...new Set(wanted.flatMap(path => { try { return [this.target(path)] } catch { return [] } }))]
 }
}
