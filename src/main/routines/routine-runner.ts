import type { RoutineFireResult } from './fire'
import type { Routine, RoutineExecution } from '../../shared/model'
import type { RoutineStore } from './routine-store'
import { nextRun } from './schedule'

/** O timer nunca espera mais que isto: o relógio pode pular (suspensão, ajuste de hora). */
const MAX_WAIT_MS = 6 * 60 * 60_000

export interface RoutineRunnerDeps {
  store: RoutineStore
  /** Entrega o conteúdo ao terminal; devolve um resultado curto: 'ok' ou 'pulado: <motivo>' (o pre-run é assíncrono). */
  fire: ((r: Routine, report?: (execution: RoutineExecution) => void) => string | RoutineFireResult | Promise<string | RoutineFireResult>) & { stop?(): void }
  now(): Date
  /** Nome do terminal alvo, para o histórico. */
  terminalName?(id: string): string | undefined
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

/**
 * Um único timer para o próximo disparo. Disparos perdidos (app fechado, máquina dormindo) não são
 * repetidos: o próximo horário é sempre calculado a partir de agora.
 */
export class RoutineRunner {
  private timer?: ReturnType<typeof setTimeout>
  private unsubscribe?: () => void
  /** Ignora as mudanças que o próprio runner grava no store. */
  private applying = false
  private readonly inFlight = new Set<string>()

  constructor(private readonly deps: RoutineRunnerDeps) {}

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.deps.store.onChange(() => { if (!this.applying) this.reschedule() })
    this.reschedule()
  }

