import type { AgentKind, AskResult } from '../../shared/model'

export interface BrokerDeps {
  deliver(terminalId: string, text: string): void
  screenText(terminalId: string): string
  agentOf(terminalId: string): AgentKind
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

interface Request {
  from: string
  to: string
  prompt: string
  resolve: (result: AskResult) => void
  expiresAt: number
  settled: boolean
  draining?: boolean
  /** Codex: mensagem com forma de título, usada só se o turno terminar por silêncio. */
  titleCandidate?: string
  timeout?: ReturnType<typeof setTimeout>
  idle?: ReturnType<typeof setTimeout>
  settle?: ReturnType<typeof setTimeout>
  abort?: () => void
}
interface TargetQueue { active?: Request; queued: Request[] }
interface BrokerOptions { shellIdleMs?: number; agentIdleMs?: number; timeoutMs?: number; settleMs?: number }

export class AskBroker {
  private readonly targets = new Map<string, TargetQueue>()
  private readonly shellIdleMs: number
  private readonly agentIdleMs: number
  private readonly timeoutMs: number
  private readonly settleMs: number

  constructor(private readonly deps: BrokerDeps, opts: BrokerOptions = {}) {
    this.shellIdleMs = opts.shellIdleMs ?? 1500
    this.agentIdleMs = opts.agentIdleMs ?? 120000
    this.timeoutMs = opts.timeoutMs ?? 1800000
    this.settleMs = opts.settleMs ?? 2000
  }

  ask(fromId: string, toId: string, prompt: string, signal?: AbortSignal): Promise<AskResult> {
    return new Promise(resolve => {
      if (signal?.aborted) return resolve({ ok: false, error: 'cancelled' })
      const state = this.targets.get(toId) ?? { queued: [] }
      this.targets.set(toId, state)
      const request: Request = { from: fromId, to: toId, prompt, resolve, expiresAt: Date.now() + this.timeoutMs, settled: false }
      if (signal) {
        const onAbort = (): void => this.cancel(request)
        signal.addEventListener('abort', onAbort, { once: true })
        request.abort = () => signal.removeEventListener('abort', onAbort)
      }
      state.queued.push(request)
      request.timeout = this.deps.setTimeout(() => this.expire(request), this.timeoutMs)
      this.startNext(toId, state)
    })
  }

  /** Active cancellation settles the caller but retains the target until its turn boundary. */
  private cancel(request: Request): void {
    if (request.settled) return
    if (this.targets.get(request.to)?.active === request) {
      request.draining = true
      this.deps.clearTimeout(request.settle)
      request.settle = undefined
      this.settle(request, { ok: false, error: 'cancelled' })
    } else this.finish(request, { ok: false, error: 'cancelled' })
  }

  onOutput(terminalId: string): void {
    const request = this.targets.get(terminalId)?.active
    if (request) this.armIdle(request)
  }

  /**
   * Fim de turno em duas fases: o hook só arma o settle. Um novo hook troca a mensagem e rearma;
   * `onBusy` cancela (outro hook bloqueou o Stop ou o agente voltou a trabalhar).
   */
  onTurnEnded(terminalId: string, lastMessage?: string, inputMessages?: string[]): void {
    const request = this.targets.get(terminalId)?.active
    if (!request) return
    // Codex dispara notify também para o turno interno que gera o título da conversa, e esse turno
    // recebe o mesmo prompt: input-messages não o distingue, e ele pode chegar antes ou depois da
    // resposta. Uma mensagem só-título nunca resolve sozinha: fica como candidata para o silêncio.
    if (this.deps.agentOf(terminalId) === 'codex' && isTitleOnly(lastMessage)) {
      if (!request.draining) request.titleCandidate = lastMessage
      return
    }
    if (request.draining) { this.finish(request); return }
    this.deps.clearTimeout(request.settle)
    const conclude = (): void => {
      request.settle = undefined
      this.finish(request, request.settled ? undefined
        : lastMessage === undefined ? this.screenResult(request, 'hook') : { ok: true, text: lastMessage, via: 'hook' })
    }
    if (this.settleMs <= 0) return conclude()
    request.settle = this.deps.setTimeout(conclude, this.settleMs)
  }

  onBusy(terminalId: string): void {
    const request = this.targets.get(terminalId)?.active
    if (!request) return
    this.deps.clearTimeout(request.settle)
    request.settle = undefined
  }

