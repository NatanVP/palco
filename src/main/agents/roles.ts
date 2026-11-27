import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Role } from '../../shared/model'
import { slugFloorName } from '../domain/floor-name'
export class AgentConfigError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export function configName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new AgentConfigError(400, 'nome inválido')
  return value
}
export class RoleStore {
  private readonly problems = new Set<string>()
  /** Arquivos de role que não deu para ler (ficam fora da lista). */
  get warning(): string | undefined {
    return this.problems.size ? `roles ilegíveis ignorados: ${[...this.problems].join(', ')}` : undefined
  }
  constructor(private readonly dir: string) {}
  private slug(name: string): string { try { return slugFloorName(configName(name)) } catch { throw new AgentConfigError(400, 'nome de role inválido: use letras a-z, números e hífen') } }
  canonical(name: string): string { return this.slug(name) }
  file(name: string): string { return join(this.dir, this.slug(name) + '.md') }
  list(): Role[] {
    if (!existsSync(this.dir)) return []
    let names: string[]
    try { names = readdirSync(this.dir) } catch { this.problems.add(this.dir); return [] }
    const out: Role[] = []
    for (const n of names.filter(n => /^[a-z0-9-]+\.md$/.test(n)).sort()) {
      try {
        out.push(this.get(n.slice(0, -3)))
        this.problems.delete(n)
      } catch { this.problems.add(n) }
    }
    return out
  }
  get(name: string): Role {
    const slug = this.slug(name), file = this.file(name)
    if (!existsSync(file)) throw new AgentConfigError(404, 'role não encontrado')
    return { name: slug, text: readFileSync(file, 'utf8') }
  }
  resolve(name: string): { file: string; text: string } { return { file: this.file(name), text: this.get(name).text } }
  create(name: string, text: string): void {
    if (existsSync(this.file(name))) throw new AgentConfigError(409, 'role já existe')
    this.write(name, text)
  }
  edit(name: string, text: string): void { this.get(name); this.write(name, text) }
  remove(name: string): void {
    this.get(name)
    const details = this.readDetails(), slug = this.slug(name)
    if (Object.hasOwn(details, slug)) { delete details[slug]; writeEnvelopeAtomic(join(this.dir, 'details.json'), 'role-details', 1, details) }
    this.setScope(name, null); rmSync(this.file(name))
  }

  /** Escopo (skill palco-manager): id do workspace a que o role se restringe, ou `null` = global. Em `scopes.json`. */
  scopeOf(name: string): string | null { const scopes = this.readScopes(), slug = this.slug(name); return Object.hasOwn(scopes, slug) ? scopes[slug]! : null }
  setScope(name: string, workspaceId: string | null): void {
    const scopes = this.readScopes(), slug = this.slug(name)
    if (workspaceId === null) delete scopes[slug]
    else scopes[slug] = workspaceId
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const file = join(this.dir, 'scopes.json'), temp = file + '.' + randomUUID() + '.tmp'
    try { writeFileSync(temp, JSON.stringify(scopes), { mode: 0o600 }); renameSync(temp, file) } finally { rmSync(temp, { force: true }) }
  }
  /** Visível no workspace: global ou restrito a ele. */
  visibleIn(name: string, workspaceId: string | undefined): boolean {
    const scope = this.scopeOf(name)
    return scope === null || scope === workspaceId
  }
  private readScopes(): Record<string, string> {
    try {
      const v: unknown = JSON.parse(readFileSync(join(this.dir, 'scopes.json'), 'utf8'))
      if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
      return Object.fromEntries(Object.entries(v).filter(([, w]) => typeof w === 'string')) as Record<string, string>
    } catch { return {} }
  }
  /** UI labels/styles keep the canonical role identifier stable for CLI, presets and partituras. */
  details(name: string): { displayName?: string; icon?: string; color?: string } {
    const values = this.readDetails(), slug = this.slug(name)
    return Object.hasOwn(values, slug) ? values[slug]! : {}
  }
  setDetails(name: string, detail: { displayName: string; icon?: string; color?: string }): void {
    const values = this.readDetails()
    values[this.slug(name)] = detail
    writeEnvelopeAtomic(join(this.dir, 'details.json'), 'role-details', 1, values)
  }
  private readDetails(): Record<string, { displayName?: string; icon?: string; color?: string }> {
    const e = readEnvelope<Record<string, { displayName?: string; icon?: string; color?: string }>>(join(this.dir, 'details.json'), 'role-details', 1)
    if (e.readOnly || e.payload !== null && (typeof e.payload !== 'object' || Array.isArray(e.payload))) throw new Error('Metadados das responsabilidades inválidos ou de versão futura; arquivo preservado.')
    for (const value of Object.values(e.payload ?? {})) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.displayName !== undefined && typeof value.displayName !== 'string' || value.icon !== undefined && typeof value.icon !== 'string' || value.color !== undefined && (typeof value.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(value.color))) throw new Error('Metadados de responsabilidade inválidos; arquivo preservado.')
    }
    return e.payload ?? {}
  }
  private write(name: string, text: string): void {
    if (typeof text !== 'string' || text.length > 1_000_000) throw new AgentConfigError(400, 'texto de role inválido')
    const file = this.file(name), temp = file + '.' + randomUUID() + '.tmp'
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    try {
      const fd = openSync(temp, 'wx', 0o600)
      try { writeFileSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temp, file)
      const parent = openSync(this.dir, 'r')
      try { fsyncSync(parent) } finally { closeSync(parent) }
    } finally { rmSync(temp, { force: true }) }
  }
}
