import { randomUUID } from 'node:crypto'
import type { Preferences } from '../../shared/preferences'
import type { TerminalNode } from '../../shared/model'
import type { NoticeInput, SystemNotice, SystemSnapshot } from '../../shared/system'
export interface SystemPorts {
  startPower(): number
  stopPower(id: number): void
  badge(count: number): void
  flash(on: boolean): void
  createTray(callbacks: { show(): void; quit(): void }): { destroy(): void; setCount(n: number): void }
  hideWindow(): void
  showWindow(): void
  confirmQuit(): Promise<boolean>
  notify(notice: SystemNotice, click: () => void): void
  focus(notice: SystemNotice): void
  quit(): void
  isFocused(): boolean
}
export class SystemController {
  private notices: SystemNotice[] = []
  private workers = new Set<string>()
  private focused: string | null = null
  private power: number | null = null
  private tray: ReturnType<SystemPorts['createTray']> | null = null
  private listeners = new Set<(s: SystemSnapshot) => void>()
  private disposed = false
  constructor(private readonly d: { preferences(): Preferences; nodes(): TerminalNode[]; ports: SystemPorts }) { this.refresh() }
  onChange(cb: (s: SystemSnapshot) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  snapshot(): SystemSnapshot {
    const p = this.d.preferences(), nodes = new Map(this.d.nodes().map(n => [n.id, n]))
    const shown = this.notices.filter(n => n.kind !== 'turn' || !n.terminalId || p.completionBadges === 'all' || nodes.get(n.terminalId)?.maestro)
    return { notices: structuredClone(shown), badgeTerminalIds: [...new Set(shown.flatMap(n => n.terminalId ? [n.terminalId] : []))], workingTerminalIds: [...this.workers] }
  }
  working(id: string, value: boolean): void { if (this.workers.has(id) === value) return; if (value) this.workers.add(id); else this.workers.delete(id); this.refresh() }
  setFocused(id: string | null): void {
    this.focused = id; this.d.ports.flash(false)
    if (id) this.notices = this.notices.filter(n => n.terminalId !== id)
    this.refresh()
  }
  publish(input: NoticeInput): void {
    if (this.disposed) return
    // Replace a repeated notice for the same target/type, and bound retained history.
    const notice: SystemNotice = { ...input, title: input.title.slice(0, 200), body: input.body.slice(0, 4000), id: randomUUID(), timestamp: Date.now() }
    this.notices = this.notices.filter(n => !(n.kind === input.kind && n.terminalId === input.terminalId && n.workspaceId === input.workspaceId && n.floorId === input.floorId && n.title === input.title))
    this.notices.push(notice); this.notices = this.notices.slice(-200)
    const p = this.d.preferences(), ownFocus = !!input.terminalId && input.terminalId === this.focused && this.d.ports.isFocused()
    if (input.terminalId) this.workers.delete(input.terminalId)
    const enabled = { turn: p.notifyOnTurnComplete, attention: p.notifyOnAttention, floor: p.notifyOnFloorStatus, pullRequest: p.notifyOnPullRequests }[input.kind]
    if (enabled && !ownFocus) this.d.ports.notify(notice, () => this.focus(notice.id))
    if (p.flashTaskbarOnAttention && input.kind === 'attention' && !ownFocus) this.d.ports.flash(true)
    this.refresh()
  }
  focus(id: string): void {
    const notice = this.notices.find(n => n.id === id)
    if (!notice) return
    try { this.d.ports.focus(notice) } catch { console.warn('palco: destino da notificação indisponível') } finally { this.dismiss(id) }
  }
  dismiss(id: string): void { this.notices = this.notices.filter(n => n.id !== id); this.refresh() }
  nextAttention(): SystemNotice | null { const next = this.snapshot().notices[0]; if (!next) return null; this.focus(next.id); return next }
  forget(id: string): void { this.workers.delete(id); this.notices = this.notices.filter(n => n.terminalId !== id); this.refresh() }
  async mayQuit(): Promise<boolean> { return !this.d.preferences().confirmBeforeQuitting || this.d.ports.confirmQuit() }
  closeWindow(): boolean { if (!this.tray || !this.d.preferences().closeToTray) return false; this.d.ports.hideWindow(); return true }
  refresh(): void {
    if (this.disposed) return
    const p = this.d.preferences(), keep = p.sleepPrevention === 'whileAppIsOpen' || p.sleepPrevention === 'whileAgentsWork' && this.workers.size > 0
    if (keep && this.power === null) this.power = this.d.ports.startPower()
    if (!keep && this.power !== null) { this.d.ports.stopPower(this.power); this.power = null }
    if (p.closeToTray && !this.tray) this.tray = this.d.ports.createTray({ show: () => this.d.ports.showWindow(), quit: () => this.d.ports.quit() })
    if (!p.closeToTray && this.tray) { this.tray.destroy(); this.tray = null }
    const snapshot = this.snapshot(), count = snapshot.notices.length
    this.d.ports.badge(p.showAppIconBadge ? count : 0); this.tray?.setCount(p.showAppIconBadge ? count : 0)
    if (!p.flashTaskbarOnAttention) this.d.ports.flash(false)
    for (const cb of this.listeners) cb(snapshot)
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.power !== null) this.d.ports.stopPower(this.power)
    this.tray?.destroy(); this.d.ports.badge(0); this.d.ports.flash(false); this.listeners.clear()
  }
}
/** The main owns lifecycle; IPC areas look up the installed service without expanding IpcDeps. */
const installed = new WeakMap<object, SystemController>()
export function attachSystem(registry: object, service: SystemController): () => void { installed.set(registry, service); return () => { installed.delete(registry); service.dispose() } }
export function systemFor(registry: object): SystemController | undefined { return installed.get(registry) }
