import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentKind, Partitura } from '../../shared/model'
import { invalidTerminalExtras, takesRole } from '../domain/terminal-extras'
import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'
import { slugFloorName } from '../domain/floor-name'
import { normalizeAgentCommand } from '../domain/command'
import { AgentConfigError, configName } from '../agents/roles'
import { environmentLabel, validateEnvironment } from '../../shared/environment'
import type { PartituraReview } from '../../shared/partitura-review'
import { isPortalUrl } from '../security'
import { isWebUrl } from '../../shared/link'
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export function validatePartitura(value: unknown): Partitura {
  const fail = (): never => { throw new AgentConfigError(400, 'partitura inválida') }
  if (!obj(value) || typeof value.name !== 'string' || !value.name.trim() || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || (value.description !== undefined && typeof value.description !== 'string') || (value.imported !== undefined && value.imported !== true) || !Array.isArray(value.nodes) || !Array.isArray(value.connections) || !Array.isArray(value.bands)) return fail()
  const keys = new Map<string, Record<string, unknown>>()
  for (const n of value.nodes) {
    if (!obj(n) || typeof n.key !== 'string' || !n.key || keys.has(n.key) || typeof n.name !== 'string' || !n.name.trim()
      || !obj(n.pos) || !finite(n.pos.x) || !finite(n.pos.y) || !obj(n.size) || !finite(n.size.w) || !finite(n.size.h) || n.size.w <= 0 || n.size.h <= 0) return fail()
    keys.set(n.key, n)
    if (n.kind === 'terminal') {
      if (typeof n.agent !== 'string' || !['claude', 'codex', 'antigravity', 'shell', 'other'].includes(n.agent) || typeof n.command !== 'string' || typeof n.cwd !== 'string'
        || (n.role !== undefined && (typeof n.role !== 'string' || !n.role.trim() || !takesRole(n.agent)))
        || invalidTerminalExtras(n).length > 0) return fail()
      normalizeAgentCommand(n.agent as AgentKind, n.command)
    } else if (n.kind === 'note') { if (typeof n.content !== 'string') return fail() }
    else if (n.kind === 'portal') { if (typeof n.url !== 'string') return fail() }
    else if (n.kind === 'text') { if (typeof n.text !== 'string' || !finite(n.fontSize) || n.fontSize <= 0) return fail() }
    else if (n.kind === 'file') { if (typeof n.path !== 'string') return fail() }
    else if (n.kind === 'filetree') { if (typeof n.root !== 'string') return fail() }
    else if (n.kind === 'link') { if (!isWebUrl(n.url)) return fail() }
    else if (n.kind === 'band') { if (!Array.isArray(n.members) || !n.members.length || !n.members.every((m: unknown) => typeof m === 'string')) return fail() }
    else return fail()
  }
  for (const n of keys.values()) if (n.kind === 'band' && !(n.members as string[]).every(key => keys.get(key)?.kind === 'terminal')) return fail()
  for (const c of value.connections) if (!obj(c) || typeof c.a !== 'string' || typeof c.b !== 'string' || !keys.has(c.a) || !keys.has(c.b) || c.a === c.b
    || (keys.get(c.a)?.kind === 'band' && keys.get(c.b)?.kind === 'band')) return fail()
  const bands = new Set<string>()
  for (const b of value.bands) {
    if (!obj(b) || typeof b.name !== 'string' || !b.name.trim() || bands.has(b.name) || !Array.isArray(b.members) || !b.members.length || !b.members.every(m => typeof m === 'string' && keys.get(m)?.kind === 'terminal')) return fail()
    bands.add(b.name)
    const nodes = [...keys.values()].filter(n => n.kind === 'band' && n.name === b.name)
    if (nodes.length > 1 || (nodes.length === 1 && JSON.stringify(nodes[0]!.members) !== JSON.stringify(b.members))) return fail()
  }
  return structuredClone(value) as unknown as Partitura
}
/** Campos que são desta máquina ou decidem a inicialização: um arquivo de fora não os define. */
const NOT_FROM_FILES = ['id', 'accountId', 'recruitedBy', 'autoStart', 'unloaded', 'linkedFile', 'fileMissing', 'current'] as const
function fromFile(value: unknown): Partitura {
  const p = validatePartitura(value), fail = (): never => { throw new AgentConfigError(400, 'partitura inválida') }
  for (const node of p.nodes as unknown as Array<Record<string, unknown>>) {
    for (const field of NOT_FROM_FILES) delete node[field]
    if (node.kind === 'portal' && !isPortalUrl(node.url as string)) fail()
    for (const path of [node.cwd, node.path, node.root]) if (typeof path === 'string' && /[\u0000-\u001f\u007f]/.test(path)) fail()
  }
  return { ...p, name: configName(p.name), imported: true }
}
export function reviewPartitura(p: Partitura): PartituraReview {
  return {
    name: p.name, imported: p.imported === true,
    terminals: p.nodes.flatMap(n => {
      if (n.kind !== 'terminal') return []
      const environment = validateEnvironment(n.environment), remote = environment.kind !== 'local' && environment.kind !== 'tmux'
      return [{ name: n.name, agent: n.agent, command: normalizeAgentCommand(n.agent, n.command), cwd: n.cwd, environment: remote ? `${environment.kind} · ${environmentLabel(environment)}` : environment.kind, ...(environment.kind === 'docker' || environment.kind === 'sandbox' ? { environmentUser: environment.user } : {}), maestro: n.maestro === true, ...(n.role === undefined ? {} : { role: n.role }) }]
    }),
    portals: p.nodes.flatMap(n => (n.kind === 'portal' ? [n.url] : [])),
    paths: p.nodes.flatMap(n => (n.kind === 'file' ? [n.path] : n.kind === 'filetree' ? [n.root] : []))
  }
}
export class PartituraStore {
  private readonly problems = new Set<string>()
  /** Partituras ilegíveis ou inválidas (ficam fora da lista e das buscas). */
  get warning(): string | undefined {
    return this.problems.size ? `partituras ilegíveis ignoradas: ${[...this.problems].join(', ')}` : undefined
  }
  constructor(private readonly dir: string) {}
  private file(name: string): string { return join(this.dir, slugFloorName(configName(name)) + '.json') }
  /** Partituras legíveis; as ruins são ignoradas com aviso, nunca derrubam a lista. */
  private readable(): Partitura[] {
    if (!existsSync(this.dir)) return []
    let names: string[]
    try { names = readdirSync(this.dir) } catch { this.problems.add(this.dir); return [] }
    const out: Partitura[] = []
    for (const n of names.filter(n => /^[a-z0-9-]+\.json$/.test(n)).sort()) {
      try {
        out.push(this.get(n.slice(0, -5)))
        this.problems.delete(n)
      } catch { this.problems.add(n) }
    }
    return out
  }
  list(): Array<Pick<Partitura, 'name' | 'description' | 'createdAt'>> {
    return this.readable().map(p => ({ name: p.name, ...(p.description === undefined ? {} : { description: p.description }), createdAt: p.createdAt }))
  }
  get(name: string): Partitura {
    const envelope = readEnvelope<unknown>(this.file(name), 'partitura', 1)
    if (envelope.payload === null) throw new AgentConfigError(404, 'partitura não encontrada')
    if (envelope.readOnly) throw new AgentConfigError(409, 'partitura de versão futura')
    return validatePartitura(envelope.payload)
  }
  save(value: Partitura): void {
    const p = validatePartitura(value), file = this.file(p.name)
    if (existsSync(file)) throw new AgentConfigError(409, 'partitura já existe')
    writeEnvelopeAtomic(file, 'partitura', 1, p)
  }
  rename(name: string, next: string): void {
    const current = this.get(name), renamed = { ...current, name: configName(next) }
    if (this.file(name) === this.file(next)) { writeEnvelopeAtomic(this.file(name), 'partitura', 1, renamed); return }
    this.save(renamed)
    this.remove(name)
  }
  export(name?: string): string {
    const partituras = (name === undefined ? this.readable() : [this.get(name)]).map(({ imported: _, ...p }) => p)
    return JSON.stringify({ format: 'palco-partituras', version: 1, partituras }, null, 2)
  }
  /** Lê e confere o arquivo inteiro, sem gravar. */
  private parseImport(document: string): Partitura[] {
    let data: { format?: unknown; version?: unknown; partituras?: unknown }
    try { data = JSON.parse(document) } catch { throw new AgentConfigError(400, 'arquivo inválido') }
    if (data?.format !== 'palco-partituras' || data.version !== 1 || !Array.isArray(data.partituras)) throw new AgentConfigError(400, 'arquivo inválido')
    const items = data.partituras.map(fromFile), files = new Set<string>()
    for (const p of items) {
      const file = this.file(p.name)
      if (files.has(file) || existsSync(file)) throw new AgentConfigError(409, 'partitura já existe')
      files.add(file)
    }
    return items
  }
  reviewImport(document: string): PartituraReview[] { return this.parseImport(document).map(reviewPartitura) }
  /** Toda ou nada: se uma gravação falha, as que esta importação criou saem. */
  import(document: string): void {
    const created: string[] = []
    try {
      for (const p of this.parseImport(document)) { created.push(this.file(p.name)); this.save(p) }
    } catch (error) {
      for (const file of created) { rmSync(file, { force: true }); rmSync(`${file}.bak`, { force: true }) }
      throw error
    }
  }
  /** Os comandos foram confirmados: passa a valer como uma salva aqui. */
  trust(name: string): void {
    const { imported, ...p } = this.get(name)
    if (imported) writeEnvelopeAtomic(this.file(name), 'partitura', 1, p)
  }
  usesRole(name: string): boolean {
    const slug = slugFloorName(name)
    return this.readable().some(p => p.nodes.some(n => n.kind === 'terminal' && n.role !== undefined && slugFloorName(n.role) === slug))
  }
  /** Keep saved layouts runnable after GUI responsibility deletion. */
  clearRole(name: string): void {
    const slug = slugFloorName(name)
    for (const p of this.readable()) {
      if (!p.nodes.some(n => n.kind === 'terminal' && n.role && slugFloorName(n.role) === slug)) continue
      const nodes = p.nodes.map(n => { if (n.kind !== 'terminal' || !n.role || slugFloorName(n.role) !== slug) return n; const { role: _role, ...rest } = n; return rest })
      writeEnvelopeAtomic(this.file(p.name), 'partitura', 1, { ...p, nodes })
    }
  }
  remove(name: string): void { this.get(name); rmSync(this.file(name)) }
}