  tryAskBack(fromId: string, toId: string, text: string): boolean {
    const request = this.targets.get(fromId)?.active
    if (!request || request.settled || request.from !== toId) return false
    // Replying to a caller does not mean the agent has left its current turn.
    this.settle(request, { ok: true, text, via: 'askback' })
    this.armIdle(request)
    return true
  }

  /** O agente não aceitou o prompt ativo (diálogo aberto no terminal): falha só ele e segue a fila. */
  onRejected(terminalId: string): void {
    const request = this.targets.get(terminalId)?.active
    if (!request || request.settled) return
    this.finish(request, { ok: false, error: 'rejected' })
  }

  onExit(terminalId: string): void {
    const state = this.targets.get(terminalId)
    if (!state) return
    this.targets.delete(terminalId)
    for (const request of [...(state.active ? [state.active] : []), ...state.queued]) {
      this.clearTimers(request)
      this.settle(request, { ok: false, error: 'exited' })
    }
  }

  pending(): Array<{ from: string; to: string }> {
    return [...this.targets.values()].flatMap(state => [...(state.active ? [state.active] : []), ...state.queued])
      .filter(request => !request.settled).map(({ from, to }) => ({ from, to }))
  }

  private startNext(toId: string, state: TargetQueue): void {
    if (state.active) return
    let request: Request | undefined
    while ((request = state.queued.shift())) {
      if (request.expiresAt > Date.now()) break
      this.clearTimers(request)
      this.settle(request, { ok: false, error: 'timeout' })
    }
    if (!request) {
      this.targets.delete(toId)
      return
    }
    state.active = request
    try {
      // Install state and timers before deliver: a dependency may emit a hook synchronously.
      this.armIdle(request)
      this.deps.deliver(toId, request.prompt)
    } catch {
      this.onExit(toId)
    }
  }

  private armIdle(request: Request): void {
    this.deps.clearTimeout(request.idle)
    const delay = this.deps.agentOf(request.to) === 'shell' ? this.shellIdleMs : this.agentIdleMs
    request.idle = this.deps.setTimeout(() => this.finish(request, request.settled ? undefined
      : request.titleCandidate !== undefined ? { ok: true, text: request.titleCandidate, via: 'hook' }
      : this.screenResult(request, 'idle')), delay)
  }

  private screenResult(request: Request, via: 'hook' | 'idle'): AskResult {
    try { return { ok: true, text: this.deps.screenText(request.to), via } }
    catch { return { ok: false, error: 'exited' } }
  }

  private expire(request: Request): void {
    if (this.targets.get(request.to)?.active === request) {
      // Timeout ends the caller's wait; hook/idle still owns the target's turn boundary.
      this.settle(request, { ok: false, error: 'timeout' })
    } else this.finish(request, { ok: false, error: 'timeout' })
  }

  private settle(request: Request, result: AskResult): void {
    if (request.settled) return
    request.settled = true
    request.abort?.()
    request.abort = undefined
    this.deps.clearTimeout(request.timeout)
    request.timeout = undefined
    request.resolve(result)
  }

  private finish(request: Request, result?: AskResult): void {
    const state = this.targets.get(request.to)
    if (!state) return
    if (state.active === request) state.active = undefined
    else {
      const index = state.queued.indexOf(request)
      if (index === -1) return
      state.queued.splice(index, 1)
    }
    this.clearTimers(request)
    if (result !== undefined) this.settle(request, result)
    this.startNext(request.to, state)
  }

  private clearTimers(request: Request): void {
    this.deps.clearTimeout(request.timeout)
    this.deps.clearTimeout(request.idle)
    this.deps.clearTimeout(request.settle)
    request.settle = undefined
  }
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** O agente pode receber o prompt com quebras/espaços normalizados; compara pelo conteúdo. */
function sameText(input: string, prompt: string): boolean {
  const a = squash(input), b = squash(prompt)
  return b.length > 0 && a.includes(b)
}

function isTitleOnly(message: string | undefined): boolean {
  if (message === undefined) return false
  try {
    const value: unknown = JSON.parse(message)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      && Object.keys(value).length === 1 && typeof (value as Record<string, unknown>).title === 'string'
  } catch { return false }
}
