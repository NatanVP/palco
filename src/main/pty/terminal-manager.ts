import { localShellEnvironment, addCliToEnvironment } from './shell-environment'
export { stripInherited } from './shell-environment'
import type { EnvironmentInput, Prepared } from '../environments/runtime'
import { homedir } from 'node:os'
import type { Account } from '../../shared/model'
import { accountEnvironment } from '../accounts/account-store'
import { mt } from '../i18n'
import { dialogOpen, promptLanded } from './prompt-landing'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IPty } from 'node-pty'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { SerializeAddon as SerializeAddonT } from '@xterm/addon-serialize'
import { ENV_TOKEN } from '../../shared/auth'
import { ENV_SOCKET, ENV_TERMINAL, type TerminalNode } from '../../shared/model'
import { takesRole } from '../domain/terminal-extras'
import { agentRoleEnv, buildAgentCommand, CLAUDE_SETTINGS_ENV, claudeSettings, CODEX_ROLE_ENV, codexRoleFits } from './agent-command'

// Pacotes CJS: createRequire evita a interop frágil de import nomeado no main ESM.
const require_ = createRequire(import.meta.url)
const pty = require_('node-pty') as typeof import('node-pty')
const { Terminal } = require_('@xterm/headless') as typeof import('@xterm/headless')
const { SerializeAddon } = require_('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize')

export const ENV_CLI = 'PALCO_CLI'
const COLS = 120
const ROWS = 32
const BOOT_DELAY_MS = 300
const ENTER_DELAY_MS = 150
const READY_QUIET_MS = 1500
const READY_TIMEOUT_MS = 30000
const PROMPT_CONFIRM_MS = 4000
const READY_HOOK_DELAY_MS = 500
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

function isProcessAlive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[0] !== 'Z'
  } catch {
    try { process.kill(pid, 0); return true } catch { return false }
  }
}

function liveSessions(sids: Set<number>): Map<number, number[]> {
  const found = new Map([...sids].map((sid) => [sid, [] as number[]]))
  try {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
        const session = Number(fields[3]), members = found.get(session)
        if (members && fields[0] !== 'Z') members.push(Number(entry))
      } catch { /* processo terminou durante a enumeração */ }
    }
  } catch { /* /proc não existe ou não está disponível */ }
  return found
}

function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) { try { process.kill(pid, signal) } catch { /* já encerrou */ } }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface PendingPrompt { text: string; settle?: (sent: boolean) => void }

interface Entry {
  node: TerminalNode
  /** Geração do processo: sobe a cada spawn do mesmo id. */
  gen: number
  /** Há uma tela (xterm do renderer) ligada: é ela que responde às consultas do programa. */
  viewed: boolean
  pty: IPty
  screen: HeadlessTerminal
  serializer: SerializeAddonT
  /** Último chunk já aplicado na tela headless (e já emitido a onData). */
  seq: number
  received: number
  running: boolean
  disposed: boolean
  timers: Set<NodeJS.Timeout>
  /** Agente (claude/codex) precisa de boot; shell puro nasce pronto. */
  ready: boolean
  bootSent: boolean
  quiet?: NodeJS.Timeout
  readyScheduled: boolean
  /** O teto estourou sem sinal de prontidão: prompts são recusados até um sinal chegar. */
  readyFailed: boolean
  /** Esperam a prontidão. Os com `settle` (Chat) sobrevivem ao teto e avisam se saíram ou se perderam. */
  pendingPrompts: PendingPrompt[]
  token: string
  cleanup?: () => void
  /** Chegou hook do agente desde a última entrega de prompt? */
  promptHook: boolean
  /** Parada em curso (restart): resolve quando o processo sai. */
  stopping?: Promise<void>
  onStopped?: () => void
}

/**
 * Grupo em primeiro plano do terminal do shell (Linux: campo tpgid de /proc/<pid>/stat), para o sinal
 * chegar também ao programa que roda no terminal. `undefined` quando não dá para saber.
 */
function foregroundGroup(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const tpgid = Number(fields[5])
    return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : undefined
  } catch { return undefined }
}

