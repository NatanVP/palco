/**
 * "Monitorar Atividade": acompanha a saída dos terminais monitorados e avisa
 * - `done`: o trabalho acabou (silêncio de 4 s depois de pelo menos 1,5 s de saída);
 * - `started`: voltou a trabalhar (saída sustentada por 1,5 s depois de 60 s parado).
 * A primeira rajada (o boot) não é "atividade nova". Cada tipo de aviso respeita 10 s por terminal,
 * e `shouldNotify` (janela focada no próprio terminal) cala o aviso sem gastar esse intervalo.
 */
export type ActivityKind = 'done' | 'started'

export const QUIET_MS = 4000
export const MIN_ACTIVE_MS = 1500
export const IDLE_BEFORE_NEW_MS = 60_000
export const NOTIFY_GAP_MS = 10_000

type Timer = unknown

export interface ActivityMonitorOptions {
  now(): number
  setTimer(fn: () => void, ms: number): Timer
  clearTimer(timer: Timer): void
  /** `false` cala o aviso (ex.: a janela está focada nesse terminal). */
  shouldNotify(id: string): boolean
  notify(id: string, kind: ActivityKind): void
}

interface State {
  active: boolean
  activeSince: number
  lastData: number
  /** Silêncio antes desta rajada (0 na primeira: o boot não é "atividade nova"). */
  idleBefore: number
  startedSent: boolean
  timer?: Timer
  lastNotified: Partial<Record<ActivityKind, number>>
}

export class ActivityMonitor {
  private readonly states = new Map<string, State>()
  constructor(private readonly opts: ActivityMonitorOptions) {}

  /** Chegou saída do terminal monitorado. */
  data(id: string): void {
    const now = this.opts.now()
    let s = this.states.get(id)
    if (!s) {
      s = { active: false, activeSince: now, lastData: now, idleBefore: 0, startedSent: false, lastNotified: {} }
      this.states.set(id, s)
      s.active = true
    } else if (!s.active) {
      s.active = true
      s.activeSince = now
      s.idleBefore = now - s.lastData
      s.startedSent = false
    }
    s.lastData = now
    if (!s.startedSent && s.idleBefore >= IDLE_BEFORE_NEW_MS && now - s.activeSince >= MIN_ACTIVE_MS) {
      s.startedSent = true
      this.maybeNotify(id, s, 'started')
    }
    if (s.timer !== undefined) this.opts.clearTimer(s.timer)
    const state = s
    s.timer = this.opts.setTimer(() => this.quiet(id, state), QUIET_MS)
  }

  /** Terminal removido, encerrado ou com o monitor desligado: esquece o estado e o timer. */
  forget(id: string): void {
    const s = this.states.get(id)
    if (s?.timer !== undefined) this.opts.clearTimer(s.timer)
    this.states.delete(id)
  }

  dispose(): void {
    for (const id of [...this.states.keys()]) this.forget(id)
  }

  private quiet(id: string, s: State): void {
    if (this.states.get(id) !== s) return
    s.timer = undefined
    s.active = false
    if (s.lastData - s.activeSince >= MIN_ACTIVE_MS) this.maybeNotify(id, s, 'done')
  }

  private maybeNotify(id: string, s: State, kind: ActivityKind): void {
    const now = this.opts.now()
    const last = s.lastNotified[kind]
    if (last !== undefined && now - last < NOTIFY_GAP_MS) return
    if (!this.opts.shouldNotify(id)) return
    s.lastNotified[kind] = now
    this.opts.notify(id, kind)
  }
}

/** Título e corpo da notificação do sistema. */
export function activityText(kind: ActivityKind, name: string): { title: string; body: string } {
  return { title: name, body: kind === 'done' ? 'Terminou a atividade.' : 'Voltou a ter atividade.' }
}

export interface ActivityNotifierDeps {
  terminals: {
    onData(cb: (id: string, data: string, seq: number, gen: number) => void): () => void
    /** Saída do processo (inclusive nó removido, que sai com -1): o estado do terminal é esquecido. */
    onExit?(cb: (id: string, code: number) => void): () => void
  }
  /** Nó atual do terminal (nome e se o monitor está ligado), ou `undefined` se sumiu. */
  nodeOf(id: string): { name: string; monitor?: boolean } | undefined
  isWindowFocused(): boolean
  showNotification(n: { title: string; body: string; onClick(): void }): void
  /** Clique na notificação: traz a janela e foca o terminal. */
  focusTerminal(id: string): void
}

/** Liga o monitor à saída dos terminais com "Monitorar Atividade" e à notificação do sistema. */
export function createActivityNotifier(deps: ActivityNotifierDeps): { setFocused(id: string | null): void; dispose(): void } {
  let focused: string | null = null
  const monitor = new ActivityMonitor({
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    shouldNotify: (id) => !(deps.isWindowFocused() && focused === id),
    notify: (id, kind) => {
      // O monitor pode ter sido desligado (ou o nó removido) enquanto o trabalho rodava.
      const node = deps.nodeOf(id)
      if (!node?.monitor) return
      deps.showNotification({ ...activityText(kind, node.name), onClick: () => deps.focusTerminal(id) })
    }
  })
  // Geração do processo por terminal: um processo novo (restart) recomeça do zero.
  const gens = new Map<string, number>()
  const forget = (id: string): void => { monitor.forget(id); gens.delete(id) }
  const offData = deps.terminals.onData((id, _data, _seq, gen) => {
    if (!deps.nodeOf(id)?.monitor) { forget(id); return }
    if (gens.has(id) && gens.get(id) !== gen) monitor.forget(id)
    gens.set(id, gen)
    monitor.data(id)
  })
  const offExit = deps.terminals.onExit?.((id) => forget(id)) ?? (() => {})
  return {
    setFocused: (id) => { focused = id },
    dispose: () => { offData(); offExit(); monitor.dispose(); gens.clear() }
  }
}
