import { queryAntigravityUsage } from './antigravity-usage'
import type { Account, AgentUsage } from '../../shared/model'
import { queryClaudeUsage, queryCodexUsage, type Runner } from './providers'

interface Options {
  accounts: { list(): Account[]; onChange?(cb: () => void): () => void }
  runner: Runner
  now: () => number
  setTimeout: typeof setTimeout
  clearTimeout?: typeof clearTimeout
  enabled?(): boolean
  providerEnabled?(account: Account): boolean
  color?(account: Account): string | undefined
  query?(account: Account): Promise<AgentUsage>
}
interface State { lastStart: number; due: number; failures: number; busy: boolean; usage: AgentUsage }
interface Job { account: Account; manual: boolean; done(): void }
const INTERVAL = 300_000, MIN_INTERVAL = 60_000, MAX_BACKOFF = 1_800_000

export class UsageService {
  private visible = false
  private disposed = false
  private active = 0
  private states = new Map<string, State>()
  private queue: Job[] = []
  private timer?: ReturnType<typeof setTimeout>
  private listeners = new Set<() => void>()
  private unsubscribe?: () => void
  constructor(private readonly opts: Options) {
    this.unsubscribe = opts.accounts.onChange?.(() => { this.sync(); this.notify(); if (this.visible) void this.enqueue(false) })
  }
  private sync(): Account[] {
    const accounts = this.opts.enabled?.() === false ? [] : this.opts.accounts.list().filter(a => a.authMode !== 'apiKey' && this.opts.providerEnabled?.(a) !== false)
    const live = new Set(accounts.map(a => a.id))
    for (const id of this.states.keys()) if (!live.has(id)) this.states.delete(id)
    for (const a of accounts) if (!this.states.has(a.id)) this.states.set(a.id, { lastStart: -Infinity, due: -Infinity, failures: 0, busy: false, usage: { providerId:a.providerId??a.agent, agent: a.agent, accountId: a.id, accountName: a.name, source: `CLI ${a.agent}`, isStale: true } })
    return accounts
  }
  snapshot(): AgentUsage[] {
    return this.sync().map(a => ({ ...structuredClone(this.states.get(a.id)!.usage), color: a.color ?? this.opts.color?.(a) }))
  }
  settingsChanged(): void { this.sync(); this.notify(); if (this.visible) void this.enqueue(false) }
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  private notify(): void { for (const cb of this.listeners) cb() }
  setVisible(v: boolean): void {
    if (this.disposed) return
    this.visible = v
    this.clearTimer()
    if (v) void this.enqueue(false)
    else {
      this.queue = this.queue.filter(j => { if (j.manual) return true; const state = this.states.get(j.account.id); if (state) state.busy = false; j.done(); return false })
    }
  }
  refresh(id?: string): Promise<void> { return this.enqueue(true, id) }
  private enqueue(manual: boolean, id?: string): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const now = this.opts.now()
    const promises: Promise<void>[] = []
    for (const account of this.sync()) {
      const state = this.states.get(account.id)!
      if ((id && account.id !== id) || state.busy || now - state.lastStart < MIN_INTERVAL || ((!manual || state.failures > 0) && now < state.due)) continue
      state.busy = true
      promises.push(new Promise(done => this.queue.push({ account, manual, done })))
    }
    this.pump()
    this.arm()
    return Promise.all(promises).then(() => undefined)
  }
  private pump(): void {
    while (!this.disposed && this.active < 2 && this.queue.length) {
      const job = this.queue.shift()!, state = this.states.get(job.account.id)
      if (!state || (!this.visible && !job.manual)) { if (state) state.busy = false; job.done(); continue }
      this.active++; state.lastStart = this.opts.now()
      const a = job.account
      const query = a.agent === 'claude' ? queryClaudeUsage : a.agent==='antigravity'?queryAntigravityUsage:queryCodexUsage
      void (this.opts.query ? this.opts.query(a) : query(a.configDir, { run: this.opts.runner, timeoutMs: a.agent === 'claude' ? 30_000 : a.agent==='antigravity'?90_000:60_000 })).then(result => {
        if (this.disposed || this.states.get(a.id) !== state) return
        const now = this.opts.now()
        if (result.error) {
          state.failures++
          state.usage = { ...state.usage, error: `${a.name}: ${result.error}`, isStale: true }
          state.due = now + Math.min(MAX_BACKOFF, INTERVAL * 2 ** Math.min(state.failures - 1, 4))
        } else {
          state.failures = 0
          state.usage = { ...result, accountId: a.id, accountName: a.name, lastSuccessAt: new Date(now).toISOString(), isStale: false }
          state.due = now + (a.agent==='antigravity'?600_000:INTERVAL)
        }
        this.notify()
      }).finally(() => {
        this.active--; state.busy = false; job.done()
        this.pump(); this.arm()
      })
    }
  }
  private clearTimer(): void { if (this.timer !== undefined) (this.opts.clearTimeout ?? clearTimeout)(this.timer); this.timer = undefined }
  private arm(): void {
    this.clearTimer()
    if (!this.visible || this.disposed) return
    const due = [...this.states.values()].filter(s => !s.busy).map(s => Math.max(s.due, s.lastStart + MIN_INTERVAL))
    if (!due.length) return
    this.timer = this.opts.setTimeout(() => { this.timer = undefined; void this.enqueue(false) }, Math.max(1, Math.min(...due) - this.opts.now()))
  }
  dispose(): void {
    this.disposed = true; this.visible = false; this.clearTimer(); this.unsubscribe?.()
    for (const job of this.queue) job.done()
    this.queue = []; this.listeners.clear()
  }
}