/** Sinal para o shell, o grupo dele e o grupo em primeiro plano do terminal (o programa em execução). */
function signalTree(pid: number, signal: NodeJS.Signals): void {
  const targets = new Set<number>([-pid])
  const fg = foregroundGroup(pid)
  if (fg !== undefined && fg !== pid) targets.add(-fg)
  targets.add(pid)
  for (const target of targets) {
    try { process.kill(target, signal) } catch { /* já saiu ou sem permissão */ }
  }
}

export interface TerminalManagerOptions {
  socketPath: string
  palcoBin: string
  /** Adaptador de PTY injetável para testar ambiente sem criar processos. */
  spawnPty?: typeof pty.spawn
  resolveAccount?: (id: string) => Account | undefined
  resolveRole?: (name: string) => { file: string; text: string }
  settingsDir?: string
  /** Problema não fatal ao subir um terminal (ex.: role que sumiu: o terminal sobe sem ele). */
  /** Chamado antes de subir cada terminal (ex.: instalar as skills do palco na pasta do agente); erro vira aviso. */
  beforeSpawn?(node: TerminalNode): void
  onWarning?: (id: string, message: string) => void
  env?: NodeJS.ProcessEnv
  /** Silêncio na saída, depois do boot, que marca o agente como pronto (padrão 1500). */
  readyQuietMs?: number
  /** Teto para o agente ficar pronto; estourou, os prompts pendentes falham (padrão 30000). */
  readyTimeoutMs?: number
  /** Prazo para o agente confirmar que aceitou o prompt entregue (padrão 4000). */
  promptConfirmMs?: number
  /** Envia o sinal ao processo do terminal (padrão: shell, grupo dele e o grupo em primeiro plano). */
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void
  /** Partida de terminais fora do shell local (tmux, SSH, Docker, Sandbox). Sem isso, só o local sobe. */
  environments?: { prepare(input: EnvironmentInput): Promise<Prepared>; dispose?(id: string): void | Promise<void> }
  /** `startConfirmed`: quanto o processo precisa ficar de pé para a partida valer (padrão 600). */
  startGraceMs?: number
  /** Restart: prazo após SIGTERM antes do SIGKILL (padrão 3000) e após SIGKILL antes de desistir (padrão 1000). */
  stopTimeoutMs?: number
  killTimeoutMs?: number
}

type DataCb = (id: string, data: string, seq: number, gen: number) => void
type ExitCb = (id: string, code: number) => void
type FailCb = (id: string) => void

export class TerminalManager {
  private readonly entries = new Map<string, Entry>()
  private readonly gens = new Map<string, number>()
  /** Último tamanho pedido pela tela de cada terminal: o processo novo (restart) nasce nele. */
  private readonly sizes = new Map<string, { cols: number; rows: number }>()
  /** token → id do terminal; só em memória, uma credencial por processo vivo. */
  private readonly tokens = new Map<string, { id: string; gen: number }>()
  private readonly dataCbs = new Set<DataCb>()
  private readonly exitCbs = new Set<ExitCb>()
  private readonly failCbs = new Set<FailCb>()
  private readonly rejectCbs = new Set<FailCb>()
  private readonly quietMs: number
  private readonly timeoutMs: number
  private readonly confirmMs: number

  constructor(private readonly opts: TerminalManagerOptions) {
    this.quietMs = opts.readyQuietMs ?? READY_QUIET_MS
    this.timeoutMs = opts.readyTimeoutMs ?? READY_TIMEOUT_MS
    this.confirmMs = opts.promptConfirmMs ?? PROMPT_CONFIRM_MS
  }

