import type { FloorId, Partitura, TerminalNode, Vec } from '../../shared/model'
import type { PartituraItem, PartituraUpdatePreview } from '../../shared/partitura-review'
import type { WorkspaceStore } from '../domain/workspace-store'
import type { AgentCatalog } from '../agents/presets'
import { AgentConfigError, configName } from '../agents/roles'
import { capturePartitura, insertPartitura } from './insert'
import { localName, resolveTarget } from '../domain/reachability'
import { PartituraStore } from './partitura-store'
export function savePartitura(lib: PartituraStore, store: WorkspaceStore, name: string, floorId: FloorId, opts: { description?: string; noteText: boolean; only?: Set<string>; ids?: Set<string>; commands?: boolean }): void {
  if (typeof opts.noteText !== 'boolean' || (opts.description !== undefined && typeof opts.description !== 'string')) throw new AgentConfigError(400, 'opções inválidas')
  lib.save({ ...capturePartitura(store.get(), floorId, opts), name: configName(name), ...(opts.description === undefined ? {} : { description: opts.description }), createdAt: new Date().toISOString() })
}
/** A partitura como ficaria se fosse regravada com os nós escolhidos. */
function recapture(current: Partitura, store: WorkspaceStore, floorId: FloorId, opts: { noteText: boolean; ids: Set<string> }): Partitura {
  const fresh = { ...capturePartitura(store.get(), floorId, opts), name: current.name, ...(current.description === undefined ? {} : { description: current.description }), createdAt: new Date().toISOString() }
  if (!fresh.nodes.length) throw new AgentConfigError(400, 'nada selecionado para a partitura')
  return fresh
}
/** Regrava uma partitura salva com o que se escolheu agora; a antiga só sai se a nova puder ser gravada. */
export function updatePartitura(lib: PartituraStore, store: WorkspaceStore, name: string, floorId: FloorId, opts: { noteText: boolean; ids: Set<string> }): void {
  const current = lib.get(name), fresh = recapture(current, store, floorId, opts)
  lib.remove(current.name)
  try { lib.save(fresh) } catch (e) { lib.save(current); throw e }
}
/** O que a atualização faria, sem gravar. Os itens são pareados por tipo e nome; posição e tamanho não contam como mudança. */
export function previewUpdate(lib: PartituraStore, store: WorkspaceStore, name: string, floorId: FloorId, opts: { noteText: boolean; ids: Set<string> }): PartituraUpdatePreview {
  const current = lib.get(name), fresh = recapture(current, store, floorId, opts)
  const content = (p: Partitura, node: Partitura['nodes'][number]): string => {
    const { key: _key, pos: _pos, size: _size, floorId: _floor, ...rest } = node
    const value = (rest.kind === 'band' ? { ...rest, members: rest.members.map(m => p.nodes.find(n => n.key === m)?.name).sort() } : rest) as Record<string, unknown>
    return JSON.stringify(Object.keys(value).sort().map(k => [k, value[k]]))
  }
  const item = ({ kind, name }: PartituraItem): PartituraItem => ({ kind, name })
  const left = [...current.nodes], added: PartituraItem[] = [], changed: PartituraItem[] = []
  for (const node of fresh.nodes) {
    const at = left.findIndex(n => n.kind === node.kind && n.name === node.name)
    if (at < 0) { added.push(item(node)); continue }
    const [old] = left.splice(at, 1)
    if (content(current, old!) !== content(fresh, node)) changed.push(item(node))
  }
  return { name: current.name, before: current.nodes.length, after: fresh.nodes.length, connections: [current.connections.length, fresh.connections.length], removed: left.map(item), added, changed }
}
/** Partitura importada com terminal só inicia comandos depois de a pessoa vê-los e confirmar (no painel). */
export function assertConfirmed(p: Partitura, commands: boolean, confirmed: boolean): void {
  if (commands && !confirmed && p.imported && p.nodes.some(n => n.kind === 'terminal')) throw new AgentConfigError(409, 'partitura importada: confirme os comandos no painel de Partituras ou insira sem iniciar')
}
/** Coloca a partitura e devolve os ids dos nós criados. */
export function startPartitura(lib: PartituraStore, store: WorkspaceStore, name: string, floorId: FloorId, origin: Vec, commands: boolean, spawn: (node: TerminalNode) => void, agents?: AgentCatalog, dispose?: (id: string) => void, confirmed = false): string[] {
  if (typeof commands !== 'boolean') throw new AgentConfigError(400, 'commands deve ser booleano')
  if (commands && !dispose) throw new AgentConfigError(501, 'encerramento de terminais indisponível')
  const p = lib.get(name)
  assertConfirmed(p, commands, confirmed)
  for (const node of p.nodes) if (node.kind === 'terminal' && node.role) {
    if (!agents) { if (commands) throw new AgentConfigError(501, 'roles indisponíveis'); continue }
    try { node.role = agents.roles.get(node.role).name }
    catch (e) { if (commands || !(e instanceof AgentConfigError) || e.status !== 404) throw e }
  }
  const before = new Set(Object.keys(store.get().nodes))
  const ids = insertPartitura(store, p, floorId, origin, { commands })
  const created = Object.keys(store.get().nodes).filter(id => !before.has(id)), attempted: string[] = []
  try {
    for (const id of ids) { const node = store.get().nodes[id]; if (node?.kind === 'terminal') { attempted.push(id); spawn(node) } }
  } catch (e) {
    const retained = new Set<string>()
    for (const id of attempted) { try { dispose!(id) } catch { retained.add(id) } }
    for (const id of created.reverse()) if (!retained.has(id)) store.removeNode(id, { force: true })
    if (retained.size) throw new AgentConfigError(500, 'falha ao iniciar e encerrar agentes; os terminais que exigem limpeza foram mantidos no canvas')
    throw e
  }
  if (commands && p.imported) lib.trust(name)
  return created
}
type Ctx = { caller: TerminalNode; body: Record<string, unknown>; url: URL }
export interface PartituraRouteOptions {
  /** Store de outro workspace pelo nome (`insert --workspace`). */
  workspaceStore?(name: string): WorkspaceStore | undefined
  /** Corda entre workspaces (inserir com --workspace conecta você a ela). */
  crossLink?(a: string, b: string): void
}
export function createPartituraRoutes(lib: PartituraStore, store: WorkspaceStore, spawn: (node: TerminalNode) => void, agents?: AgentCatalog, dispose?: (id: string) => void, opts: PartituraRouteOptions = {}): Record<string, (ctx: Ctx) => { status: number; body: string; type?: 'application/json' }> {
  const ok = (body = 'OK') => ({ status: 200, body })
  const bool = (v: unknown, fallback: boolean | undefined, flag: string): boolean | undefined => {
    if (v === undefined) return fallback
    if (typeof v !== 'boolean') throw new AgentConfigError(400, `${flag} aceita on ou off`)
    return v
  }
  /** Você (a menos que --without-me) e os agentes citados, todos no seu andar e ligados a você. Sem nomes: o andar inteiro. */
  const team = (ctx: Ctx): Set<string> | undefined => {
    const raw = ctx.body.agents
    const names = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
    if (names.length === 0 && ctx.body.withoutMe !== true) return undefined
    const ws = store.get(), ids = new Set<string>()
    if (ctx.body.withoutMe !== true) ids.add(ctx.caller.id)
    for (const n of names) {
      const r = localName(n).toLowerCase() === ctx.caller.name.toLowerCase() ? { ok: true as const, node: ctx.caller } : resolveTarget(ws, ctx.caller.id, n)
      if (!r.ok || r.node.kind !== 'terminal' || r.node.floorId !== ctx.caller.floorId) throw new AgentConfigError(404, `agente '${n}' não encontrado no seu andar`)
      ids.add(r.node.id)
    }
    if (ids.size === 0) throw new AgentConfigError(400, 'partitura sem agentes: cite ao menos um ou não use --without-me')
    return ids
  }
  return {
    'GET /partitura/list': () => ({ status: 200, body: JSON.stringify(lib.list()), type: 'application/json' }),
    'POST /partitura/create': ctx => {
      const only = team(ctx)
      savePartitura(lib, store, configName(ctx.body.name), ctx.caller.floorId, { noteText: bool(ctx.body.noteText, true, '--note-text')!, commands: bool(ctx.body.commands, true, '--commands')!, ...(ctx.body.description === undefined ? {} : { description: ctx.body.description as string }), ...(only ? { only } : {}) })
      return ok()
    },
    'POST /partitura/update': ctx => {
      const current = lib.get(configName(ctx.body.name))
      const only = team(ctx)
      const newName = ctx.body.newName === undefined ? current.name : configName(ctx.body.newName)
      const description = ctx.body.description === undefined ? current.description : String(ctx.body.description)
      const noteText = bool(ctx.body.noteText, true, '--note-text')!
      // Recaptura o time atual no seu andar; a antiga só sai depois que a nova foi validada.
      const fresh = { ...capturePartitura(store.get(), ctx.caller.floorId, { noteText, commands: bool(ctx.body.commands, true, '--commands')!, ...(only ? { only } : {}) }), name: newName, ...(description === undefined ? {} : { description }), createdAt: new Date().toISOString() }
      lib.remove(current.name)
      try { lib.save(fresh) } catch (e) { lib.save(current); throw e }
      return ok()
    },
    'POST /partitura/insert': ctx => {
      let target = store
      if (ctx.body.workspace !== undefined) {
        const found = opts.workspaceStore?.(configName(ctx.body.workspace))
        if (!found) throw new AgentConfigError(404, 'workspace não encontrado')
        target = found
      }
      const other = target !== store
      let floorId = other ? null : ctx.caller.floorId
      if (ctx.body.floor !== undefined) {
        const floor = configName(ctx.body.floor)
        floorId = floor.toLowerCase() === 'ground' ? null : target.findFloorByName(floor)?.id ?? (() => { throw new AgentConfigError(404, 'floor não encontrado') })()
        if (!other && ctx.caller.floorId !== null && ctx.caller.floorId !== floorId) throw new AgentConfigError(403, 'só o Ground pode inserir em outro floor')
      }
      const origin = !other && floorId === ctx.caller.floorId ? { x: ctx.caller.pos.x + ctx.caller.size.w + 80, y: ctx.caller.pos.y } : { x: 0, y: 0 }
      const created = startPartitura(lib, target, configName(ctx.body.name), floorId, origin, bool(ctx.body.commands, true, '--commands')!, spawn, agents, dispose)
      const ws = target.get()
      const agentsIn = created.map(id => ws.nodes[id]).filter((n): n is TerminalNode => n?.kind === 'terminal')
      // Conecta você a ela: só aos Maestros dela, quando houver (corda só no mesmo workspace).
      const maestros = agentsIn.filter(n => n.maestro === true)
      for (const n of maestros.length ? maestros : agentsIn) {
        if (!other) target.connect(ctx.caller.id, n.id)
        else opts.crossLink?.(ctx.caller.id, n.id)
      }
      return ok(`OK: partitura colocada; agentes: ${agentsIn.map(n => n.name).join(', ') || '(nenhum)'}`)
    },
    'POST /partitura/delete': ctx => { lib.remove(configName(ctx.body.name)); return ok() }
  }
}
