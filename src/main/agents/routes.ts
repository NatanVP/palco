import type { PartituraStore } from '../partituras/partitura-store'
import type { AccountStore } from '../accounts/account-store'
import type { CanvasNode, Preset, TerminalNode } from '../../shared/model'
import type { WorkspaceStore } from '../domain/workspace-store'
import { localName, resolveTarget } from '../domain/reachability'
import { AgentCatalog } from './presets'
import { takesRole } from '../domain/terminal-extras'
import { AgentConfigError, configName } from './roles'
type Ctx = { caller: TerminalNode; body: Record<string, unknown>; url: URL }
type Reply = { status: number; body: string; type?: 'application/json' }
export interface AgentRouteOptions {
  /** `role delete --force`: tira o role de um terminal de qualquer workspace. */
  unassignRole?(nodeId: string): void
  accounts?: Pick<AccountStore, 'list' | 'byName'>
  /** Workspace do chamador: roles `--scope current` ficam restritos a ele. */
  workspaceId?: () => string | undefined
}
const DEFAULT_ACCOUNT = 'default'
const PREVIEW = 120
/** `allNodes`: nós de todos os workspaces (um role em uso em qualquer um deles não pode ser apagado). */
export function createAgentRoutes(catalog: AgentCatalog, store: WorkspaceStore, partituras?: Pick<PartituraStore, 'usesRole'> & Partial<Pick<PartituraStore, 'clearRole'>>, allNodes: () => Record<string, CanvasNode> = () => store.get().nodes, opts: AgentRouteOptions = {}): Record<string, (ctx: Ctx) => Reply> {
  const json = (value: unknown): Reply => ({ status: 200, body: JSON.stringify(value), type: 'application/json' as const })
  const ok = (body = 'OK'): Reply => ({ status: 200, body })
  const name = (ctx: Ctx) => configName(ctx.body.name ?? ctx.url.searchParams.get('name'))
  const ws = (): string | undefined => opts.workspaceId?.()
  const onOff = (v: unknown, flag: string): boolean | undefined => {
    if (v === undefined) return undefined
    if (typeof v !== 'boolean') throw new AgentConfigError(400, `${flag} aceita on ou off`)
    return v
  }
  /** Contas do CLI do preset: nomes aceitos por `--account` ("Default" é o login padrão). */
  const accountsFor = (agent: Preset['agent']): string[] => {
    if (!opts.accounts || (agent !== 'claude' && agent !== 'codex' && agent !== 'antigravity')) return []
    const own = opts.accounts.list().filter(a => a.agent === agent).map(a => a.name)
    return own.length ? ['Default', ...own] : []
  }
  /** Conta do preset: nome existente do mesmo CLI, ou "Default" (= sem conta fixa). */
  const account = (v: unknown, agent: Preset['agent']): string | null | undefined => {
    if (v === undefined) return undefined
    const wanted = configName(v)
    if (wanted.toLowerCase() === DEFAULT_ACCOUNT) return null
    if (agent !== 'claude' && agent !== 'codex' && agent !== 'antigravity') throw new AgentConfigError(400, 'conta só vale para presets do Claude Code ou do Codex')
    const found = opts.accounts?.byName(wanted)
    if (!found || found.agent !== agent) throw new AgentConfigError(404, `conta '${wanted}' não existe para ${agent}; válidas: ${accountsFor(agent).join(', ') || 'Default'}`)
    return found.name
  }
  const presetView = (p: Preset) => {
    const names = accountsFor(p.agent)
    return { ...p, ...(names.length ? { accounts: names } : {}) }
  }
  /** Role visível no workspace do chamador (global ou restrito a ele). */
  const role = (raw: unknown) => {
    const found = catalog.roles.get(configName(raw))
    if (!catalog.roles.visibleIn(found.name, ws())) throw new AgentConfigError(404, 'role não encontrado')
    return found
  }
  const scopeOf = (v: unknown): 'current' | 'global' | undefined => {
    if (v === undefined) return undefined
    if (v !== 'current' && v !== 'global') throw new AgentConfigError(400, 'scope aceita current ou global')
    return v
  }
  const applyScope = (roleName: string, scope: 'current' | 'global'): void => {
    if (scope === 'global') return catalog.roles.setScope(roleName, null)
    const id = ws()
    if (id === undefined) throw new AgentConfigError(400, 'sem workspace atual: use --scope global')
    catalog.roles.setScope(roleName, id)
  }
  return {
    'GET /preset/list': () => json(catalog.presets.list().map(presetView)),
    'GET /preset/show': (ctx: Ctx) => json(presetView(catalog.presets.get(name(ctx)))),
    'POST /preset/create': (ctx: Ctx) => {
      const command = typeof ctx.body.command === 'string' ? ctx.body.command : ''
      const agent = ctx.body.agent as TerminalNode['agent'] | undefined
      const draft = catalog.presets.create({
        name: name(ctx), command, ...(agent === undefined ? {} : { agent }),
        ...(ctx.body.role === undefined ? {} : { role: role(ctx.body.role).name }),
        ...(onOff(ctx.body.maestro, '--maestro') === undefined ? {} : { maestro: ctx.body.maestro as boolean }),
        ...(onOff(ctx.body.chat, '--chat') === undefined ? {} : { startInChat: ctx.body.chat as boolean }),
        ...(onOff(ctx.body.quickStart, '--quick-start') === undefined ? {} : { quickStart: ctx.body.quickStart as boolean })
      })
      if (ctx.body.account === undefined) return json(presetView(draft))
      try {
        const acc = account(ctx.body.account, draft.agent)
        return json(presetView(catalog.presets.set(draft.name, { account: acc })))
      } catch (e) { catalog.presets.remove(draft.name); throw e }
    },
    'POST /preset/set': (ctx: Ctx) => {
      const current = catalog.presets.get(name(ctx))
      const command = ctx.body.command === undefined ? undefined : typeof ctx.body.command === 'string' ? ctx.body.command : (() => { throw new AgentConfigError(400, 'command inválido') })()
      const patch = {
        ...(ctx.body.newName === undefined ? {} : { newName: configName(ctx.body.newName) }),
        ...(command === undefined ? {} : { command }),
        ...(onOff(ctx.body.maestro, '--maestro') === undefined ? {} : { maestro: ctx.body.maestro as boolean }),
        ...(onOff(ctx.body.chat, '--chat') === undefined ? {} : { startInChat: ctx.body.chat as boolean }),
        ...(onOff(ctx.body.quickStart, '--quick-start') === undefined ? {} : { quickStart: ctx.body.quickStart as boolean })
      }
      const updated = catalog.presets.set(current.name, patch)
      if (ctx.body.account === undefined) return json(presetView(updated))
      return json(presetView(catalog.presets.set(updated.name, { account: account(ctx.body.account, updated.agent) })))
    },
    'POST /preset/delete': (ctx: Ctx) => { catalog.presets.remove(name(ctx)); return ok() },
    'GET /role/list': () => {
      const visible = catalog.roles.list().filter(r => catalog.roles.visibleIn(r.name, ws()))
      const view = (r: { name: string; text: string }) => ({ name: r.name, preview: r.text.length > PREVIEW ? `${r.text.slice(0, PREVIEW)}…` : r.text })
      return json({
        current: visible.filter(r => catalog.roles.scopeOf(r.name) !== null).map(view),
        global: visible.filter(r => catalog.roles.scopeOf(r.name) === null).map(view)
      })
    },
    'GET /role/show': (ctx: Ctx) => {
      const r = role(name(ctx))
      return json({ ...r, scope: catalog.roles.scopeOf(r.name) === null ? 'global' : 'current' })
    },
    'POST /role/create': (ctx: Ctx) => {
      const roleName = name(ctx)
      // Novos ficam restritos ao workspace atual por padrão (skill palco-manager).
      const scope = scopeOf(ctx.body.scope) ?? (ws() === undefined ? 'global' : 'current')
      catalog.roles.create(roleName, ctx.body.text as string)
      try { applyScope(roleName, scope) } catch (e) { catalog.roles.remove(roleName); throw e }
      return ok(`OK: role ${catalog.roles.canonical(roleName)} criado (${scope === 'global' ? 'global' : 'só neste workspace'})`)
    },
    'POST /role/edit': (ctx: Ctx) => {
      const r = role(name(ctx))
      const scope = scopeOf(ctx.body.scope)
      if (typeof ctx.body.text === 'string') {
        catalog.roles.edit(r.name, ctx.body.text)
      } else if (ctx.body.old !== undefined || ctx.body.new !== undefined) {
        if (typeof ctx.body.old !== 'string' || typeof ctx.body.new !== 'string' || ctx.body.old === '') throw new AgentConfigError(400, 'role edit precisa de "texto antigo" e "texto novo"')
        const at = r.text.indexOf(ctx.body.old)
        if (at === -1) throw new AgentConfigError(404, 'texto antigo não encontrado no role')
        catalog.roles.edit(r.name, r.text.slice(0, at) + ctx.body.new + r.text.slice(at + ctx.body.old.length))
      } else if (scope === undefined) throw new AgentConfigError(400, 'role edit precisa de um trecho ou de --scope')
      if (scope !== undefined) applyScope(r.name, scope)
      return ok('OK: vale a partir do próximo reinício de quem usa o role')
    },
    'POST /role/write': (ctx: Ctx) => {
      const r = role(name(ctx))
      if (typeof ctx.body.text !== 'string') throw new AgentConfigError(400, 'role write precisa do prompt novo')
      catalog.roles.edit(r.name, ctx.body.text)
      return ok('OK: vale a partir do próximo reinício de quem usa o role')
    },
    'POST /role/delete': (ctx: Ctx) => {
      const r = role(name(ctx))
      const wearing = Object.values(allNodes()).filter(n => n.kind === 'terminal' && n.role !== undefined && catalog.roles.canonical(n.role) === r.name)
      if (catalog.presets.list().some(p => p.role !== undefined && catalog.roles.canonical(p.role) === r.name) || wearing.length || partituras?.usesRole(r.name)) {
        if (ctx.body.force !== true) throw new AgentConfigError(409, 'role em uso (use --force para tirar de quem usa e apagar)')
        if (wearing.length && !opts.unassignRole) throw new AgentConfigError(501, 'não dá para tirar o role dos terminais')
        // Nenhum processo reinicia: quem usava continua como está até o próximo início.
        for (const node of wearing) opts.unassignRole!(node.id)
        catalog.presets.clearRole(r.name); partituras?.clearRole?.(r.name)
      }
      catalog.roles.remove(r.name); return ok()
    },
    'POST /role/assign': (ctx: Ctx) => {
      const wanted = name(ctx), resolved = localName(wanted).toLowerCase() === ctx.caller.name.toLowerCase() ? { ok: true as const, node: ctx.caller } : resolveTarget(store.get(), ctx.caller.id, wanted)
      if (!resolved.ok || resolved.node.kind !== 'terminal') throw new AgentConfigError(404, 'agente não encontrado')
      if (ctx.body.none !== undefined && ctx.body.none !== true) throw new AgentConfigError(400, 'none inválido')
      if (ctx.body.none === true && ctx.body.role !== undefined) throw new AgentConfigError(400, 'role e none são exclusivos')
      const assigned = ctx.body.none === true ? undefined : role(ctx.body.role).name
      if (!takesRole(resolved.node.agent) && assigned !== undefined) throw new AgentConfigError(400, `role não se aplica a ${resolved.node.agent}`)
      store.setTerminalRole(resolved.node.id, assigned)
      return ok('OK: vale a partir do próximo reinício do terminal')
    }
  }
}