  spawn(node: TerminalNode, restart = false): void {
    if (this.shuttingDown) return
    if (this.entries.get(node.id)?.running || this.launching.has(node.id)) return
    try { this.opts.beforeSpawn?.(node) } catch (err) { this.opts.onWarning?.(node.id, `skills do palco não instaladas: ${(err as Error).message}`) }
    const role = this.roleFor(node)
    const env = localShellEnvironment(process.env, this.opts.env)
    env.COLORTERM ??= 'truecolor'
    const account = accountEnvironment(node, id => this.opts.resolveAccount?.(id))
    // A pasta da conta nunca é herdada do processo do palco: se ele foi aberto de dentro de um Claude
    // com CLAUDE_CONFIG_DIR (ex.: ~/.claude-sonnet), um terminal "Padrão" usaria essa conta sem aviso.
    // Sem conta escolhida, o CLI usa a pasta padrão dele (~/.claude, ~/.codex).
    delete env.CLAUDE_CONFIG_DIR; delete env.CODEX_HOME
    if (node.accountId) {
      // Uma seleção explícita também não herda credenciais de outra conta do processo pai.
      delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.CLAUDE_CODE_OAUTH_TOKEN
      delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY
    }
    Object.assign(env, account.env)
    if (account.warning) this.opts.onWarning?.(node.id, account.warning)
    env[ENV_SOCKET] = this.opts.socketPath
    env[ENV_TERMINAL] = node.id
    delete env[CODEX_ROLE_ENV]
    Object.assign(env, agentRoleEnv(node.agent, role))
    let settingsContent: string | undefined
    let cleanupSettings = () => {}
    if (node.agent === 'claude') {
      const dir = this.opts.settingsDir ?? join(homedir(), '.palco', 'run', 'settings')
      const file = join(dir, `${randomBytes(16).toString('hex')}.json`)
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700)
        settingsContent = JSON.stringify(claudeSettings(this.opts.palcoBin))
        writeFileSync(file, settingsContent, { mode: 0o600, flag: 'wx' })
        env[CLAUDE_SETTINGS_ENV] = file
        let cleaned = false
        cleanupSettings = () => { if (!cleaned) { cleaned = true; rmSync(file, { force: true }) } }
      } catch (error) {
        this.opts.onWarning?.(node.id, mt('não foi possível preparar as configurações do Claude: {p1}', { p1: (error as Error).message }))
        cleanupSettings()
        return
      }
    }
    const boot = buildAgentCommand(node.agent, node.command, this.opts.palcoBin, role)
    // O agente precisa saber o próprio nome para responder e se apresentar (renomear exige reiniciar o terminal).
    env.PALCO_NAME = node.name
    addCliToEnvironment(env, this.opts.palcoBin)
    const token = randomBytes(32).toString('hex')
    env[ENV_TOKEN] = token
    const shell = env.SHELL || '/bin/bash'
    if (node.environment && node.environment.kind !== 'local') {
      const preparing = this.spawnElsewhere(node, shell, env, token, boot, restart, settingsContent, cleanupSettings).finally(() => { if (this.preparing.get(node.id) === preparing) this.preparing.delete(node.id) })
      this.preparing.set(node.id, preparing)
      return
    }
    try { this.start(node, shell, [], node.cwd, env, token, boot, cleanupSettings) }
    catch (error) { cleanupSettings(); throw error }
  }

  private readonly launching = new Map<string, AbortController>()
  private shuttingDown = false
  /** Preparo em andamento de um ambiente (tmux, SSH, Docker, Sandbox). */
  private readonly preparing = new Map<string, Promise<void>>()
  private cancelLaunch(id: string): void {
    this.launching.get(id)?.abort()
    this.launching.delete(id)
  }
  private async spawnElsewhere(node: TerminalNode, shell: string, env: Record<string, string>, token: string, boot: string, restart: boolean, settingsContent?: string, cleanupSettings: () => void = () => {}): Promise<void> {
    const controller = new AbortController()
    this.launching.set(node.id, controller)
    const active = () => !controller.signal.aborted && this.launching.get(node.id) === controller
    try {
      const runtime = this.opts.environments
      const remoteSettings = node.agent === 'claude' ? JSON.stringify(claudeSettings(this.opts.palcoBin, true)) : settingsContent
      const prepared: Prepared = runtime ? await runtime.prepare({ node, shell, env, cwd: node.cwd, home: homedir(), signal: controller.signal, restart, ...(remoteSettings ? { settingsContent: remoteSettings } : {}) }) : { error: 'ambientes indisponíveis' }
      if (!active()) { if (!('error' in prepared)) await prepared.cleanup(); cleanupSettings(); return }
      if ('error' in prepared) {
        this.opts.onWarning?.(node.id, prepared.error)
        if (node.environment?.kind === 'tmux' && prepared.fallbackLocal !== false) this.start(node, shell, [], node.cwd, env, token, boot, cleanupSettings)
        else { cleanupSettings(); for (const cb of this.exitCbs) cb(node.id, -1) }
        return
      }
      if (prepared.warning) this.opts.onWarning?.(node.id, prepared.warning)
      if (prepared.remoteCli || prepared.reused) cleanupSettings()
      const remoteBoot = prepared.reused ? '' : prepared.remoteCli ? buildAgentCommand(node.agent, node.command, this.opts.palcoBin, this.roleFor(node), true) : boot
      const cleanup = () => { cleanupSettings(); void Promise.resolve(prepared.cleanup()).catch(() => { if (!this.shuttingDown) this.opts.onWarning?.(node.id, 'Não foi possível limpar a partida do ambiente.') }) }
      try { this.start(node, prepared.file, prepared.args, prepared.cwd, { ...prepared.env, TERM: 'xterm-256color' }, token, remoteBoot, cleanup) }
      catch (error) { cleanup(); throw error }
    } catch {
      cleanupSettings()
      if (!active()) return
      this.opts.onWarning?.(node.id, `não foi possível iniciar em ${node.environment?.kind}`)
      for (const cb of this.exitCbs) cb(node.id, -1)
    } finally { if (this.launching.get(node.id) === controller) this.launching.delete(node.id) }
  }

  private start(node: TerminalNode, file: string, args: string[], cwd: string, env: Record<string, string>, token: string, boot: string, cleanup?: () => void): void {

    // Uma entrada anterior (parada) do mesmo id é substituída: libera a tela antiga.
    const previous = this.entries.get(node.id)
    if (previous) this.release(previous)

    const { cols, rows } = this.sizes.get(node.id) ?? { cols: COLS, rows: ROWS }
    const proc = (this.opts.spawnPty ?? pty.spawn)(file, args, { name: 'xterm-256color', cols, rows, cwd, env })
    const screen = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true })
    const serializer = new SerializeAddon()
    screen.loadAddon(serializer)
    const gen = (this.gens.get(node.id) ?? 0) + 1
    this.gens.set(node.id, gen)
    const entry: Entry = {
      node, gen, viewed: false, pty: proc, screen, serializer, seq: 0, received: 0, running: true, disposed: false,
      timers: new Set(), ready: boot === '', readyScheduled: false, readyFailed: false, bootSent: false, pendingPrompts: [], token, promptHook: false, cleanup
    }
    this.entries.set(node.id, entry)
    this.tokens.set(token, { id: node.id, gen })

    // Consultas ao terminal (o fish 4 espera até 10 s por elas antes de desenhar): ao abrir o app os processos
    // sobem antes da janela, então quem responde é a tela do main. Com uma tela ligada, ela responde sozinha.
    screen.onData((reply) => {
      if (entry.viewed || entry.disposed || !entry.running) return
      try { proc.write(reply) } catch { /* processo acabou de sair */ }
    })

    proc.onData((data) => {
      if (entry.disposed) return
      const seq = ++entry.received
      // Só emitimos depois de aplicar na tela: snapshot().seq nunca fica atrás do último chunk visto.
      screen.write(data, () => {
        if (entry.disposed) return
        entry.seq = seq
        for (const cb of this.dataCbs) cb(node.id, data, seq, gen)
      })
      if (entry.bootSent && !entry.ready) this.armQuiet(entry)
    })
    proc.onExit(({ exitCode }) => {
      cleanup?.()
      // Restart esperando: a saída confirma a parada (e é avisada como qualquer saída).
      if (entry.onStopped) {
        const stopped = entry.onStopped
        entry.onStopped = undefined
        if (entry.running) {
          entry.running = false
          if (!this.shuttingDown) for (const cb of this.exitCbs) cb(node.id, exitCode)
        }
        stopped()
        return
      }
      if (entry.disposed || !entry.running) return
      entry.running = false
      this.tokens.delete(entry.token)
      this.clearTimers(entry)
      this.dropPending(entry)
      if (this.shuttingDown) return
      for (const cb of this.exitCbs) cb(node.id, exitCode)
    })

    if (boot !== '') {
      this.later(entry, BOOT_DELAY_MS, () => {
        entry.bootSent = true
        this.write(node.id, boot + '\r')
        // Prontidão: hook de sessão ou silêncio na saída. O teto (contado do boot) NÃO prova nada: falha os pendentes.
        this.later(entry, this.timeoutMs, () => this.failReady(entry))
      })
    }
  }

  /** Role do terminal, ou `undefined` com aviso: um role que sumiu ou não cabe nunca impede o terminal de subir. */
  private roleFor(node: TerminalNode): { file: string; text: string } | undefined {
    if (!node.role) return undefined
    const warn = (why: string): undefined => {
      this.opts.onWarning?.(node.id, `terminal '${node.name}' iniciado sem o role '${node.role}': ${why}`)
      return undefined
    }
    if (!takesRole(node.agent)) return warn(`role não se aplica a ${node.agent}`)
    if (!this.opts.resolveRole) return warn('roles indisponíveis')
    let role: { file: string; text: string }
    try { role = this.opts.resolveRole(node.role) } catch (err) { return warn(err instanceof Error ? err.message : String(err)) }
    if (node.agent === 'codex' && !codexRoleFits(role.text)) return warn('texto grande demais para a linha de comando do Codex')
    return role
  }

  write(id: string, data: string): void {
    const e = this.entries.get(id)
    if (e?.running) e.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return
    this.sizes.set(id, { cols, rows })
    const e = this.entries.get(id)
    if (!e?.running) return
    e.pty.resize(cols, rows)
    e.screen.resize(cols, rows)
  }

  deliverPrompt(id: string, text: string): void {
    const e = this.entries.get(id)
    if (!e?.running) return
    if (!e.ready) {
      // Depois do teto, o servidor já recusa o ask; este descarte cobre o caminho direto.
      if (!e.readyFailed) e.pendingPrompts.push({ text })
      return
    }
    this.sendPrompt(e, text)
  }

  /**
   * Entrega que não se perde enquanto o agente não está pronto: a mensagem fica na fila, mesmo depois do teto, e `settled`
   * avisa se saiu ou se o processo acabou antes. Devolve como desistir; `undefined` quando já foi (ou não há processo).
   */
  deliverWhenReady(id: string, text: string, settled: (sent: boolean) => void): (() => void) | undefined {
    const e = this.entries.get(id)
    if (!e?.running) return undefined
    if (e.ready) { this.sendPrompt(e, text); return undefined }
    const item: PendingPrompt = { text, settle: settled }
    e.pendingPrompts.push(item)
    return () => { e.pendingPrompts = e.pendingPrompts.filter((p) => p !== item) }
  }

  /** O processo acabou (ou vai acabar): o que esperava não será entregue. */
  private dropPending(e: Entry): void {
    const dropped = e.pendingPrompts
    e.pendingPrompts = []
    for (const p of dropped) p.settle?.(false)
  }

  screenText(id: string, lines = 80): string {
    const e = this.entries.get(id)
    if (!e) return ''
    const buf = e.screen.buffer.active
    const rows: string[] = []
    for (let i = 0; i < buf.length; i++) rows.push(buf.getLine(i)?.translateToString(true) ?? '')
    while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
    return rows.slice(-lines).join('\n')
  }

  /** Snapshot para uma tela que passa a mostrar o terminal: o que o main aplicar daqui em diante é ela que responde. */
  attach(id: string): ReturnType<TerminalManager['snapshot']> {
    const e = this.entries.get(id)
    if (e) e.viewed = true
    return this.snapshot(id)
  }

  /** A tela deixou de mostrar o terminal: o main volta a responder às consultas. */
  detach(id: string): void {
    const e = this.entries.get(id)
    if (e) e.viewed = false
  }

  snapshot(id: string): { data: string; seq: number; gen: number; cols?: number; rows?: number } {
    const e = this.entries.get(id)
    if (!e) return { data: '', seq: 0, gen: 0 }
    return { data: e.serializer.serialize(), seq: e.seq, gen: e.gen, cols: e.screen.cols, rows: e.screen.rows }
  }

  /** Id do terminal dono do token, ou undefined (token inválido, revogado ou de processo encerrado). */
  terminalForToken(token: string): string | undefined {
    return this.tokens.get(token)?.id
  }

  /** Quem é o dono do token e de qual geração; undefined para token inválido, revogado ou de processo encerrado. */
  identify(token: string): { id: string; gen: number } | undefined {
    const found = this.tokens.get(token)
    return found === undefined ? undefined : { ...found }
  }

  /** `ready` (shell ou agente pronto), `booting`, `failed` (teto estourou sem sinal) ou `unknown`. */
  agentState(id: string): 'ready' | 'booting' | 'failed' | 'unknown' {
    const e = this.entries.get(id)
    if (!e || !e.running) return 'unknown'
    return e.ready ? 'ready' : e.readyFailed ? 'failed' : 'booting'
  }

  /** Um prompt pendente não pôde ser entregue porque o agente não sinalizou prontidão dentro do teto. */
  /** O agente não confirmou o prompt entregue no prazo (diálogo aberto no terminal dele?). */
  onPromptRejected(cb: FailCb): () => void {
    this.rejectCbs.add(cb)
    return () => this.rejectCbs.delete(cb)
  }

  /** A marca do diálogo aberto na tela do agente, ou `null` (shell, terminal inexistente ou tela livre). */
  dialogOpen(id: string): string | null {
    const e = this.entries.get(id)
    return e ? dialogOpen(e.node.agent, this.screenText(id)) : null
  }

  /** Um hook do agente chegou (busy/turn-ended): confirma o prompt entregue. */
  notePromptHook(id: string): void {
    const e = this.entries.get(id)
    if (e) e.promptHook = true
  }

  onDeliveryFailed(cb: FailCb): () => void {
    this.failCbs.add(cb)
    return () => this.failCbs.delete(cb)
  }

  /** Já houve processo para este nó nesta sessão (rodando ou encerrado); falso = dormindo (carregamento preguiçoso). */
  hasSession(id: string): boolean {
    return this.entries.has(id)
  }

  isRunning(id: string): boolean {
    return this.entries.get(id)?.running === true
  }

  onData(cb: DataCb): () => void {
    this.dataCbs.add(cb)
    return () => this.dataCbs.delete(cb)
  }

  onExit(cb: ExitCb): () => void {
    this.exitCbs.add(cb)
    return () => this.exitCbs.delete(cb)
  }

  /**
   * O agente avisou por hook que subiu (SessionStart) ou que já está trabalhando (busy/turn-ended):
   * libera os prompts pendentes 500 ms depois. Para shell, desconhecido ou já pronto, não faz nada.
   */
  markReady(id: string): void {
    const e = this.entries.get(id)
    if (!e || !e.running || e.ready || e.readyScheduled) return
    e.readyScheduled = true
    this.later(e, READY_HOOK_DELAY_MS, () => {
      e.readyScheduled = false
      this.becomeReady(e)
    })
  }

  /**
   * Reinicia com a configuração nova (Editar terminal, Reiniciar). Se o processo roda, ele recebe SIGTERM;
   * sem sair no prazo, SIGKILL; o novo só sobe depois que a saída do antigo é confirmada (e avisada), no
   * tamanho atual da tela. Se nem o SIGKILL o encerra, falha sem criar outro PTY.
   */
  async restart(node: TerminalNode): Promise<void> {
    this.cancelLaunch(node.id)
    const e = this.entries.get(node.id)
    if (e?.running) await this.stop(e)
    const now = this.entries.get(node.id)
    // Outra chamada concorrente já subiu o processo novo.
    if (now && now !== e && now.running) return
    this.spawn(node, true)
  }

  private stop(e: Entry): Promise<void> {
    if (e.stopping) return e.stopping
    const signal = this.opts.signalProcess ?? signalTree
    const stopMs = this.opts.stopTimeoutMs ?? 3000
    const killMs = this.opts.killTimeoutMs ?? 1000
    this.clearTimers(e)
    this.dropPending(e)
    e.stopping = new Promise<void>((resolve, reject) => {
      let term: NodeJS.Timeout | undefined
      let kill: NodeJS.Timeout | undefined
      e.onStopped = () => {
        clearTimeout(term); clearTimeout(kill)
        e.stopping = undefined
        this.release(e)
        resolve()
      }
      try { signal(e.pty.pid, 'SIGTERM') } catch { /* já saiu */ }
      term = setTimeout(() => {
        try { signal(e.pty.pid, 'SIGKILL') } catch { /* já saiu */ }
        kill = setTimeout(() => {
          // Continua registrado: se sair depois, a saída é avisada pelo caminho normal.
          e.onStopped = undefined
          e.stopping = undefined
          reject(new Error('o processo antigo não encerrou (nem com SIGKILL); tente reiniciar de novo'))
        }, killMs)
      }, stopMs)
    })
    return e.stopping
  }


  /**
   * "Descarregar": o mesmo encerramento do reiniciar (SIGTERM, espera a saída, SIGKILL). Só resolve com o processo morto e o
   * ambiente encerrado; se ele não morrer, rejeita e o terminal continua contado como rodando.
   */
  async unload(id: string): Promise<void> {
    this.cancelLaunch(id)
    const e = this.entries.get(id)
    if (e?.running) await this.stop(e)
    await this.opts.environments?.dispose?.(id)
    const now = this.entries.get(id)
    if (now && !now.running) { this.release(now); this.entries.delete(id) }
  }

  /** Sobe o terminal e só resolve com o processo de pé (inclusive o preparo de um ambiente); senão rejeita. */
  async startConfirmed(node: TerminalNode): Promise<void> {
    this.spawn(node)
    await this.preparing.get(node.id)
    const failed = (): Error => new Error('o terminal não iniciou: confira o comando, a pasta e o ambiente')
    if (!this.isRunning(node.id)) throw failed()
    await new Promise((r) => setTimeout(r, this.opts.startGraceMs ?? 600))
    if (!this.isRunning(node.id)) throw failed()
  }

  kill(id: string): void {
    this.cancelLaunch(id)
    const e = this.entries.get(id)
    if (!e?.running) return
    this.clearTimers(e)
    this.dropPending(e)
    e.pty.kill()
  }

  /** Descarte definitivo (nó removido): mata o processo, avisa a saída e libera tela e entrada. */
  dispose(id: string): void {
    this.cancelLaunch(id)
    void Promise.resolve(this.opts.environments?.dispose?.(id)).catch(() => this.opts.onWarning?.(id, 'Não foi possível encerrar a sessão do ambiente.'))
    const e = this.entries.get(id)
    if (!e) return
    const wasRunning = e.running
    e.running = false
    this.entries.delete(id)
    this.gens.delete(id)
    this.release(e)
    if (wasRunning) {
      try {
        e.pty.kill()
      } catch {
        /* já encerrado */
      }
      for (const cb of this.exitCbs) cb(id, -1)
    }
  }

  /** Raiz (shell) de cada terminal com processo vivo: base do limite de memória. */
  livePids(): Array<{ id: string; pid: number }> {
    return [...this.entries].filter(([, e]) => e.running).map(([id, e]) => ({ id, pid: e.pty.pid }))
  }

  killAll(): void {
    for (const id of new Set([...this.entries.keys(), ...this.launching.keys()])) this.kill(id)
  }

  isShuttingDown(): boolean { return this.shuttingDown }

  /** Encerra os processos das sessões de terminal, sem notificar ouvintes que persistem saídas normais. */
  async shutdownAll(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    const ids = new Set([...this.entries.keys(), ...this.launching.keys()])
    for (const id of ids) { try { this.cancelLaunch(id) } catch { /* uma partida não deve bloquear o encerramento */ } }

    const targets = [...this.entries.values()]
    // O filho do forkpty vira líder da própria sessão (sid = pid). Ler o sid do /proc logo após o spawn pode
    // devolver o da sessão do app, quando o filho ainda não chamou setsid: por isso ele nunca é lido de lá.
    const sids = new Set(targets.map((entry) => entry.pty.pid))
    // O próprio shell entra mesmo antes do setsid, enquanto o node-pty não avisou a saída dele.
    const alive = (): number[] => [...new Set([
      ...[...liveSessions(sids).values()].flat(),
      ...targets.filter((entry) => entry.running && isProcessAlive(entry.pty.pid)).map((entry) => entry.pty.pid)
    ])].filter((pid) => pid !== process.pid)
    const waitUntilGone = async (ms: number, step: number): Promise<void> => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline && alive().length > 0) await delay(Math.min(step, Math.max(1, deadline - Date.now())))
    }

    for (const entry of targets) {
      this.clearTimers(entry)
      try { this.dropPending(entry) } catch { /* callbacks de entrega não devem bloquear o encerramento */ }
    }
    signalPids(alive(), 'SIGHUP')
    await waitUntilGone(2000, 50)
    signalPids(alive(), 'SIGKILL')
    await waitUntilGone(900, 40)
    for (const [id, entry] of this.entries) {
      try { this.release(entry) } catch { /* a falha de limpeza não deve impedir a saída */ }
      this.entries.delete(id)
    }
  }

  private sendPrompt(e: Entry, text: string): void {
    if (e.node.agent === 'shell') {
      e.pty.write(text + '\r')
      return
    }
    // Com um diálogo de seleção aberto, o Enter escolheria uma opção dele: não cola, rejeita na hora.
    if (dialogOpen(e.node.agent, this.screenText(e.node.id)) !== null) {
      for (const cb of this.rejectCbs) cb(e.node.id)
      return
    }
    e.promptHook = false
    e.pty.write(PASTE_START + text + PASTE_END)
    this.later(e, ENTER_DELAY_MS, () => this.write(e.node.id, '\r'))
    this.later(e, ENTER_DELAY_MS + this.confirmMs, () => {
      if (!e.running || e.disposed) return
      if (!promptLanded(e.node.agent, this.screenText(e.node.id), text, e.promptHook)) {
        for (const cb of this.rejectCbs) cb(e.node.id)
      }
    })
  }

  private armQuiet(e: Entry): void {
    if (e.quiet) clearTimeout(e.quiet)
    e.quiet = setTimeout(() => {
      e.quiet = undefined
      this.becomeReady(e)
    }, this.quietMs)
  }

  private failReady(e: Entry): void {
    if (e.ready || e.disposed || !e.running) return
    e.readyFailed = true
    const had = e.pendingPrompts.some((p) => !p.settle)
    e.pendingPrompts = e.pendingPrompts.filter((p) => p.settle)
    if (had) for (const cb of this.failCbs) cb(e.node.id)
  }

  private becomeReady(e: Entry): void {
    if (e.ready || e.disposed || !e.running) return
    e.ready = true
    e.readyFailed = false
    if (e.quiet) clearTimeout(e.quiet)
    e.quiet = undefined
    const prompts = e.pendingPrompts
    e.pendingPrompts = []
    for (const p of prompts) { this.sendPrompt(e, p.text); p.settle?.(true) }
  }

  private later(e: Entry, ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      e.timers.delete(t)
      fn()
    }, ms)
    e.timers.add(t)
  }

  private clearTimers(e: Entry): void {
    for (const t of e.timers) clearTimeout(t)
    e.timers.clear()
    if (e.quiet) clearTimeout(e.quiet)
    e.quiet = undefined
  }

  private release(e: Entry): void {
    e.disposed = true
    this.tokens.delete(e.token)
    this.clearTimers(e)
    this.dropPending(e)
    e.cleanup?.()
    try {
      e.screen.dispose()
    } catch {
      /* tela já liberada */
    }
  }
}
