import { PORTAL_ARITY } from '../../cli/portal-args'
import type { Appearance } from '../../shared/appearance'
import { isPortalUrl } from '../security'
import { BaseActions, BaseActionError } from './base-actions'
import { parseNodePatch } from '../validate'
import { AccountError, type AccountStore } from '../accounts/account-store'
import { createAccountRoutes, resolveAccountId } from '../accounts/routes'
import { createRoutineRoutes } from '../routines/routes'
import { requireMaestro, RouteError } from './route-error'
import { createWorkspaceRoutes, expandPath } from './workspace-routes'
import { CrossLinkStore, splitAddress } from '../domain/cross-links'
import { wakeTerminal } from '../pty/wake'
import { LockedError } from '../../shared/lock'
import { resolveColor } from '../../shared/colors'
import { chmodSync, existsSync, rmSync, statSync } from 'node:fs'
import http from 'node:http'
import { resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import type { AskBroker } from '../ask/ask-broker'
import { LOCAL_PREFIX, localName, reachable, resolveTarget } from '../domain/reachability'
import type { WorkspaceStore } from '../domain/workspace-store'
import { canDismiss } from './authority'
import type { WorkspaceRegistry } from '../domain/workspace-registry'
import type { TerminalManager } from '../pty/terminal-manager'
import { HEADER_TOKEN } from '../../shared/auth'
import { HOME_PAGE_ID, type Floor, type NewFloor } from '../../shared/model'
import type { AgentKind, BandAskItem, BandNode, CanvasNode, FloorId, FloorState, NoteNode, PortalNode, TerminalNode } from '../../shared/model'
import { FloorError, type FloorService } from '../floors/floor-service'
import { PortalClosedError, type PortalManager } from '../portal/portal-manager'
import type { RoutineRunner } from '../routines/routine-runner'
import type { RoutineStore } from '../routines/routine-store'
import type { PartituraStore } from '../partituras/partitura-store'
import { assertConfirmed, createPartituraRoutes, startPartitura } from '../partituras/routes'
import { capturePartitura, insertPartitura } from '../partituras/insert'
import type { AgentCatalog } from '../agents/presets'
import { AgentConfigError } from '../agents/roles'
import { freeSpot, noteDefaults } from '../../shared/new-item'
import type { Preferences } from '../../shared/preferences'
import type { ChatService } from '../chat/chat-service'
import { isThreadColor } from '../../shared/chat'
import { createAgentRoutes } from '../agents/routes'
import { mt } from '../i18n'
import { resolveAgentForCommand } from '../agents/command-resolution'
import { agentForCommand } from '../../shared/agent-command'

export interface ServerDeps {
  /** Vários workspaces: cada chamador usa o do próprio terminal. */
  registry?: WorkspaceRegistry
  /** Um workspace só (testes antigos); ignorado quando há `registry`. */
  store?: WorkspaceStore
  notify?: (message: string) => void
  accounts?: AccountStore
  agents?: AgentCatalog
  partituras?: PartituraStore
  broker: AskBroker
  terminals: Pick<TerminalManager, 'screenText' | 'isRunning' | 'identify' | 'agentState' | 'markReady' | 'notePromptHook'> &
    Partial<Pick<TerminalManager, 'spawn' | 'dispose' | 'write' | 'hasSession' | 'unload' | 'startConfirmed'>>
  /** Controle dos portais; sem ele, `palco portal` responde 501. */
  portals?: Pick<PortalManager, 'navigate' | 'snapshot' | 'click' | 'fill' | 'text' | 'screenshot' | 'back' | 'reload'> & Partial<Pick<PortalManager, 'forward' | 'info' | 'elementText' | 'action' | 'popups' | 'closePopup' | 'unregister' | 'waitForLoad'>>
  /** Ciclo de vida dos floors (um serviço por workspace); sem ele, as rotas de floor respondem 501. */
  floors?: FloorService | ((store: WorkspaceStore) => FloorService | undefined)
  /** Cordas entre workspaces (`Nome @ Workspace`); sem elas, só em memória. */
  links?: CrossLinkStore
  /** Notificação na área de trabalho (status de andar em blocked/review/done). */
  notifyUser?(title: string, body: string): void
  /** Authenticated agent lifecycle; optional to keep standalone server consumers compatible. */
  onAgentEvent?(id: string, kind: 'ready' | 'busy' | 'turn' | 'attention', sessionId?: string, message?: string): void
  /** Rotinas agendadas; sem elas, `palco routine` responde 501. */
  routines?: { store: RoutineStore; runner: RoutineRunner }
  /** Preferências vivas: padrões de novos itens (cor, tamanho, fonte) e onde o agente põe o que cria. Sem elas, os padrões antigos. */
  preferences?: () => Preferences
  /** Chat do terminal (`palco say` / `palco recall`); sem ele, as rotas respondem 501. */
  chat?: ChatService
}

export interface ServerOptions {
  /** Prazo para receber o corpo inteiro da requisição (a espera pela resposta do agente não conta). */
  bodyTimeoutMs?: number
  /** Prazo para um terminal acordado sob demanda ficar pronto (padrão 30 s). */
  wakeTimeoutMs?: number
}

const MAX_BODY = 1024 * 1024
const BODY_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 30_000
const NOTE_OFFSET_X = 360
const NOTE_SIZE = { w: 300, h: 200 }
const RECRUIT_SIZE = { w: 640, h: 400 }
const RECRUIT_GAP = 40
const AGENTS: readonly AgentKind[] = ['claude', 'codex', 'antigravity', 'shell', 'other']
const FLOOR_STATES: readonly FloorState[] = ['working', 'blocked', 'review', 'done']
const GROUND = 'ground'
/** Escape para um nome local que contém ` @ ` (senão ele é lido como `Nome @ Workspace`). */

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

interface Ctx {
  /** Aborta quando o cliente fecha a conexão antes de a resposta ser enviada. */
  signal: AbortSignal
  caller: TerminalNode
  url: URL
  body: Record<string, unknown>
}
interface Reply { status: number; body: string; type?: 'text/plain' | 'application/json' }
type Routes = Record<string, (ctx: Ctx) => Reply | Promise<Reply>>

const text = (body: string, status = 200): Reply => ({ status, body })
const notReady = (name: string, agent?: AgentKind): Reply => agent === 'other'
  ? text(mt("o agente '{p1}' usa um tipo desconhecido e não oferece sinal de prontidão; selecione Claude, Codex ou Antigravity se esse comando iniciar um deles", { p1: name }), 503)
  : text(`agente não ficou pronto: '${name}' ainda não sinalizou prontidão`, 503)
const json = (value: unknown): Reply => ({ status: 200, body: JSON.stringify(value), type: 'application/json' })

function readBody(req: http.IncomingMessage, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_BODY) {
      reject(new HttpError(413, 'corpo grande demais'))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    const timer = setTimeout(() => done(new HttpError(408, 'tempo esgotado ao receber o corpo')), timeoutMs)
    const done = (err?: Error, value?: Record<string, unknown>): void => {
      clearTimeout(timer)
      req.off('data', onData)
      if (err) reject(err)
      else resolve(value!)
    }
    const onData = (c: Buffer): void => {
      if (over) return
      size += c.length
      if (size > MAX_BODY) {
        // Para de acumular; o corpo restante é descartado para o 413 chegar ao cliente.
        over = true
        chunks.length = 0
        req.resume()
        done(new HttpError(413, 'corpo grande demais'))
        return
      }
      chunks.push(c)
    }
    req.on('data', onData)
    req.on('error', (e) => done(e))
    req.on('end', () => {
      if (over) return
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw === '') return done(undefined, {})
      try {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
        done(undefined, parsed as Record<string, unknown>)
      } catch {
        done(new HttpError(400, 'JSON inválido'))
      }
    })
  })
}

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key]
  if (typeof v !== 'string') throw new HttpError(400, `campo '${key}' ausente`)
  return v
}