  stop(): void {
    this.deps.fire.stop?.()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    if (this.timer) this.deps.clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Dispara agora, fora da agenda; não consome `--count` nem muda o próximo horário. */
  async runNow(id: string): Promise<string> {
    const r = this.deps.store.byId(id)
    if (!r) throw new Error('rotina inexistente')
    if (r.background) {
      const execution = this.background(r, this.deps.now())
      return new Promise(resolve => {
        const timer = this.deps.setTimeout(() => resolve('continua rodando; consulte palco routine show para ver o resultado'), 60_000)
        void execution.then(result => { this.deps.clearTimeout(timer); resolve(result) })
      })
    }
    const fired = await this.deps.fire(r)
    const result = typeof fired === 'string' ? fired : fired.result
    if (this.deps.store.byId(id)) {
      const at = this.deps.now().toISOString()
      this.apply(() => this.deps.store.patch(id, { lastRun: { at, result } }))
      this.remember(r, at, result)
    }
    return result
  }

  private async background(r: Routine, at: Date): Promise<string> {
    if (this.inFlight.has(r.id)) {
      const result = 'pulado: rotina já em execução'
      if (this.deps.store.byId(r.id)) {
        this.apply(() => this.deps.store.patch(r.id, { lastRun: { at: at.toISOString(), result } }))
        this.remember(r, at.toISOString(), result)
      }
      return result
    }
    this.inFlight.add(r.id)
    try {
      const fired = await this.deps.fire(r, execution => {
        if (this.deps.store.byId(r.id)) this.apply(() => this.deps.store.patch(r.id, { lastExecution: execution }))
      })
      const result = typeof fired === 'string' ? fired : fired.result
      const execution = typeof fired === 'string' ? undefined : fired.execution
      if (this.deps.store.byId(r.id)) {
        this.apply(() => this.deps.store.patch(r.id, { lastRun: { at: at.toISOString(), result }, ...(execution ? { lastExecution: execution } : {}) }))
        this.remember(r, at.toISOString(), result, execution)
      }
      return execution ? formatExecution(execution) : result
    } catch (error) {
      const result = `erro: ${(error as Error).message}`
      if (this.deps.store.byId(r.id)) {
        this.apply(() => this.deps.store.patch(r.id, { lastRun: { at: at.toISOString(), result } }))
        this.remember(r, at.toISOString(), result)
      }
      return result
    } finally { this.inFlight.delete(r.id) }
  }

  /** Recalcula os próximos horários (sem rajada: o passado vira "a partir de agora") e rearma o timer. */
  reschedule(): void {
    const now = this.deps.now()
    this.apply(() => {
      for (const r of this.deps.store.list()) {
        if (!r.enabled) {
          if (r.nextRun !== undefined) this.deps.store.patch(r.id, { nextRun: undefined })
          continue
        }
        if (r.until !== undefined && new Date(r.until) <= now) {
          this.deps.store.patch(r.id, { enabled: false, nextRun: undefined })
          continue
        }
        if (r.nextRun !== undefined && new Date(r.nextRun) > now) continue
        // Antes do "Início" nada dispara: a agenda é contada a partir dele.
        const start = r.startsAt === undefined ? now : new Date(r.startsAt)
        const next = nextRun(r.schedule, start > now ? start : now)
        if (next) this.deps.store.patch(r.id, { nextRun: next.toISOString() })
        else this.deps.store.patch(r.id, { enabled: false, nextRun: undefined })
      }
    })
    this.arm()
  }

  private arm(): void {
    if (this.timer) this.deps.clearTimeout(this.timer)
    this.timer = undefined
    if (!this.unsubscribe) return
    const times = this.deps.store.list().filter((r) => r.enabled && r.nextRun).map((r) => new Date(r.nextRun!).getTime())
    if (times.length === 0) return
    const wait = Math.max(0, Math.min(Math.min(...times) - this.deps.now().getTime(), MAX_WAIT_MS))
    this.timer = this.deps.setTimeout(() => this.tick(), wait)
  }

  private tick(): void {
    this.timer = undefined
    const now = this.deps.now()
    for (const r of this.deps.store.list()) {
      if (r.enabled && r.nextRun && new Date(r.nextRun) <= now) this.fireScheduled(r, now)
    }
    this.reschedule()
  }

  private fireScheduled(r: Routine, now: Date): void {
    if (r.until !== undefined && new Date(r.until) < now) {
      this.apply(() => this.deps.store.patch(r.id, { enabled: false, nextRun: undefined }))
      return
    }
    const remaining = r.remaining === undefined ? undefined : Math.max(0, r.remaining - 1)
    const next = nextRun(r.schedule, now)
    const done = remaining === 0 || next === null || (r.until !== undefined && next > new Date(r.until))
    // A agenda anda já (o disparo pode esperar o pre-run); o resultado chega depois.
    this.apply(() => this.deps.store.patch(r.id, {
      ...(remaining === undefined ? {} : { remaining }),
      enabled: !done,
      nextRun: done ? undefined : next!.toISOString()
    }))
    if (r.background) { void this.background(r, now); return }
    const record = (fired: string | RoutineFireResult): void => {
      const result = typeof fired === 'string' ? fired : fired.result
      if (!this.deps.store.byId(r.id)) return
      this.apply(() => this.deps.store.patch(r.id, { lastRun: { at: now.toISOString(), result } }))
      this.remember(r, now.toISOString(), result)
    }
    let pending: string | RoutineFireResult | Promise<string | RoutineFireResult>
    try {
      pending = this.deps.fire(r)
    } catch (err) {
      record(`erro: ${(err as Error).message}`)
      return
    }
    if (typeof pending === 'string' || !('then' in pending)) record(pending)
    else pending.then(record, (err: unknown) => record(`erro: ${(err as Error).message}`))
  }

  private remember(r: Routine, firedAt: string, result: string, execution?: RoutineExecution): void {
    const terminalName = r.reminder || r.background ? undefined : this.deps.terminalName?.(r.terminalId)
    this.deps.store.addRun({ routineId: r.id, routineName: r.name, content: r.content, firedAt, result, ...(execution ? { execution } : {}), ...(r.workspaceId === undefined ? {} : { workspaceId: r.workspaceId }), ...(terminalName === undefined ? {} : { terminalName }) })
  }

  private apply(fn: () => void): void {
    const was = this.applying
    this.applying = true
    try {
      fn()
    } finally {
      this.applying = was
    }
  }
}

/** Janela em que uma rejeição do agente ainda é atribuída ao disparo da rotina (confirmação leva ~4 s). */
const REJECT_WINDOW_MS = 15_000

/** O agente rejeitou o prompt entregue: corrige o `ok` do disparo recente das rotinas daquele terminal. */
export function markRejected(store: RoutineStore, terminalId: string, now: Date): void {
  for (const r of store.list()) {
    if (r.terminalId !== terminalId || r.lastRun?.result !== 'ok') continue
    if (now.getTime() - Date.parse(r.lastRun.at) > REJECT_WINDOW_MS) continue
    const result = 'rejeitado: o agente não aceitou o prompt (diálogo aberto?)'
    store.patch(r.id, { lastRun: { at: r.lastRun.at, result } })
    store.amendLastRun(r.id, result)
  }
}

/** Resposta textual de uma execução em segundo plano concluída. */
export function formatExecution(e: RoutineExecution): string {
  return `início: ${e.startedAt}\nduração: ${e.durationMs} ms\ncódigo de saída: ${e.exitCode ?? 'sem código'}${e.status === 'timedOut' ? ' (tempo esgotado)' : ''}\nsaída:\n${e.output}`
}
