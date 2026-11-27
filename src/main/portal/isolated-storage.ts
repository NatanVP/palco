import { existsSync } from 'node:fs'
import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'
import type { WorkspaceRegistry } from '../domain/workspace-registry'
import { portalPartitionFor } from '../../shared/portal-settings'
import type { CanvasNode, PortalNode } from '../../shared/model'

export interface PortalCensus { ids: string[]; complete: boolean }
/** Os portais isolados que existem agora, e se dá para confiar na lista (nenhum workspace ilegível ou reparado). */
export function portalCensus(registry: WorkspaceRegistry): PortalCensus {
  const isolated = (n: CanvasNode): n is PortalNode => n.kind === 'portal' && n.storage === 'isolated'
  return { ids: registry.openStores().flatMap((s) => s.pick(isolated).map((n) => n.id)), complete: registry.complete() }
}

const TYPE = 'isolated-portals'
/**
 * Sessões dos portais "isolados". A de um portal apagado só sai na abertura seguinte: nesta, o desfazer ainda pode trazê-lo
 * de volta com o login. Só se limpa o que este armazenamento já viu existir, então trocar a raiz de dados não apaga nada.
 */
export class IsolatedPortalStorage {
  private readonly seen = new Set<string>()
  private broken = false
  constructor(private readonly file: string, private readonly census: () => PortalCensus, private readonly clear: (partition: string) => Promise<void>) {
    if (!existsSync(file)) return
    try {
      const { payload, readOnly } = readEnvelope<unknown>(file, TYPE, 1)
      this.broken = readOnly
      if (Array.isArray(payload)) for (const id of payload) if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)) this.seen.add(id)
    } catch { this.broken = true }
  }
  /** Chamado na abertura, antes de qualquer portal existir no histórico desta execução. */
  async sweep(): Promise<void> {
    const { ids, complete } = this.census()
    if (this.broken || !complete) return
    const alive = new Set(ids)
    for (const id of [...this.seen].filter((x) => !alive.has(x))) {
      try { await this.clear(portalPartitionFor('isolated', id, '')); this.seen.delete(id); this.save() }
      catch (error) { console.warn('palco: sessão de portal não limpa; nova tentativa na próxima abertura:', error instanceof Error ? error.message : error) }
    }
    this.note()
  }
  /** Anota os portais isolados que existem agora. */
  note(): void {
    if (this.broken) return
    const fresh = this.census().ids.filter((id) => !this.seen.has(id))
    if (!fresh.length) return
    for (const id of fresh) this.seen.add(id)
    this.save()
  }
  private save(): void { writeEnvelopeAtomic(this.file, TYPE, 1, [...this.seen].sort()) }
}