function uniqueName(store: WorkspaceStore, wanted: string): string {
  const taken = new Set(Object.values(store.get().nodes).map((n) => n.name.toLowerCase()))
  if (!taken.has(wanted.toLowerCase())) return wanted
  for (let i = 2; ; i++) {
    const candidate = `${wanted} ${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

function optStr(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new HttpError(400, `campo '${key}' deve ser texto`)
  return v
}

function optBool(body: Record<string, unknown>, key: string): boolean | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw new HttpError(400, `campo '${key}' deve ser verdadeiro ou falso`)
  return v
}

const isDirectory = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }

const overlaps = (a: { pos: { x: number; y: number }; size: { w: number; h: number } }, b: { pos: { x: number; y: number }; size: { w: number; h: number } }): boolean =>
  a.pos.x < b.pos.x + b.size.w && b.pos.x < a.pos.x + a.size.w && a.pos.y < b.pos.y + b.size.h && b.pos.y < a.pos.y + a.size.h

export async function startServer(socketPath: string, deps: ServerDeps, options: ServerOptions = {}): Promise<{ close(): Promise<void> }> {
  const bodyTimeoutMs = options.bodyTimeoutMs ?? BODY_TIMEOUT_MS
  const { broker, terminals } = deps
  const registry = deps.registry
  /** O workspace dono do terminal: conexões, nomes e alcance valem dentro dele. */
  const storeOf = (id: string): WorkspaceStore | undefined =>
    registry ? registry.storeOfNode(id) : deps.store?.hasNode(id) ? deps.store : undefined
  const registryOrFail = (): WorkspaceRegistry => {
    if (!registry) throw new HttpError(501, 'workspaces indisponíveis')
    return registry
  }
  const routeCache = new WeakMap<WorkspaceStore, Routes>()
  const routesFor = (store: WorkspaceStore): Routes => {
    let found = routeCache.get(store)
    if (!found) {
      found = buildRoutes(store)
      routeCache.set(store, found)
    }
    return found
  }
  /** Nome de um terminal em qualquer workspace (rotinas guardam só o id). */
  const links = deps.links ?? new CrossLinkStore()
  /** Nome do workspace dono do nó (para `Nome @ Workspace`). */
  const workspaceNameOf = (id: string): string | undefined => {
    const owner = registry?.storeOfNode(id)
    const wsId = owner && registry!.idOf(owner)
    return wsId === undefined ? undefined : registry!.list().find((w) => w.id === wsId)?.name
  }
  const nameOfAny = (id: string): string | undefined => (registry ? registry.node(id) : deps.store?.get().nodes[id])?.name

  const buildRoutes = (store: WorkspaceStore): Routes => {

    /**
     * Terminal de andar ou workspace não aberto desde que o palco iniciou: sobe sob demanda e espera ficar pronto
     * (`booting` = passou do prazo; quem chama responde "ainda iniciando").
     */
    const wake = async (node: TerminalNode): Promise<'running' | 'ready' | 'booting' | 'exited'> => {
      const { spawn, hasSession } = terminals
      if (!spawn || !hasSession) return terminals.isRunning(node.id) ? 'running' : 'exited'
      const fresh = ownerOf(node.id).get().nodes[node.id]
      if (fresh?.kind !== 'terminal') return 'exited'
      // Descarregado pelo menu: a CLI pode acordar. A marca só sai se o processo subir.
      if (fresh.unloaded) {
        const { startConfirmed, dispose } = terminals
        try {
          if (!startConfirmed) spawn.call(terminals, fresh)
          else await startConfirmed.call(terminals, fresh)
          if (!terminals.isRunning(node.id)) throw new Error('não iniciou')
        } catch {
          dispose?.call(terminals, node.id)
          return 'exited'
        }
        ownerOf(node.id).setUnloaded(node.id, false)
        return 'running'
      }
      return wakeTerminal(fresh, { hasSession: (id) => hasSession.call(terminals, id), isRunning: (id) => terminals.isRunning(id), spawn: (n) => spawn.call(terminals, n), agentState: (id) => terminals.agentState(id) }, { timeoutMs: options.wakeTimeoutMs })
    }
    const stillBooting = (name: string): Reply => text(`ainda iniciando: '${name}' acabou de ser acordado e ainda não está pronto; pergunte de novo em alguns segundos`, 503)
    /** Store dono do nó (um alvo `Nome @ Workspace` vive em outro workspace). */
    const ownerOf = (id: string): WorkspaceStore => registry?.storeOfNode(id) ?? store
    /**
     * O que o chamador alcança em outros workspaces: cada terminal ligado a ele por corda entre workspaces,
     * o que um recruta seu alcança lá e as bandas lá de que ele é membro. Nome = `Nome @ Workspace`.
     */
    const remoteNodes = (callerId: string): Array<{ node: CanvasNode; workspace: string }> => {
      if (!registry) return []
      const out = new Map<string, { node: CanvasNode; workspace: string }>()
      for (const peer of links.peers(callerId)) {
        const owner = registry.storeOfNode(peer)
        const wsName = workspaceNameOf(peer)
        if (!owner || owner === store || wsName === undefined) continue
        const ws = owner.get()
        const node = ws.nodes[peer]
        if (!node) continue
        // Só a ponta da corda (terminal ou banda ligada a você) e, de um recruta seu, as notas e portais dele.
        // Estar numa banda não dá alcance a ela nem aos outros membros: só uma corda até a banda dá.
        const tree = node.kind === 'terminal' && node.recruitedBy === callerId ? reachable(ws, peer).filter((n) => n.kind !== 'terminal' && n.kind !== 'band') : []
        for (const n of [node, ...tree]) out.set(n.id, { node: n, workspace: wsName })
      }
      return [...out.values()]
    }
    const addressOf = (node: CanvasNode): string => {
      const ws = workspaceNameOf(node.id)
      return ws === undefined ? node.name : `${node.name} @ ${ws}`
    }
    /**
     * Alvo por nome. `Nome @ Workspace` resolve só no namespace remoto (sem corda até ele: 404), para um nó local
     * renomeado como "X @ Y" nunca capturar o que era de outro workspace. `local:Nome` força o nome local.
     */
    const target = (ctx: Ctx, raw: string): CanvasNode => {
      const local = raw.startsWith(LOCAL_PREFIX)
      const name = localName(raw)
      const addr = local ? null : splitAddress(name)
      if (addr) {
        const found = remoteNodes(ctx.caller.id).filter((r) => r.workspace.toLowerCase() === addr.workspace.toLowerCase() && r.node.name.toLowerCase() === addr.name.toLowerCase())
        if (found.length === 1) return found[0]!.node
        throw new HttpError(404, found.length > 1 ? 'nome ambíguo' : `alvo não encontrado: '${name}' não está ligado a você (para um nome local com ' @ ', use local:${name})`)
      }
      const r = resolveTarget(store.get(), ctx.caller.id, name)
      if (!r.ok) throw new HttpError(r.status, r.error)
      return r.node
    }
    const terminalTarget = (ctx: Ctx, name: string): TerminalNode => {
      const n = target(ctx, name)
      if (n.kind !== 'terminal') throw new HttpError(400, `'${n.name}' não é um terminal`)
      return n
    }
    const noteTarget = (ctx: Ctx, name: string): NoteNode => {
      const n = target(ctx, name)
      if (n.kind !== 'note') throw new HttpError(400, `'${n.name}' não é uma nota`)
      return n
    }
    const bandTarget = (ctx: Ctx, name: string): BandNode => {
      const n = target(ctx, name)
      if (n.kind !== 'band') throw new HttpError(400, `'${n.name}' não é uma banda`)
      return n
    }
    const portalTarget = (ctx: Ctx, name: string): PortalNode => {
      const visible = new BaseActions(store,ctx.caller).visible()
      const matches = (deps.portals?.popups?.()??[]).filter(p=>p.name===localName(name) && visible.some(n=>n.id===p.parentId && n.kind==='portal'))
      if(matches.length>1)throw new HttpError(404,'nome ambíguo')
      if(matches.length===1){const popup=matches[0]!,parent=store.get().nodes[popup.parentId] as PortalNode;return {...parent,id:popup.id,name:popup.name}}
      const n = target(ctx, name)
      if (n.kind !== 'portal') throw new HttpError(400, `'${n.name}' não é um portal`)
      return n
    }
    /** Terminal citado por nome: alcançável pelo chamador, ou o próprio chamador. */
    const memberTarget = (ctx: Ctx, name: string): TerminalNode => {
      if (localName(name).toLowerCase() === ctx.caller.name.toLowerCase()) return ctx.caller
      return terminalTarget(ctx, name)
    }
    /** Floor por nome, com o erro já no formato HTTP (usado fora do `guard`). */
    const floorByName = (name: string) => {
      try {
        return floorsOrFail().byName(name)
      } catch (err) {
        if (err instanceof FloorError) throw new HttpError(err.status, err.message)
        throw err
      }
    }
    /** Pasta que o usuário já tem para um andar (`floor create --dir` e `floor set-dir`): existe, e não é de ninguém. */
    const userFloorDir = (arg: string, base: string, except?: string): string => {
      const dir = expandPath(arg, base)
      if (!isDirectory(dir)) throw new HttpError(400, `a pasta não existe: ${dir}`)
      if (dir === '/' || dir === homedir()) throw new HttpError(400, 'a raiz do disco e a pasta home não podem ser andar')
      const allMeta = registry?.list() ?? []
      if (allMeta.some((w) => w.dir === dir)) throw new HttpError(400, 'a pasta é de um workspace: escolha outra')
      const floorsOf = registry ? allMeta.flatMap((w) => Object.values(registry.get(w.id).get().floors)) : Object.values(store.get().floors)
      if (floorsOf.some((f) => f.dir === dir && f.id !== except)) throw new HttpError(400, 'a pasta já é de outro andar')
      return dir
    }
    /** "Descarregado": há terminais ali e nenhum roda (descarregado agora ou ainda não aberto). */
    const isUnloadedPlace = (nodes: CanvasNode[]): boolean => {
      const there = nodes.filter((n) => n.kind === 'terminal')
      return there.length > 0 && there.every((n) => !terminals.isRunning(n.id))
    }
    /** Encerra os terminais que rodam ali (a conversa dos agentes fica salva para a próxima partida); devolve quantos. */
    const unload = async (nodes: CanvasNode[]): Promise<number> => {
      const stop = stopper(terminals)
      if (!stop) throw new HttpError(501, 'encerramento indisponível')
      const live = nodes.filter((n) => n.kind === 'terminal' && terminals.isRunning(n.id))
      await Promise.all(live.map((node) => stop(node.id)))
      return live.length
    }
    /** Pasta do workspace deste store (`workspace create --dir`), se houver. */
    const workspaceDir = (): string | undefined => {
      const id = registry?.idOf(store)
      return id === undefined ? undefined : registry!.list().find((w) => w.id === id)?.dir
    }
    const floorsOrFail = (): FloorService => {
      const service = typeof deps.floors === 'function' ? deps.floors(store) : deps.floors
      if (!service) throw new HttpError(501, 'floors indisponíveis')
      return service
    }
    /** Erros de floor/portal viram a resposta HTTP certa; o resto segue para o 500. */
    const guard = async <T>(fn: () => Promise<T> | T): Promise<T> => {
      try {
        return await fn()
      } catch (err) {
        if (err instanceof FloorError) throw new HttpError(err.status, err.message)
        throw err
      }
    }
    const nameTaken = (floorId: FloorId, name: string): boolean =>
      Object.values(store.get().nodes).some((n) => n.floorId === floorId && n.name.toLowerCase() === name.toLowerCase())
    const requireName = (body: Record<string, unknown>, key = 'name'): string => {
      const v = str(body, key).trim()
      if (v === '' || v.length > 200) throw new HttpError(400, `campo '${key}' vazio ou grande demais`)
      return v
    }

    /** Ask a todos os membros da banda (menos o chamador); cada um responde sozinho, sem travar os outros. */
    const askBand = async (ctx: Ctx, band: BandNode, prompt: string): Promise<Reply> => {
      const ws = ownerOf(band.id).get()
      const items = await Promise.all(
        band.members.filter((id) => id !== ctx.caller.id).map(async (id): Promise<BandAskItem> => {
          const node = ws.nodes[id]
          const name = node?.name ?? id
          if (node?.kind !== 'terminal') return { name, error: 'exited' }
          if (node.agent === 'other') return { name, error: mt("o agente '{p1}' usa um tipo desconhecido e não oferece sinal de prontidão; selecione Claude, Codex ou Antigravity se esse comando iniciar um deles", { p1: name }) }
          if ((await wake(node)) === 'booting') return { name, error: 'ainda iniciando: pergunte de novo em alguns segundos' }
          if (!terminals.isRunning(id)) return { name, error: 'exited' }
          if (terminals.agentState(id) === 'failed') return { name, error: 'agente não ficou pronto' }
          const result = await broker.ask(ctx.caller.id, id, prompt, ctx.signal)
          return result.ok ? { name, output: answerText(node, result) } : { name, error: result.error }
        })
      )
      return json(items)
    }

    /** Conta pelo nome ("Default" = login padrão do CLI); precisa ser do mesmo agente. */
    const accountIdOf = (wanted: string, agent: AgentKind): string | undefined => resolveAccountId(wanted,agent,deps.accounts)

    /**
     * Agente, comando, role, conta e Maestro de um recruta. Sem --preset, --agent e --command: uma cópia de você
     * (o mesmo agente, comando e conta). `--account` vence a conta do preset.
     */
    const agentSetup = async (ctx: Ctx, body: Record<string, unknown>, keep?: TerminalNode): Promise<{ agent: AgentKind; command: string; role?: string; accountId?: string; maestro?: boolean; look?: Appearance; warning?: string }> => {
      const base = keep ?? ctx.caller
      const copy = body.preset === undefined && body.agent === undefined && body.command === undefined
      if (!deps.agents && (body.preset !== undefined || body.role !== undefined)) throw new HttpError(501, 'presets/roles indisponíveis')
      let setup: { agent: AgentKind; command: string; role?: string; account?: string; maestro?: boolean; look?: Appearance }
      if (copy && (base.agent === 'other' || !deps.agents)) setup = { agent: base.agent, command: base.command }
      else if (deps.agents) setup = deps.agents.recruit(copy ? { agent: base.agent, command: base.command, ...(body.role === undefined ? {} : { role: body.role }) } : body)
      else {
        const command = optStr(body, 'command') ?? ''
        setup = { agent: (optStr(body, 'agent') ?? (command ? agentForCommand(command) : 'claude')) as AgentKind, command }
      }
      let warning: string | undefined
      const automatic = body.agent === undefined && body.preset === undefined && (copy || body.command !== undefined)
      if (automatic && setup.agent === 'other' && setup.command) {
        const resolved = await resolveAgentForCommand(setup.command, { shell: process.env.SHELL ?? '/bin/bash' })
        setup.agent = resolved.agent
        warning = resolved.warning
      }
      if (!AGENTS.includes(setup.agent)) throw new HttpError(400, `agente desconhecido: ${setup.agent}`)
      if (setup.agent === 'shell' && optStr(body, 'command') !== undefined) throw new HttpError(400, 'agente shell não aceita command: o comando seria ignorado')
      if (keep && body.role === undefined && setup.role === undefined && keep.role !== undefined && (setup.agent === 'claude' || setup.agent === 'codex')) setup.role = keep.role
      const accountArg = optStr(body, 'account')
      let accountId: string | undefined
      if (accountArg !== undefined) accountId = accountIdOf(accountArg, setup.agent)
      else if (setup.account !== undefined) accountId = accountIdOf(setup.account, setup.agent)
      else if (copy || (keep && keep.agent === setup.agent)) accountId = base.agent === setup.agent ? base.accountId : undefined
      return { agent: setup.agent, command: setup.command, ...(setup.role === undefined ? {} : { role: setup.role }), ...(accountId === undefined ? {} : { accountId }), ...(setup.maestro ? { maestro: true } : {}), ...(setup.look ? { look: setup.look } : {}), ...(warning ? { warning } : {}) }
    }
    /** `--icon` (lucide ou emoji) e `--color` (nome ou #RRGGBB). */
    const appearance = (body: Record<string, unknown>): { icon?: string; color?: string } => {
      const icon = optStr(body, 'icon'), color = optStr(body, 'color')
      if (icon !== undefined && !(/^[a-z0-9-]{1,48}$/.test(icon) || [...icon].length <= 8)) throw new HttpError(400, `ícone inválido: ${icon}`)
      let hex: string | null = null
      if (color !== undefined) {
        try { hex = resolveColor(color) } catch (err) { throw new HttpError(400, (err as Error).message) }
      }
      return { ...(icon === undefined ? {} : { icon }), ...(hex ? { color: hex } : {}) }
    }
    /** `recruit --replace`: troca o agente no mesmo nó (cordas, posição e rotinas ficam); o processo reinicia. */
    const replaceAgent = async (ctx: Ctx): Promise<Reply> => {
      const { spawn, dispose } = terminals
      if (!spawn || !dispose) throw new HttpError(501, 'recruit indisponível')
      for (const k of ['floor', 'workspace', 'space', 'band']) if (ctx.body[k] !== undefined) throw new HttpError(400, `--replace não aceita --${k}: o nó fica onde está`)
      if (['preset', 'command', 'agent', 'account'].every((k) => ctx.body[k] === undefined)) throw new HttpError(400, '--replace precisa de --preset, --command ou --account')
      const old = memberTarget(ctx, str(ctx.body, 'replace'))
      if (old.id === ctx.caller.id) throw new HttpError(400, 'não dá para trocar o seu próprio agente')
      const onlyAccount = ['preset', 'command', 'agent'].every((k) => ctx.body[k] === undefined)
      const setup = onlyAccount
        ? { agent: old.agent, command: old.command, ...(old.role === undefined ? {} : { role: old.role }), ...(optStr(ctx.body, 'account') === undefined ? {} : { accountId: accountIdOf(optStr(ctx.body, 'account')!, old.agent) }) }
        : await agentSetup(ctx, ctx.body, old)
      if (onlyAccount && ctx.body.role !== undefined && deps.agents) Object.assign(setup, { role: deps.agents.roles.get(str(ctx.body, 'role')).name })
      const dirArg = optStr(ctx.body, 'dir')
      const cwd = dirArg === undefined ? old.cwd : expandPath(dirArg, ctx.caller.cwd)
      if (!isDirectory(cwd)) throw new HttpError(400, `diretório não existe: ${cwd}`)
      const newName = optStr(ctx.body, 'name')?.trim()
      if (newName && newName.toLowerCase() !== old.name.toLowerCase() && nameTaken(old.floorId, newName)) throw new HttpError(409, `já existe um nó chamado '${newName}' neste floor`)
      dispose.call(terminals, old.id)
      store.reconfigureTerminal(old.id, { command: setup.command, cwd, agent: setup.agent })
      store.setTerminalRole(old.id, setup.agent === 'claude' || setup.agent === 'codex' ? setup.role : undefined)
      store.setTerminalAccount(old.id, setup.accountId)
      if ('look' in setup && setup.look) store.setTerminalLook(old.id, setup.look)
      const look = appearance(ctx.body)
      if (newName || Object.keys(look).length) store.patchNode(old.id, { ...(newName ? { name: newName } : {}), ...look })
      const updated = store.get().nodes[old.id]
      if (updated?.kind === 'terminal') spawn.call(terminals, updated)
      const warning = 'warning' in setup ? setup.warning : undefined
      return text(`OK: ${updated?.name ?? old.name} agora roda ${setup.agent}${setup.accountId ? ' na conta escolhida' : ''}; o histórico da conversa não sobrevive, passe o contexto com palco ask${warning ? `\n${warning}` : ''}`)
    }

    /** `recruit --space`: o workspace daquele espaço da barra. Sem `--workspace`, só quando o espaço tem um. */
    const workspaceInSpace = (spaceName: string, wsName: string | undefined): string => {
      const reg = registryOrFail()
      const page = reg.pageByName(spaceName)
      if (!page) throw new HttpError(404, `espaço '${spaceName}' não existe (veja palco space list)`)
      const inside = reg.sidebar().workspaces.filter((w) => (w.pageId ?? HOME_PAGE_ID) === page.id)
      if (wsName !== undefined) {
        const found = inside.find((w) => w.name.toLowerCase() === wsName.trim().toLowerCase())
        if (!found) throw new HttpError(404, `workspace '${wsName}' não está no espaço ${page.name}`)
        return found.name
      }
      if (inside.length === 0) throw new HttpError(404, `o espaço ${page.name} não tem workspace`)
      if (inside.length > 1) throw new HttpError(400, `o espaço ${page.name} tem vários workspaces; informe --workspace: ${inside.map((w) => w.name).join(', ')}`)
      return inside[0]!.name
    }

    const base = (ctx: Ctx) => new BaseActions(store, ctx.caller)
    const baseCall = (fn: () => unknown): Reply => {
      try { return json(fn() ?? 'OK') }
      catch (error) { throw new HttpError(error instanceof BaseActionError ? error.status : 400, error instanceof Error ? error.message : String(error)) }
    }
    /**
     * `band create --workspace`: a banda nasce no outro workspace com o time que você alcança lá
     * (os recrutas ligados a você por corda entre workspaces); você a coordena de fora, como `Banda @ Workspace`.
     */
    const remoteBand = (ctx: Ctx, name: string, wanted: string[], wsName: string): Reply => {
      const meta = registryOrFail().workspaceByName(wsName)
      if (!meta) throw new HttpError(404, `workspace '${wsName}' não existe`)
      const remote = registry!.get(meta.id)
      if (remote === store) throw new HttpError(400, 'esse é o seu workspace: omita --workspace')
      const ws = remote.get()
      const mine = remoteNodes(ctx.caller.id).filter((r) => r.workspace === meta.name && r.node.kind === 'terminal').map((r) => r.node as TerminalNode)
      const inBand = new Set(Object.values(ws.nodes).flatMap((n) => (n.kind === 'band' ? n.members : [])))
      const members = wanted.length > 0
        ? wanted.map((w) => {
          const plain = splitAddress(w)?.name ?? w
          const t = mine.find((n) => n.name.toLowerCase() === plain.toLowerCase())
          if (!t) throw new HttpError(404, `'${w}' não é um agente seu em ${meta.name}`)
          return t
        })
        : mine.filter((n) => !inBand.has(n.id))
      const floorArg = optStr(ctx.body, 'floor')
      const floorId: FloorId = floorArg === undefined ? (members[0]?.floorId ?? null) : floorArg.toLowerCase() === GROUND ? null : remote.findFloorByName(floorArg)?.id ?? (() => { throw new HttpError(404, `floor '${floorArg}' não existe em ${meta.name}`) })()
      const chosen = [...new Set(members.filter((m) => m.floorId === floorId).map((m) => m.id))]
      if (chosen.length < 2) throw new HttpError(400, 'uma banda precisa de pelo menos dois agentes no andar dela')
      if (Object.values(ws.nodes).some((n) => n.floorId === floorId && n.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, `já existe um nó chamado '${name}' lá`)
      const id = remote.createBand(name, chosen, floorId)
      const look = appearance(ctx.body)
      if (Object.keys(look).length) remote.patchNode(id, look)
      // Você coordena de fora, ligado à banda por corda entre workspaces (`Banda @ Workspace`).
      links.connect(ctx.caller.id, id)
      return text(`OK: banda ${name} @ ${meta.name} criada com ${chosen.length} membro(s)`)
    }

    /** `floor status`: sem nada imprime; `--clear` limpa; senão grava (padrão working, texto até 120) e avisa ao entrar em blocked/review/done. */
    const applyStatus = (ctx: Ctx, label: string, current: Floor['status'], save: (st: Floor['status'] | null) => void): Reply => {
      if (optBool(ctx.body, 'clear')) {
        save(null)
        return text(`OK: status de ${label} limpo`)
      }
      const stateArg = optStr(ctx.body, 'state')
      const lineArg = optStr(ctx.body, 'text')
      const progress = optStr(ctx.body, 'progress')
      if (stateArg === undefined && lineArg === undefined && progress === undefined) {
        const st = current
        return text(st ? `${label}: ${st.state}${st.text ? ` — ${st.text}` : ''}${st.progress ? ` (${st.progress})` : ''}` : `${label}: sem status`)
      }
      if (stateArg !== undefined && !FLOOR_STATES.includes(stateArg as FloorState)) throw new HttpError(400, `estado inválido: ${stateArg}`)
      if (progress !== undefined && !/^(\d+\/\d+|\d{1,3}(\.\d+)?%|0?\.\d+|[01](\.0+)?)$/.test(progress.trim())) throw new HttpError(400, `progresso inválido: ${progress} (use 2/5, 40% ou 0.4)`)
      const state = (stateArg as FloorState | undefined) ?? 'working'
      const line = lineArg === undefined ? (stateArg === undefined ? current?.text : undefined) : lineArg.replace(/\s+/g, ' ').trim().slice(0, 120)
      const prog = progress?.trim() ?? (stateArg === undefined && lineArg === undefined ? current?.progress : undefined)
      save({ state, ...(prog === undefined ? {} : { progress: prog }), ...(line ? { text: line } : {}) })
      // Entrar em blocked/review/done avisa o usuário; texto novo no mesmo estado, não.
      if (state !== 'working' && state !== current?.state) deps.notifyUser?.(`${label}: ${state}`, line ?? '')
      return text(`OK: ${label} ${state}${line ? ` — ${line}` : ''}${prog ? ` (${prog})` : ''}`)
    }

    /**
     * Nota sem nome fixo acompanha a primeira linha: depois de write/edit, renomeia e devolve o nome novo.
     * Com `--name` ou renomeada pelo usuário, o nome fica.
     */
    const followFirstLine = (id: string): string => {
      const owner = ownerOf(id)
      const note = owner.get().nodes[id]
      if (note?.kind !== 'note' || note.nameFixed) return 'OK'
      const first = (note.content.split('\n').find((l) => l.trim() !== '') ?? '').trim().slice(0, 40)
      if (first === '' || first === note.name) return 'OK'
      const taken = new Set(Object.values(owner.get().nodes).filter((n) => n.id !== id).map((n) => n.name.toLowerCase()))
      let next = first
      for (let i = 2; taken.has(next.toLowerCase()); i++) next = `${first} ${i}`
      if (next === note.name) return 'OK'
      owner.renameNoteAuto(id, next)
      return `OK: a nota agora se chama "${next}"`
    }

    const routes: Routes = {
      'POST /arrange': ctx => baseCall(() => base(ctx).arrange(ctx.body)),
      'POST /connect': ctx => baseCall(() => base(ctx).connect(str(ctx.body, 'from'), str(ctx.body, 'to'), optStr(ctx.body, 'fromKind'), optStr(ctx.body, 'toKind'))),
      'POST /note/stack': ctx => baseCall(() => base(ctx).stack(str(ctx.body, 'name'), ctx.body.stack === null ? null : str(ctx.body, 'stack'))),
      'POST /note/delete': ctx => baseCall(() => base(ctx).delete(str(ctx.body, 'name'), ctx.body.stack === true)),
      'POST /notify': ctx => {
        if (deps.onAgentEvent) { deps.onAgentEvent(ctx.caller.id, 'attention', undefined, str(ctx.body, 'message')); return text('OK') }
        if (!deps.notify) throw new HttpError(501, 'notificações indisponíveis')
        deps.notify(str(ctx.body, 'message')); return text('OK')
      },
      'POST /ask/raw': async ctx => {
        const node = terminalTarget(ctx, str(ctx.body, 'to'))
        if (!terminals.isRunning(node.id)) throw new HttpError(410, 'terminal encerrado')
        if (!terminals.write) throw new HttpError(501, 'entrada crua indisponível')
        terminals.write(node.id, str(ctx.body, 'data'))
        // Um instante para a tela reagir à tecla: quem usa `--raw` decide o próximo passo pelo que aparece nela.
        await new Promise((r) => setTimeout(r, RAW_SETTLE_MS))
        return text(terminals.screenText(node.id))
      },
      'GET /list': ({ caller }) => {
        const ws = store.get()
        const actions = new BaseActions(store, caller)
        const found = actions.visible().filter(n => n.id !== caller.id)
        const floorName = (id: FloorId): string => (id === null ? GROUND : ws.floors[id]?.name ?? GROUND)
        const remote = remoteNodes(caller.id)
        const remoteFloor = (n: CanvasNode): string => (n.floorId === null ? GROUND : ownerOf(n.id).get().floors[n.floorId]?.name ?? GROUND)
        const shown = new Set([caller.id, ...found.map((n) => n.id)])
        const linked = (id: string): string[] => ws.connections.flatMap((c) => (c.a === id ? [c.b] : c.b === id ? [c.a] : []))
        // Notas encadeadas: a raiz está ligada a um agente/banda/portal; as outras ficam sob a nota que as alcança.
        const parent = new Map<string, string | null>()
        const queue: string[] = []
        for (const n of found) if (n.kind === 'note' && linked(n.id).some((o) => shown.has(o) && ws.nodes[o]?.kind !== 'note')) { parent.set(n.id, null); queue.push(n.id) }
        for (let i = 0; i < queue.length; i++) {
          for (const o of linked(queue[i]!)) if (shown.has(o) && ws.nodes[o]?.kind === 'note' && !parent.has(o)) { parent.set(o, queue[i]!); queue.push(o) }
        }
        const kindLabel = (n: CanvasNode): string => (n.kind === 'terminal' ? 'agent' : n.kind)
        return json({
          self: { name: caller.name, floor: floorName(caller.floorId), ...(registry ? { address: addressOf(caller) } : {}), ...(caller.maestro ? { maestro: true } : {}) },
          agents: [
            ...found.flatMap((n) => (n.kind === 'terminal' ? [{
              name: n.name, agent: n.agent, running: terminals.isRunning(n.id), floor: floorName(n.floorId),
              // Sem processo nesta sessão (carregamento preguiçoso): sobe quando alguém fala com ele.
              ...(!terminals.isRunning(n.id) && terminals.hasSession && !terminals.hasSession(n.id) ? { dormant: true } : {}),
              ...(n.role ? { role: n.role } : {}),
              ...(n.accountId ? { account: deps.accounts?.byId(n.accountId)?.name ?? n.accountId } : {}),
              // Como Maestro, você vê o que cada colega tem ligado (agentes, notas, portais, bandas).
              ...(caller.maestro ? { connections: linked(n.id).filter((o) => o !== caller.id && ws.nodes[o]).map((o) => ({ name: ws.nodes[o]!.name, kind: kindLabel(ws.nodes[o]!) })) } : {})
            }] : [])),
            ...remote.flatMap((r) => (r.node.kind === 'terminal' ? [{
              name: `${r.node.name} @ ${r.workspace}`, agent: r.node.agent, running: terminals.isRunning(r.node.id), floor: remoteFloor(r.node), workspace: r.workspace,
              ...(!terminals.isRunning(r.node.id) && terminals.hasSession && !terminals.hasSession(r.node.id) ? { dormant: true } : {}),
              ...(r.node.accountId ? { account: deps.accounts?.byId(r.node.accountId)?.name ?? r.node.accountId } : {})
            }] : []))
          ],
          notes: [
            ...found.flatMap((n) => (n.kind === 'note' ? [{
              name: n.name, locked: n.locked === true,
              ...(n.stackId ? { stack: actions.stackName(n.stackId) } : {}),
              ...(parent.get(n.id) ? { parent: ws.nodes[parent.get(n.id)!]!.name } : {})
            }] : [])),
            ...remote.flatMap((r) => (r.node.kind === 'note' ? [{ name: `${r.node.name} @ ${r.workspace}`, locked: r.node.locked === true }] : []))
          ],
          stacks: [...new Set(found.flatMap(n => n.kind === 'note' && n.stackId ? [actions.stackName(n.stackId)] : []))],
          bands: [
            ...found.flatMap((n) => (n.kind === 'band' ? [{ name: n.name, members: n.members.map((id) => ws.nodes[id]?.name ?? id), ...(n.members.includes(caller.id) ? { you: true } : {}), ...(n.icon ? { icon: n.icon } : {}), ...(n.color ? { color: n.color } : {}) }] : [])),
            ...remote.flatMap((r) => (r.node.kind === 'band' ? [{ name: `${r.node.name} @ ${r.workspace}`, members: r.node.members.map((id) => ownerOf(r.node.id).get().nodes[id]?.name ?? id) }] : []))
          ],
          portals: [...found.flatMap((n) => (n.kind === 'portal' ? [{ name: n.name }] : [])), ...(deps.portals?.popups?.()??[]).filter(p=>found.some(n=>n.id===p.parentId)).map(p=>({name:p.name}))]
        })
      },

      'GET /check': async (ctx) => {
        const node = terminalTarget(ctx, ctx.url.searchParams.get('name') ?? '')
        const woke = await wake(node)
        const screen = terminals.screenText(node.id)
        return text(woke === 'booting' ? `[palco: '${node.name}' foi acordado e ainda está iniciando]\n${screen}` : screen)
      },

      'POST /ask': async (ctx) => {
        const node = target(ctx, str(ctx.body, 'to'))
        const prompt = str(ctx.body, 'prompt')
        if (node.kind === 'band') return askBand(ctx, node, prompt)
        if (node.kind !== 'terminal') throw new HttpError(400, `'${node.name}' não é um terminal`)
        const to = node
        if (broker.tryAskBack(ctx.caller.id, to.id, prompt)) {
          return text(`OK: entregue como resposta ao ask pendente de ${to.name}`)
        }
        if (to.agent === 'other') return notReady(to.name, to.agent)
        if ((await wake(to)) === 'booting') return stillBooting(to.name)
        if (!terminals.isRunning(to.id)) return text(`exited: '${to.name}' não está rodando`, 410)
        if (terminals.agentState(to.id) === 'failed') return notReady(to.name, to.agent)
        const result = await broker.ask(ctx.caller.id, to.id, prompt, ctx.signal)
        if (result.ok) return text(answerText(to, result))
        if (result.error === 'cancelled') return text('cancelled: o cliente desconectou', 499)
        if (result.error === 'rejected') return text(`rejected: '${to.name}' não aceitou o prompt (há um diálogo aberto no terminal dele? veja com palco check "${to.name}")`, 409)
        if (result.error === 'timeout') return text(`timeout: '${to.name}' não respondeu a tempo`, 504)
        // O manager falha os pendentes pelo broker (exited) quando o agente não sinaliza prontidão.
        if (result.error === 'exited' && terminals.agentState(to.id) === 'failed') return notReady(to.name, to.agent)
        return text(`${result.error}: '${to.name}' encerrou antes de responder`, 410)
      },

      'GET /note/read': (ctx) => {
        const note = noteTarget(ctx, ctx.url.searchParams.get('name') ?? '')
        const lines = note.content.split('\n')
        const num = (k: string): number | undefined => {
          const v = ctx.url.searchParams.get(k)
          if (v === null) return undefined
          if (!/^\d+$/.test(v) || Number(v) < 1) throw new HttpError(400, `'${k}' inválido`)
          return Number(v)
        }
        const start = (num('offset') ?? 1) - 1
        const limit = num('limit') ?? lines.length
        return text(lines.slice(start, start + limit).map((l, i) => `${start + i + 1}\t${l}`).join('\n'))
      },

      'POST /note/write': (ctx) => {
        const note = noteTarget(ctx, str(ctx.body, 'name'))
        if (note.locked) throw new HttpError(403, 'nota travada')
        ownerOf(note.id).patchNode(note.id, { content: str(ctx.body, 'content') })
        return text(followFirstLine(note.id))
      },

      'POST /note/edit': (ctx) => {
        const note = noteTarget(ctx, str(ctx.body, 'name'))
        if (note.locked) throw new HttpError(403, 'nota travada')
        const old = str(ctx.body, 'old')
        const at = old === '' ? -1 : note.content.indexOf(old)
        if (at === -1) throw new HttpError(404, 'texto antigo não encontrado na nota')
        ownerOf(note.id).patchNode(note.id, { content: note.content.slice(0, at) + str(ctx.body, 'new') + note.content.slice(at + old.length) })
        return text(followFirstLine(note.id))
      },

      'POST /note/create': (ctx) => {
        const content = typeof ctx.body.content === 'string' ? ctx.body.content : ''
        const given = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : ''
        const fromContent = (content.split('\n').find((l) => l.trim() !== '') ?? '').trim().slice(0, 40)
        const name = uniqueName(store, given || fromContent || 'Nota')
        const extras = parseNodePatch({ ...(ctx.body.color !== undefined ? { color: ctx.body.color } : {}) }, 'note')
        // --stack "Nome": o fichário com esse nome (ou um novo, com nome próprio).
        if (typeof ctx.body.stack === 'string') {
          try { extras.stackId = new BaseActions(store, ctx.caller).stackIdOf(ctx.body.stack, true)! } catch (err) { throw new HttpError(400, err instanceof Error ? err.message : String(err)) }
        }
        const prefs = deps.preferences?.(), nd = prefs && noteDefaults(prefs)
        const wantedAt = { x: ctx.caller.pos.x - NOTE_OFFSET_X, y: ctx.caller.pos.y }
        const noteSize = nd ? nd.size : { ...NOTE_SIZE }
        const at = prefs ? freeSpot(prefs.agentNotePlacement, Object.values(store.get().nodes), ctx.caller.floorId, wantedAt, noteSize) : wantedAt
        const id = store.addNode({
          ...(prefs ? { render: prefs.defaultNoteRender } : {}),
          ...(nd ? { fontSize: nd.fontSize, ...(nd.fontFamily ? { fontFamily: nd.fontFamily } : {}) } : {}),
          ...(extras.color ?? nd?.color ? { color: extras.color ?? nd!.color } : {}),
          ...(extras.stackId ? { stackId: extras.stackId } : {}),
          kind: 'note',
          floorId: ctx.caller.floorId,
          name,
          ...(given ? { nameFixed: true } : {}),
          content,
          pos: at,
          size: noteSize
        })
        store.connect(ctx.caller.id, id)
        return text(`Criada a nota "${name}"`)
      },

      // Chat: o agente responde ao usuário (`palco say`) e relê a conversa (`palco recall`). O caller é sempre o terminal do token.
      'POST /say': async (ctx) => {
        const chat = deps.chat
        if (!chat) throw new HttpError(501, 'chat indisponível')
        const b = ctx.body
        if (b.text !== undefined && typeof b.text !== 'string') throw new HttpError(400, "campo 'text' deve ser texto")
        if (typeof b.text === 'string' && b.text.length > 200_000) throw new HttpError(400, 'texto grande demais (200 mil caracteres)')
        if (b.attach !== undefined && (!Array.isArray(b.attach) || b.attach.length > 10 || b.attach.some((p) => typeof p !== 'string'))) throw new HttpError(400, "campo 'attach' deve ser uma lista de até 10 caminhos")
        const q = b.question
        if (q !== undefined && (typeof q !== 'object' || q === null || typeof (q as { prompt?: unknown }).prompt !== 'string' || !Array.isArray((q as { options?: unknown }).options)
          || (q as { options: unknown[] }).options.some((o) => typeof o !== 'object' || o === null || typeof (o as { label?: unknown }).label !== 'string'))) throw new HttpError(400, "campo 'question' inválido")
        try {
          await chat.say(ctx.caller.id, {
            ...(typeof b.text === 'string' ? { text: b.text } : {}), ...(b.progress === true ? { progress: true } : {}),
            ...(q ? { question: q as never } : {}), ...(Array.isArray(b.attach) ? { attach: b.attach as string[] } : {})
          })
        } catch (err) { throw new HttpError(400, err instanceof Error ? err.message : String(err)) }
        return text('OK')
      },

      'GET /recall': (ctx) => {
        const chat = deps.chat
        if (!chat) throw new HttpError(501, 'chat indisponível')
        const p = ctx.url.searchParams, thread = p.get('thread'), turns = p.get('turns')
        if (thread !== null && !isThreadColor(thread)) throw new HttpError(400, 'tópico inválido: azul=blue, roxo=purple, rosa=pink, vermelho=red, laranja=orange, amarelo=yellow, verde=green')
        if (turns !== null && (!/^\d+$/.test(turns) || Number(turns) < 1 || Number(turns) > 500)) throw new HttpError(400, "'turns' vai de 1 a 500")
        return { ...text(chat.recall(ctx.caller.id, { ...(thread ? { thread } : {}), ...(turns ? { turns: Number(turns) } : {}), all: p.get('all') === '1', list: p.get('list') === '1', ...(p.get('json') === '1' ? {json:true} : {}), ...recallPeriod(p) })), ...(p.get('json') === '1' ? {type:'application/json' as const} : {}) }
      },

      'GET /recall/attachment': (ctx) => {
        const chat = deps.chat
        if (!chat) throw new HttpError(501, 'chat indisponível')
        const path = chat.attachmentPath(ctx.caller.id, ctx.url.searchParams.get('id') ?? '')
        if (!path) throw new HttpError(404, 'anexo não encontrado')
        return text(path)
      },

      'POST /recruit': async (ctx) => {
        const { spawn } = terminals
        if (!spawn) throw new HttpError(501, 'recruit indisponível')
        if (optStr(ctx.body, 'replace') !== undefined) return replaceAgent(ctx)
        // --workspace: o recruta nasce em outro workspace (no térreo dele, ou em --floor lá). --space escolhe entre os de um espaço.
        const spaceName = optStr(ctx.body, 'space')
        const wsName = spaceName === undefined ? optStr(ctx.body, 'workspace') : workspaceInSpace(spaceName, optStr(ctx.body, 'workspace'))
        let target = store
        let targetDir: string | undefined
        if (wsName !== undefined) {
          const meta = registryOrFail().workspaceByName(wsName)
          if (!meta) throw new HttpError(404, `workspace '${wsName}' não existe`)
          target = registry!.get(meta.id)
          targetDir = meta.dir
        }
        const other = target !== store
        const wanted = requireName(ctx.body)
        const setup = await agentSetup(ctx, ctx.body)
        const look = { ...setup.look, ...appearance(ctx.body) }
        const tws = target.get()

        const floorArg = optStr(ctx.body, 'floor')
        let floorId: FloorId = other ? null : ctx.caller.floorId
        if (floorArg !== undefined) {
          if (floorArg.toLowerCase() === GROUND) floorId = null
          else {
            const f = other ? target.findFloorByName(floorArg) : floorByName(floorArg)
            if (!f) throw new HttpError(404, `floor '${floorArg}' não existe`)
            floorId = f.id
          }
        }
        const floor = floorId === null ? undefined : tws.floors[floorId]
        // Nome repetido no andar: o canvas acrescenta (2), (3)...
        const taken = (n: string): boolean => Object.values(tws.nodes).some((x) => x.floorId === floorId && x.name.toLowerCase() === n.toLowerCase())
        let name = wanted
        for (let i = 2; taken(name); i++) name = `${wanted} (${i})`

        const dirArg = optStr(ctx.body, 'dir')
        let cwd = floor?.dir ?? (other ? targetDir ?? ctx.caller.cwd : ctx.caller.cwd)
        if (dirArg !== undefined) {
          cwd = expandPath(dirArg, ctx.caller.cwd)
          if (!isDirectory(cwd)) throw new HttpError(400, `diretório não existe: ${cwd}`)
        }

        const bandRaw = optStr(ctx.body, 'band')
        const bandArg = bandRaw === undefined ? undefined : localName(bandRaw)
        let band: BandNode | undefined
        if (bandArg !== undefined) {
          band = Object.values(tws.nodes).find((n): n is BandNode => n.kind === 'band' && n.floorId === floorId && n.name.toLowerCase() === bandArg.toLowerCase())
          const allowed = band !== undefined && (other || floorId !== ctx.caller.floorId || band.members.includes(ctx.caller.id) || reachable(tws, ctx.caller.id).some((n) => n.id === band!.id))
          if (!band || !allowed) throw new HttpError(404, `banda '${bandArg}' não encontrada`)
        } else if (!other && floorId === ctx.caller.floorId) {
          // Você numa banda: o recruta no seu andar entra nela em vez de ganhar uma corda.
          band = Object.values(tws.nodes).find((n): n is BandNode => n.kind === 'band' && n.members.includes(ctx.caller.id))
        }

        // À direita do chamador; se ocupado (ou em outro andar/workspace), o próximo espaço livre mais à direita.
        const occupied = Object.values(tws.nodes).filter((n) => n.floorId === floorId && n.kind !== 'band')
        const near = !other && floorId === ctx.caller.floorId
        const spot = { pos: near ? { x: ctx.caller.pos.x + ctx.caller.size.w + RECRUIT_GAP, y: ctx.caller.pos.y } : { x: 0, y: 0 }, size: { ...RECRUIT_SIZE } }
        for (let i = 0; i < 200 && occupied.some((n) => overlaps(spot, n)); i++) spot.pos.x += RECRUIT_SIZE.w + RECRUIT_GAP

        let id: string
        try {
          id = target.addNode({
            kind: 'terminal', floorId, name, agent: setup.agent, command: setup.command, cwd, recruitedBy: ctx.caller.id, pos: spot.pos, size: spot.size,
            ...(setup.role === undefined ? {} : { role: setup.role }),
            ...(setup.accountId === undefined ? {} : { accountId: setup.accountId }),
            ...(setup.maestro ? { maestro: true } : {}),
            ...look
          })
        } catch (err) {
          throw new HttpError(400, err instanceof Error ? err.message : String(err))
        }
        if (band) target.bandAdd(band.id, id)
        else if (!other) store.connect(ctx.caller.id, id)
        // Outro workspace: corda entre workspaces; vocês se enxergam como `Nome @ Workspace`.
        else links.connect(ctx.caller.id, id)
        const created = target.get().nodes[id]
        if (created?.kind === 'terminal') spawn.call(terminals, created)
        const where = other ? ` no workspace ${wsName}${floor ? `, floor ${floor.name}` : ''}; endereço: ${name} @ ${workspaceNameOf(id) ?? wsName}` : floorId === ctx.caller.floorId ? '' : ` no floor ${floor?.name ?? GROUND}`
        const details = `${where}${band ? ` na banda ${band.name}` : ''}`
        const message = ['claude', 'codex', 'antigravity'].includes(setup.agent)
          ? mt('OK: {p1} recrutado{p2} (o ask espera ele ficar pronto)', { p1: name, p2: details })
          : mt('OK: {p1} recrutado{p2} (o palco não sabe quando esse tipo fica pronto; selecione o tipo de agente)', { p1: name, p2: details })
        return text(`${message}${setup.warning ? `\n${setup.warning}` : ''}`)
      },

      'POST /dismiss': (ctx) => {
        const { dispose } = terminals
        if (!dispose) throw new HttpError(501, 'dismiss indisponível')
        const node = terminalTarget(ctx, str(ctx.body, 'name'))
        // Só quem recrutou encerra: um agente não derruba o orquestrador, nem o terminal que o usuário criou.
        if (!canDismiss(ctx.caller, node)) throw new HttpError(403, `só é possível encerrar agentes que você recrutou ('${node.name}' não é um deles)`)
        ownerOf(node.id).assertRemovable(node.id)
        dispose.call(terminals, node.id)
        ownerOf(node.id).removeNode(node.id)
        return text(`OK: ${node.name} encerrado`)
      },

      'POST /band/create': (ctx) => {
        const name = requireName(ctx.body)
        const raw = ctx.body.members ?? []
        if (!Array.isArray(raw) || raw.some((m) => typeof m !== 'string')) throw new HttpError(400, "campo 'members' deve ser uma lista de nomes")
        const wsArg = optStr(ctx.body, 'workspace')
        if (wsArg !== undefined) return remoteBand(ctx, name, raw as string[], wsArg)
        const withoutMe = optBool(ctx.body, 'withoutMe') === true
        const floorArg = optStr(ctx.body, 'floor')
        const floorId: FloorId = floorArg === undefined ? ctx.caller.floorId : floorArg.toLowerCase() === GROUND ? null : floorByName(floorArg).id
        if (nameTaken(floorId, name)) throw new HttpError(409, `já existe um nó chamado '${name}' neste floor`)
        const ws = store.get()
        const inBand = new Set(Object.values(ws.nodes).flatMap((n) => (n.kind === 'band' ? n.members : [])))
        let members: string[]
        if (raw.length > 0) {
          members = (raw as string[]).map((m) => {
            const t = memberTarget(ctx, m)
            if (t.floorId !== floorId) throw new HttpError(400, `'${t.name}' não está no andar da banda`)
            return t.id
          })
        } else {
          // Sem nomes: todos os terminais ligados a você naquele andar que ainda não estão numa banda.
          const linked = ws.connections.flatMap((c) => (c.a === ctx.caller.id ? [c.b] : c.b === ctx.caller.id ? [c.a] : []))
          members = linked.filter((id) => { const n = ws.nodes[id]; return n?.kind === 'terminal' && n.floorId === floorId && !inBand.has(id) })
        }
        if (!withoutMe && floorId === ctx.caller.floorId) members = [...members, ctx.caller.id]
        members = [...new Set(members)]
        if (members.length < 2) throw new HttpError(400, 'uma banda precisa de pelo menos dois agentes')
        const look = appearance(ctx.body)
        const id = store.createBand(name, members, floorId)
        if (Object.keys(look).length) store.patchNode(id, look)
        if (floorId === ctx.caller.floorId) store.connect(ctx.caller.id, id)
        return text(`OK: banda ${name} criada com ${members.length} membro(s)`)
      },

      'POST /band/add': (ctx) => {
        const band = bandTarget(ctx, str(ctx.body, 'band'))
        const member = memberTarget(ctx, str(ctx.body, 'member'))
        try {
          ownerOf(band.id).bandAdd(band.id, member.id)
        } catch (err) {
          throw new HttpError(400, err instanceof Error ? err.message : String(err))
        }
        return text(`OK: ${member.name} entrou em ${band.name}`)
      },

      'POST /band/remove': (ctx) => {
        const band = bandTarget(ctx, str(ctx.body, 'band'))
        const wanted = localName(str(ctx.body, 'member')).toLowerCase()
        const ws = ownerOf(band.id).get()
        const id = band.members.find((m) => ws.nodes[m]?.name.toLowerCase() === wanted)
        if (id === undefined) throw new HttpError(404, `'${str(ctx.body, 'member')}' não é membro de ${band.name}`)
        ownerOf(band.id).bandRemove(band.id, id)
        return text(`OK: ${ws.nodes[id]!.name} saiu de ${band.name}`)
      },

      'POST /band/dissolve': (ctx) => {
        const band = bandTarget(ctx, str(ctx.body, 'band'))
        ownerOf(band.id).dissolveBand(band.id)
        return text(`OK: banda ${band.name} dissolvida`)
      },

      'POST /floor/create': (ctx) =>
        guard(async () => {
          requireMaestro(ctx.caller)
          const pullRequest = optStr(ctx.body, 'pullRequest'), copy = optBool(ctx.body, 'copy') === true
          const name = pullRequest !== undefined && !ctx.body.name ? '' : requireName(ctx.body)
          const wsDir = workspaceDir() ?? ctx.caller.cwd
          const fromArg = optStr(ctx.body, 'from'), dirArg = optStr(ctx.body, 'dir')
          const existingBranch = optBool(ctx.body, 'existingBranch') === true, noGit = optBool(ctx.body, 'noGit') === true
          const branch = optStr(ctx.body, 'branch')
          if (dirArg !== undefined && (fromArg !== undefined || branch !== undefined || existingBranch || noGit)) throw new HttpError(400, '--dir não combina com --from, --branch, --existing-branch nem --no-git')
          if (existingBranch && branch === undefined) throw new HttpError(400, '--existing-branch precisa de --branch')
          if (copy && (noGit || dirArg !== undefined)) throw new HttpError(400, '--copy não combina com --no-git nem --dir')
          if (pullRequest !== undefined && (branch !== undefined || existingBranch || noGit || dirArg !== undefined)) throw new HttpError(400, '--pull-request não combina com --branch, --existing-branch, --no-git nem --dir')
          const partituraName = optStr(ctx.body, 'partitura')
          if (partituraName !== undefined && !deps.partituras) throw new HttpError(501, 'partituras indisponíveis')
          // Antes de criar o andar: uma importada ainda não confirmada não inicia por aqui.
          if (partituraName !== undefined) assertConfirmed(deps.partituras!.get(partituraName), true, false)
          let input: NewFloor
          if (dirArg !== undefined) {
            input = { name, fromDir: wsDir, dir: userFloorDir(dirArg, wsDir) }
          } else {
            const fromDir = fromArg === undefined ? wsDir : expandPath(fromArg, wsDir)
            if (!isDirectory(fromDir)) throw new HttpError(400, `a pasta de base não existe: ${fromDir}`)
            input = { name, fromDir, ...(branch === undefined ? {} : { branch }), ...(existingBranch ? { existingBranch } : {}), ...(noGit ? { noGit } : {}), ...(fromArg === undefined ? {} : { baseDir: fromDir }), ...(copy ? { copy } : {}), ...(pullRequest === undefined ? {} : { pullRequest }) }
          }
          const floor = await floorsOrFail().create(input)
          const notes: string[] = []
          if (floor.plain && !noGit && dirArg === undefined) notes.push('a pasta não é um repositório git: andar simples, sem isolamento')
          if (floor.pullRequest && !floor.pullRequest.sameRepository) notes.push(`cópia dos commits em ${floor.branch}: o que for commitado aqui não chega ao pull request`)
          if (optBool(ctx.body, 'copyGround') === true) {
            const ground = capturePartitura(store.get(), null, { noteText: true })
            if (ground.nodes.length > 0) insertPartitura(store, { ...ground, name: 'térreo', createdAt: new Date().toISOString() }, floor.id, { x: 0, y: 0 }, { commands: false })
          }
          if (partituraName !== undefined) {
            const before = new Set(Object.keys(store.get().nodes))
            startPartitura(deps.partituras!, store, partituraName, floor.id, { x: 0, y: 0 }, true, (node) => { if (!terminals.spawn) throw new HttpError(501, 'spawn indisponível'); terminals.spawn(node) }, deps.agents, terminals.dispose ? (id) => terminals.dispose!(id) : undefined)
            // Conectada a você: os terminais da partitura ficam ligados ao chamador (terminal↔terminal cruza andares).
            for (const n of Object.values(store.get().nodes)) if (!before.has(n.id) && n.kind === 'terminal') store.connect(ctx.caller.id, n.id)
          }
          return json({ name: floor.name, dir: floor.dir, branch: floor.branch || null, git: !floor.plain, ...(floor.copy ? { copy: true } : {}), ...(floor.pullRequest ? { pullRequest: floor.pullRequest.url } : {}), ...(notes.length ? { note: notes.join('; ') } : {}) })
        }),

      'GET /floor/list': (ctx) => {
        requireMaestro(ctx.caller)
        const ws = store.get()
        const count = (id: FloorId): number => Object.values(ws.nodes).filter((n) => n.floorId === id).length
        return json([
          { name: 'Ground', dir: workspaceDir() ?? null, nodes: count(null), ...(ws.groundStatus ? { status: ws.groundStatus } : {}), ...(isUnloadedPlace(Object.values(ws.nodes).filter((n) => n.floorId === null)) ? { unloaded: true } : {}), active: ws.activeFloor === null },
          ...Object.values(ws.floors).map((f) => ({
            name: f.name,
            dir: f.dir,
            branch: f.branch || null,
            baseRef: f.baseRef || null,
            git: !f.plain,
            ...(f.baseDir ? { baseDir: f.baseDir } : {}),
            nodes: count(f.id),
            ...(f.status ? { status: f.status } : {}),
            ...(isUnloadedPlace(Object.values(ws.nodes).filter((n) => n.floorId === f.id)) ? { unloaded: true } : {}),
            active: ws.activeFloor === f.id
          }))
        ])
      },

      'POST /floor/land': (ctx) =>
        guard(async () => {
          const floors = floorsOrFail()
          const floor = floors.byName(str(ctx.body, 'name'))
          assertGroundMaestro(ctx.caller, 'fazer o land de')
          const into = optStr(ctx.body, 'into')
          const deleteBranch = optBool(ctx.body, 'deleteBranch')
          const keepFloor = optBool(ctx.body, 'keepFloor')
          const result = await floors.land(floor.id, {
            ...(into === undefined ? {} : { into }),
            ...(deleteBranch === undefined ? {} : { deleteBranch }),
            ...(keepFloor === undefined ? {} : { keepFloor })
          })
          if (!result.ok) {
            const list = result.conflicts?.length ? `\narquivos em conflito:\n${result.conflicts.map((f) => `  ${f}`).join('\n')}` : ''
            throw new HttpError(409, `${result.error}${list}`)
          }
          return text(`OK: ${result.merged} integrado em ${result.into}`)
        }),

      'POST /floor/delete': (ctx) =>
        guard(async () => {
          const floors = floorsOrFail()
          const floor = floors.byName(str(ctx.body, 'name'))
          assertGroundMaestro(ctx.caller, 'excluir')
          const force = optBool(ctx.body, 'force')
          const keepBranch = optBool(ctx.body, 'keepBranch')
          const keepFolder = optBool(ctx.body, 'keepFolder')
          await floors.remove(floor.id, { ...(force === undefined ? {} : { force }), ...(keepBranch === undefined ? {} : { keepBranch }), ...(keepFolder === undefined ? {} : { keepFolder }) })
          return text(`OK: floor ${floor.name} removido${floor.plain || floor.external || keepFolder ? ' (a pasta ficou)' : ''}`)
        }),

      'POST /floor/unload': (ctx) =>
        guard(async () => {
          requireMaestro(ctx.caller)
          const named = str(ctx.body, 'name')
          const floor = named.toLowerCase() === GROUND ? undefined : floorsOrFail().byName(named)
          const floorId: FloorId = floor?.id ?? null, label = floor?.name ?? 'Ground'
          if (floorId === ctx.caller.floorId) throw new HttpError(409, `não dá para descarregar o seu próprio andar (${label})`)
          // O andar na tela subiria de novo na hora (os terminais dele são acordados por estarem visíveis).
          if ((!registry || registry.activeId() === registry.idOf(store)) && store.get().activeFloor === floorId) throw new HttpError(409, `o andar ${label} está na tela: troque de andar antes`)
          const count = await unload(Object.values(store.get().nodes).filter((n) => n.floorId === floorId))
          if (!count) throw new HttpError(409, `nada rodando em ${label}`)
          return text(`OK: ${label} descarregado (${count} terminal(is)); um ask para um agente de lá o acorda`)
        }),

      'POST /floor/set-dir': (ctx) =>
        guard(() => {
          requireMaestro(ctx.caller)
          const floor = floorsOrFail().byName(str(ctx.body, 'name'))
          if (!floor.plain) throw new HttpError(409, `o andar ${floor.name} tem checkout próprio: crie um andar novo em vez de mudar a pasta`)
          const dir = userFloorDir(str(ctx.body, 'dir'), workspaceDir() ?? ctx.caller.cwd, floor.id)
          store.setFloorDir(floor.id, dir)
          return text(`OK: o andar ${floor.name} agora usa ${dir}; terminais já abertos ficam onde estão`)
        }),

      'POST /floor/status': (ctx) =>
        guard(() => {
          const named = optStr(ctx.body, 'floor')
          // Térreo: só o Maestro publica o resumo dos andares (`--floor "Ground"`).
          if ((named !== undefined && named.toLowerCase() === GROUND) || (named === undefined && ctx.caller.floorId === null)) {
            // Nomear o térreo de outro andar exige o Maestro; no próprio térreo, qualquer terminal publica.
            if (named !== undefined && ctx.caller.floorId !== null) requireMaestro(ctx.caller)
            return applyStatus(ctx, 'Ground', store.get().groundStatus, (st) => store.setGroundStatus(st))
          }
          const floors = floorsOrFail()
          let floor
          if (named !== undefined) {
            floor = floors.byName(named)
            if (floor.id !== ctx.caller.floorId) requireMaestro(ctx.caller)
          } else floor = floors.byId(ctx.caller.floorId!)
          const id = floor.id
          return applyStatus(ctx, floor.name, floor.status, (st) => floors.setStatus(id, st ?? null))
        }),

      'POST /portal': async (ctx) => {
        const portals = deps.portals
        if (!portals) throw new HttpError(501, 'portais indisponíveis')
        const action = str(ctx.body, 'action')
        if (action === 'create') {
          const args = ctx.body.args
          if (!Array.isArray(args) || args.length < 1 || args.length > 2 || args.some(v => typeof v !== 'string') || !isPortalUrl(args[0])) throw new HttpError(400, 'URL/argumentos inválidos')
          const prefs = deps.preferences?.()
          const size = args[1] === undefined ? prefs ? [prefs.defaultPortalSize.width, prefs.defaultPortalSize.height] : [1280, 800] : /^\d+x\d+$/.test(args[1]) ? args[1].split('x').map(Number) : []
          if (size.length !== 2 || size.some((v: number) => !Number.isSafeInteger(v) || v < 200 || v > 4096)) throw new HttpError(400, 'tamanho deve ficar entre 200 e 4096 px')
          const name = uniqueName(store, requireName(ctx.body))
          const wantedAt = { x: ctx.caller.pos.x + ctx.caller.size.w + 40, y: ctx.caller.pos.y }
          const at = prefs ? freeSpot(prefs.agentPortalPlacement, Object.values(store.get().nodes), ctx.caller.floorId, wantedAt, { w: size[0]!, h: size[1]! }) : wantedAt
          const id = store.addNode({kind:'portal',name,url:args[0],floorId:ctx.caller.floorId,pos:at,size:{w:size[0]!,h:size[1]!},...(prefs && {storage:prefs.defaultPortalStorage})})
          store.connect(ctx.caller.id,id)
          const loaded = await portals.waitForLoad?.(id, 15_000).catch((error: unknown) => { throw new HttpError(400, (error as Error).message) })
          return text(`Criado o portal "${name}"${loaded === 'timeout' ? `\n${mt('a página ainda está carregando')}` : ''}`)
        }
        const node = portalTarget(ctx, str(ctx.body, 'name'))
        const raw = ctx.body.args
        const args = raw === undefined ? [] : raw
        if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new HttpError(400, "campo 'args' deve ser uma lista de textos")
        const a = args as string[]
        const arity = PORTAL_ARITY
        if (!Object.hasOwn(arity, action)) throw new HttpError(400, `ação desconhecida: ${action}`)
        if (!arity[action]!.includes(a.length)) throw new HttpError(400, `argumentos errados para ${action}`)
        try {
          switch (action) {
            case 'edit':
              if(a[0] !== '--url' || !isPortalUrl(a[1]!)) throw new HttpError(400, 'URL inválida')
              store.patchNode(node.id,{url:a[1]!}); return text(await portals.navigate(node.id,a[1]!))
            case 'close': if(node.id.startsWith('popup-')) portals.closePopup?.(node.id); else { store.assertRemovable(node.id); portals.unregister?.(node.id); store.removeNode(node.id) } return text('OK')
            case 'forward': if(!portals.forward) throw new Error('avançar indisponível'); return text(await portals.forward(node.id))
            case 'info': if(!portals.info) throw new Error('info indisponível'); return text(await portals.info(node.id))
            case 'navigate': return text(await portals.navigate(node.id, a[0]!))
            case 'snapshot': return text(await portals.snapshot(node.id))
            case 'click': return text(await portals.click(node.id, a[0]!.replace(/^@(?=e\d+$)/,'')))
            case 'fill': return text(await portals.fill(node.id, a[0]!.replace(/^@(?=e\d+$)/,''), a[1]!))
            case 'text':
              if(a[0] !== undefined) { if(!portals.elementText) throw new Error('texto por seletor indisponível'); return text(await portals.elementText(node.id,a[0])) }
              return text(await portals.text(node.id))
            case 'screenshot': return text(await portals.screenshot(node.id, a[0]))
            case 'back': return text(await portals.back(node.id))
            case 'reload': return text(await portals.reload(node.id))
            default:
              if(!portals.action)throw new Error('automação indisponível')
              return text(await portals.action(node.id,action,action==='upload'?[a[0]!,...a.slice(1).map(file=>resolvePath(ctx.caller.cwd,file))]:a))
          }
        } catch (err) {
          if (err instanceof LockedError) throw err
          if (err instanceof PortalClosedError) throw new HttpError(409, err.message)
          throw new HttpError(400, err instanceof Error ? err.message : String(err))
        }
      },

      'POST /ready': ({ caller, body }) => {
        deps.onAgentEvent?.(caller.id, 'ready', typeof body.sessionId === 'string' ? body.sessionId : undefined)
        terminals.markReady(caller.id)
        return text('OK')
      },

      'POST /busy': ({ caller, body }) => {
        deps.onAgentEvent?.(caller.id, 'busy', typeof body.sessionId === 'string' ? body.sessionId : undefined)
        terminals.markReady(caller.id)
        terminals.notePromptHook(caller.id)
        broker.onBusy(caller.id)
        return text('OK')
      },

      'POST /turn-ended': ({ caller, body }) => {
        deps.onAgentEvent?.(caller.id, 'turn', typeof body.sessionId === 'string' ? body.sessionId : undefined)
        terminals.markReady(caller.id)
        terminals.notePromptHook(caller.id)
        const inputs = Array.isArray(body.inputMessages)
          ? body.inputMessages.filter((m): m is string => typeof m === 'string')
          : undefined
        broker.onTurnEnded(caller.id, typeof body.lastMessage === 'string' ? body.lastMessage : undefined, inputs)
        deps.chat?.turnEnded(caller.id)
        return text('OK')
      },

      ...createWorkspaceRoutes(registry, store, {
        isRunning: id => terminals.isRunning(id),
        ...(stopper(terminals) ? { stop: stopper(terminals)! } : {}),
        ...(terminals.dispose ? { dispose: (id: string) => terminals.dispose!(id) } : {}),
        ...(deps.portals?.unregister ? { unregister: (id: string) => deps.portals!.unregister!(id) } : {})
      })
    }
    Object.assign(routes, createRoutineRoutes({ routines: deps.routines, store, memberTarget, nameOf: nameOfAny }))
    if (deps.partituras) Object.assign(routes, createPartituraRoutes(deps.partituras, store, node => { if (!terminals.spawn) throw new HttpError(501, 'spawn indisponível'); terminals.spawn(node) }, deps.agents, terminals.dispose ? id => terminals.dispose!(id) : undefined, { workspaceStore: (name) => { const meta = registry?.workspaceByName(name); return meta ? registry!.get(meta.id) : undefined }, crossLink: (a, b) => links.connect(a, b) }))
    if (deps.agents) Object.assign(routes, createAgentRoutes(deps.agents, store, deps.partituras, registry ? () => registry.allNodes() : undefined, { ...(deps.accounts ? { accounts: deps.accounts } : {}), workspaceId: () => registry?.idOf(store) ?? store.get().id, unassignRole: (id) => (registry?.storeOfNode(id) ?? store).setTerminalRole(id) }))
    if (deps.accounts) Object.assign(routes, createAccountRoutes(deps.accounts))
    return routes
  }

  const server = http.createServer((req, res) => {
    const send = (r: Reply): void => {
      // Erros de recebimento (408/413) fecham a conexão: o resto do corpo não será lido.
      const close = r.status === 408 || r.status === 413 ? { connection: 'close' } : {}
      res.writeHead(r.status, { 'content-type': `${r.type ?? 'text/plain'}; charset=utf-8`, ...close })
      res.end(r.body)
    }
    // Conexão que cai antes da resposta cancela o trabalho pendente (ex.: ask na fila do broker).
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abort.abort()
    })
    void (async () => {
      try {
        // A identidade vem só do token (credencial por terminal e por geração); IDs de nó não são prova de nada.
        const token = req.headers[HEADER_TOKEN]
        const who = typeof token === 'string' && token !== '' ? terminals.identify(token) : undefined
        const store = who === undefined ? undefined : storeOf(who.id)
        const caller = who === undefined ? undefined : store?.get().nodes[who.id]
        if (who === undefined || store === undefined || caller?.kind !== 'terminal') throw new HttpError(401, 'token ausente ou inválido')
        const url = new URL(req.url ?? '/', 'http://palco')
        const handler = routesFor(store)[`${req.method} ${url.pathname}`]
        if (!handler) throw new HttpError(404, `sem rota para ${req.method} ${url.pathname}`)
        const body = req.method === 'POST' ? await readBody(req, bodyTimeoutMs) : {}
        // O corpo pode ter demorado: se o terminal reiniciou nesse meio tempo, a credencial desta requisição já não vale.
        const still = typeof token === 'string' ? terminals.identify(token) : undefined
        if (still?.id !== who.id || still.gen !== who.gen) throw new HttpError(401, 'token revogado (o terminal reiniciou)')
        send(await handler({ caller, url, body, signal: abort.signal }))
      } catch (err) {
        if (err instanceof HttpError || err instanceof AgentConfigError || err instanceof AccountError || err instanceof RouteError) send(text(err.message, err.status))
        else if (err instanceof LockedError) send(text(err.message, 409))
        else send(text(`erro interno: ${err instanceof Error ? err.message : String(err)}`, 500))
      }
    })()
  })
  // O prazo vale para receber a requisição; a espera pela resposta do agente (ask) é limitada só pelo broker.
  server.headersTimeout = 10_000
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.timeout = 0

  if (existsSync(socketPath)) rmSync(socketPath, { force: true })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  chmodSync(socketPath, 0o600)

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(socketPath, { force: true })
          resolve()
        })
        server.closeAllConnections()
      })
  }
}

/** Encerra o terminal e aguarda a saída do processo; sem esse caminho, usa o descarte simples. */
function stopper(terminals: ServerDeps['terminals']): ((id: string) => Promise<void>) | undefined {
  if (terminals.unload) return (id) => terminals.unload!(id)
  return terminals.dispose ? async (id) => { terminals.dispose!(id) } : undefined
}

/** Quanto `ask --raw` espera antes de devolver a tela. */
const RAW_SETTLE_MS = 600

/** `recall --last` e `--from/--to` (datas no fuso deste computador; `--to` inclui o dia inteiro) em segundos. */
function recallPeriod(p: URLSearchParams): { since?: number; until?: number } {
  const last = p.get('last'), from = p.get('from'), to = p.get('to')
  if (last !== null) {
    const days = last === 'day' ? 1 : last === 'week' ? 7 : last === 'month' ? 30 : 0
    if (!days) throw new HttpError(400, "'last' aceita day, week ou month")
    return { since: Date.now() / 1000 - days * 86_400 }
  }
  const at = (v: string, time: string): number => {
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${time}`).getTime() : NaN
    if (!Number.isFinite(ms)) throw new HttpError(400, 'data inválida: use AAAA-MM-DD')
    return ms / 1000
  }
  return { ...(from !== null ? { since: at(from, '00:00:00') } : {}), ...(to !== null ? { until: at(to, '23:59:59.999') } : {}) }
}

/** Land e delete de andar (skill palco-workspace): só o Maestro, e só a partir do térreo. */
function assertGroundMaestro(caller: { floorId: FloorId; maestro?: boolean }, action: string): void {
  requireMaestro(caller)
  if (caller.floorId !== null) throw new HttpError(403, `só é possível ${action} um andar a partir de um terminal no térreo`)
}

export const IDLE_NOTICE = '[palco: o agente não sinalizou fim de turno; abaixo está a tela dele depois de um silêncio, não uma resposta]'

/** Num shell o silêncio é o fim normal; num agente é sinal de que o prompt pode não ter chegado ou o turno não terminou. */
function answerText(to: { agent: AgentKind }, result: { text: string; via: 'hook' | 'askback' | 'idle' }): string {
  return result.via === 'idle' && to.agent !== 'shell' ? `${IDLE_NOTICE}\n${result.text}` : result.text
}
