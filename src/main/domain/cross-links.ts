import { randomUUID } from 'node:crypto'
import { readEnvelope, writeEnvelopeAtomic } from './envelope'

/** Corda entre terminais de workspaces diferentes (`recruit --workspace`): cada ponta enxerga a outra como `Nome @ Workspace`. */
export interface CrossLink { id: string; a: string; b: string }

const TYPE = 'cross-links'
const VERSION = 1

/** Cordas entre workspaces em `~/.palco/links.json`; arquivo ilegível abre vazio e somente leitura. */
export class CrossLinkStore {
  private links: CrossLink[] = []
  private readOnly = false
  constructor(private readonly file?: string) {
    if (!file) return
    try {
      const { payload, readOnly } = readEnvelope<unknown>(file, TYPE, VERSION)
      this.readOnly = readOnly
      if (Array.isArray(payload)) {
        this.links = payload.filter((l): l is CrossLink => !!l && typeof l === 'object' && typeof (l as CrossLink).id === 'string' && typeof (l as CrossLink).a === 'string' && typeof (l as CrossLink).b === 'string')
      }
    } catch { this.readOnly = true }
  }
  list(): CrossLink[] { return this.links.map((l) => ({ ...l })) }
  /** Ids ligados a `id` por corda entre workspaces. */
  peers(id: string): string[] { return this.links.flatMap((l) => (l.a === id ? [l.b] : l.b === id ? [l.a] : [])) }
  connect(a: string, b: string): void {
    if (a === b) throw new Error('autoconexão não permitida')
    if (this.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return
    this.links.push({ id: randomUUID(), a, b })
    this.save()
  }
  /** Desfaz a corda pelo id; `false` quando ela não existe (mais). */
  remove(id: string): boolean {
    const kept = this.links.filter((l) => l.id !== id)
    if (kept.length === this.links.length) return false
    this.links = kept
    this.save()
    return true
  }
  /** Some com as cordas de nós que não existem mais. */
  prune(exists: (id: string) => boolean): void {
    const kept = this.links.filter((l) => exists(l.a) && exists(l.b))
    if (kept.length === this.links.length) return
    this.links = kept
    this.save()
  }
  private save(): void {
    if (!this.file || this.readOnly) return
    writeEnvelopeAtomic(this.file, TYPE, VERSION, this.links)
  }
}

/** `"Nome @ Workspace"` → partes; sem ` @ `, `null`. */
export function splitAddress(name: string): { name: string; workspace: string } | null {
  const at = name.lastIndexOf(' @ ')
  if (at <= 0) return null
  return { name: name.slice(0, at).trim(), workspace: name.slice(at + 3).trim() }
}

/**
 * Cordas de nós que não existem mais só saem na abertura: durante a execução, o desfazer pode trazer o nó (e a corda) de volta,
 * e quem lê as cordas já ignora a ponta que sumiu. Com algum workspace incompleto, nada sai.
 */
export function pruneLinksAtStartup(links: CrossLinkStore, nodes: { node(id: string): unknown; complete: boolean }): void {
  if (nodes.complete) links.prune((id) => nodes.node(id) !== undefined)
}
