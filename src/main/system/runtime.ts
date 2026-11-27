import type { WorkspaceRegistry } from '../domain/workspace-registry'
import type { TerminalManager } from '../pty/terminal-manager'
import type { PreferencesStore } from '../preferences/preferences-store'
import type { ChatService } from '../chat/chat-service'
import type { TerminalNode } from '../../shared/model'
import { ActivityMonitor, QUIET_MS } from '../activity-monitor'
import { SystemController } from './controller'
import { PullRequestWatcher, readPullRequests } from './pull-requests'
import { SessionStore } from './sessions'
import { mt } from '../i18n'

/** Producers shared by GUI, agent hooks and CLI: no renderer polling or guessed 'last' agent session. */
export function wireSystemSources(d: { controller: SystemController; sessions: SessionStore; registry: WorkspaceRegistry; terminals: TerminalManager; preferences: PreferencesStore; chat?: ChatService; pullRequests?: typeof readPullRequests }): { agentEvent(id: string, kind: 'ready' | 'busy' | 'turn' | 'attention', sessionId?: string, message?: string): void; dispose(): void } {
  const explicit = new Set<string>()
  const s = d.controller, timers = new Map<string, ReturnType<typeof setTimeout>>(), chatStates = new Map<string, string>()
  const node = (id: string): TerminalNode | undefined => { const n = d.registry.node(id); return n?.kind === 'terminal' ? n : undefined }
  const target = (id: string) => { const n = node(id), store = d.registry.storeOfNode(id); return n ? { terminalId: id, workspaceId: store?.get().id, floorId: n.floorId } : { terminalId: id } }
  // "Monitorar Atividade" desmarcado cala o aviso daquele terminal (o trabalho segue contando para a suspensão).
  const turn = (id: string): void => { s.working(id, false); if (node(id)?.monitor === false) return; s.publish({ kind: 'turn', title: node(id)?.name ?? mt('Agente'), body: mt('Concluiu o turno.'), ...target(id) }) }
  const monitor = new ActivityMonitor({ now: Date.now, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: t => clearTimeout(t as NodeJS.Timeout), shouldNotify: () => true, notify: (id, kind) => { if (kind === 'done') turn(id) } })
  const offData = d.terminals.onData(id => {
    const n = node(id); if (!n || explicit.has(id) || n.agent === 'shell' && !n.monitor) return
    s.working(id, true); monitor.data(id); clearTimeout(timers.get(id))
    timers.set(id, setTimeout(() => { timers.delete(id); s.working(id, false) }, QUIET_MS))
  })
  const offExit = d.terminals.onExit(id => { if (d.terminals.isShuttingDown?.()) return; explicit.delete(id); clearTimeout(timers.get(id)); timers.delete(id); monitor.forget(id); s.forget(id) })
  const seenFloors = new Map<string, string>()
  const floors = (wsId: string, initial = false): void => {
    const ws = d.registry.get(wsId).get()
    const all = [[null, ws.groundStatus] as const, ...Object.values(ws.floors).map(f => [f.id, f.status] as const)]
    for (const [floorId, status] of all) {
      const key = `${wsId}:${floorId}`, state = `${status?.state ?? ''}:${status?.text ?? ''}`
      if (!initial && seenFloors.get(key) !== state && status && status.state !== 'working') s.publish({ kind: 'floor', workspaceId: wsId, floorId, title: `${ws.name} · ${floorId === null ? 'Ground' : ws.floors[floorId]?.name}`, body: status.text || mt('Andar em {p1}.', { p1: status.state }) })
      seenFloors.set(key, state)
    }
  }
  for (const ws of d.registry.list()) floors(ws.id, true)
  const offRegistry = d.registry.onChange(wsId => floors(wsId))
  const offPrefs = d.preferences.onChange(() => s.refresh())
  const offChat = d.chat?.onChange(({ terminalId }) => {
    const state = d.chat!.state(terminalId), previous = chatStates.get(terminalId)
    explicit.add(terminalId); clearTimeout(timers.get(terminalId)); timers.delete(terminalId); monitor.forget(terminalId)
    chatStates.set(terminalId, state.status); s.working(terminalId, state.status === 'working')
    if (state.status === 'needsAttention' && previous !== state.status) s.publish({ kind: 'attention', ...target(terminalId), title: node(terminalId)?.name ?? mt('Agente'), body: mt('Pede sua atenção.') })
  }) ?? (() => {})
  const prs = new PullRequestWatcher({ enabled: () => d.preferences.get().notifyOnPullRequests,
    roots: () => d.registry.list().flatMap(w => { const cwd = w.dir ?? Object.values(d.registry.get(w.id).get().nodes).find((n): n is TerminalNode => n.kind === 'terminal')?.cwd; return cwd ? [{ workspaceId: w.id, cwd }] : [] }),
    read: d.pullRequests ?? readPullRequests, changed: (workspaceId, pr) => s.publish({ kind: 'pullRequest', workspaceId, title: `PR #${pr.number} · ${pr.title}`, body: `${pr.state} · ${pr.url}` }) })
  void prs.poll(); const prTimer = setInterval(() => { void prs.poll() }, 60_000); prTimer.unref?.()
  return {
    agentEvent: (id, kind, sessionId, message) => {
      const n = node(id); if (!n) return
      if (sessionId) { try { d.sessions.remember(n, sessionId) } catch { /* keep old known-good session metadata */ } }
      if (kind === 'turn') { clearTimeout(timers.get(id)); timers.delete(id); monitor.forget(id); turn(id) }
      if (kind === 'busy' || kind === 'ready') { explicit.add(id); clearTimeout(timers.get(id)); timers.delete(id); monitor.forget(id) }
      if (kind === 'busy') s.working(id, true)
      if (kind === 'ready') s.working(id, false)
      if (kind === 'attention') s.publish({ kind, ...target(id), title: n.name, body: message ?? mt('Pede sua atenção.') })
    },
    dispose: () => { offData(); offExit(); offRegistry(); offPrefs(); offChat(); clearInterval(prTimer); monitor.dispose(); for (const t of timers.values()) clearTimeout(t); timers.clear() }
  }
}
