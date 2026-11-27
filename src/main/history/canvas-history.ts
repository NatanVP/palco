import { isDeepStrictEqual } from 'node:util'
import type { WorkspaceStore } from '../domain/workspace-store'
import type { TerminalNode, Workspace } from '../../shared/model'

/** Only document data: no camera, floor lifecycle, selection, PTY, or browser session. */
export type CanvasSnapshot = Pick<Workspace, 'nodes' | 'connections' | 'drawings' | 'stackNames' | 'groups'>
export function canvasSnapshot(ws: Workspace): CanvasSnapshot {
  return structuredClone({ nodes: ws.nodes, connections: ws.connections, drawings: ws.drawings ?? [], stackNames: ws.stackNames ?? {}, groups: ws.groups ?? {} })
}
/** Portal URLs are live browser state. Keep them for resurrecting deleted portals,
 * but navigation must not consume history or invalidate redo. "Descarregar" (`unloaded`) is runtime state too. */
function comparable(snapshot: CanvasSnapshot): CanvasSnapshot {
  const copy = structuredClone(snapshot)
  for (const node of Object.values(copy.nodes)) {
    if (node.kind === 'portal') node.url = ''
    // A pasta aberta da árvore é navegação, como o endereço do portal.
    if (node.kind === 'filetree') delete node.current
    // Nota ligada a arquivo: o texto é o do disco, não do histórico.
    if (node.kind === 'note' && node.linkedFile) { node.content = ''; delete node.fileMissing }
    if (node.kind === 'portal' || node.kind === 'terminal') delete node.unloaded
  }
  return copy
}
function sameCanvas(a: CanvasSnapshot, b: CanvasSnapshot): boolean {
  return isDeepStrictEqual(comparable(a), comparable(b))
}
function keepingLivePortalUrls(snapshot: CanvasSnapshot, live: CanvasSnapshot): CanvasSnapshot {
  const copy = structuredClone(snapshot)
  for (const [id, node] of Object.entries(copy.nodes)) {
    const current = live.nodes[id]
    if (node.kind === 'portal' && current?.kind === 'portal') node.url = current.url
    if (node.kind === 'filetree' && current?.kind === 'filetree' && current.root === node.root) {
      if (current.current !== undefined) node.current = current.current
      else delete node.current
    }
    if (node.kind === 'note' && node.linkedFile && current?.kind === 'note' && current.linkedFile === node.linkedFile) {
      node.content = current.content
      if (current.fileMissing) node.fileMissing = true
      else delete node.fileMissing
    }
    if ((node.kind === 'portal' || node.kind === 'terminal') && current?.kind === node.kind) {
      if (current.unloaded) node.unloaded = true
      else delete node.unloaded
    }
  }
  return copy
}

interface Runtime {
  spawn(node: TerminalNode): void
  dispose(id: string): void
  unregister(id: string): void
  /** Relança um processo que está de pé depois que o desfazer devolveu outro comando, agente ou pasta. */
  restart?(node: TerminalNode): void
}
interface Entry { undo: CanvasSnapshot[]; redo: CanvasSnapshot[]; floor: Workspace['activeFloor'] }

/** Synchronous document transactions. A failed batch rolls back; runtime is reconciled only at its boundary. */
export class CanvasHistory {
  private entries = new WeakMap<WorkspaceStore, Entry>()
  private expected = new WeakMap<WorkspaceStore, CanvasSnapshot>()
  private depth = 0
  get busy(): boolean { return this.depth > 0 }
  constructor(private readonly runtime?: Runtime) {}

  /** Return true when external document edits cleared a non-empty history (for the UI notice).
   * Camera/status and live portal navigation do not invalidate snapshots. */
  observe(store: WorkspaceStore): boolean {
    if (this.busy) return false
    const ws = store.get(), snapshot = canvasSnapshot(ws), expected = this.expected.get(store)
    const entry = this.entries.get(store)
    const external = !!expected && !sameCanvas(expected, snapshot)
    const invalidated = external && !!entry && (entry.undo.length > 0 || entry.redo.length > 0)
    if ((entry && entry.floor !== ws.activeFloor) || external) this.clear(store)
    this.expected.set(store, snapshot)
    return invalidated
  }
  clear(store: WorkspaceStore): void { this.entries.delete(store) }
  private entry(store: WorkspaceStore): Entry {
    const floor = store.get().activeFloor
    let entry = this.entries.get(store)
    if (!entry || entry.floor !== floor) {
      entry = { undo: [], redo: [], floor }; this.entries.set(store, entry)
    }
    return entry
  }
  canUndo(store: WorkspaceStore): boolean { return this.entry(store).undo.length > 0 }
  canRedo(store: WorkspaceStore): boolean { return this.entry(store).redo.length > 0 }

  transact<T>(store: WorkspaceStore, change: () => T, manageRuntime = true): T {
    if (this.busy) return change()
    const entry = this.entry(store), before = canvasSnapshot(store.get())
    this.depth++
    try {
      return store.batchCanvas(() => {
        try {
          const result = change(), after = canvasSnapshot(store.get())
          if (!sameCanvas(before, after)) {
            if (manageRuntime) this.reconcile(before, after, store.get().activeFloor)
            entry.undo.push(before)
            if (entry.undo.length > 50) entry.undo.shift()
            entry.redo = []
          }
          this.expected.set(store, after)
          return result
        } catch (error) {
          this.rollbackDocument(store, before, error)
          throw error
        }
      })
    } finally { this.depth-- }
  }

  undo(store: WorkspaceStore): boolean { return this.step(store, 'undo', 'redo') }
  redo(store: WorkspaceStore): boolean { return this.step(store, 'redo', 'undo') }
  private step(store: WorkspaceStore, from: 'undo' | 'redo', to: 'undo' | 'redo'): boolean {
    if (this.busy) throw new Error('transação em andamento')
    const entry = this.entry(store), snapshot = entry[from].at(-1)
    if (!snapshot) return false
    const before = canvasSnapshot(store.get())
    const target = keepingLivePortalUrls(snapshot, before)
    this.depth++
    try {
      return store.batchCanvas(() => {
        try {
          store.restoreCanvas(target)
          this.reconcile(before, target, store.get().activeFloor)
          entry[from].pop(); entry[to].push(before)
          this.expected.set(store, canvasSnapshot(store.get()))
          return true
        } catch (error) {
          this.rollbackDocument(store, before, error)
          throw error
        }
      })
    } finally { this.depth-- }
  }

  /** A rejected restore may not have mutated anything (e.g. read-only store).
   * Never replace the initiating error with a second rollback/cleanup exception. */
  private rollbackDocument(store: WorkspaceStore, before: CanvasSnapshot, error: unknown): void {
    try {
      if (!isDeepStrictEqual(canvasSnapshot(store.get()), before)) store.restoreCanvas(before)
    } catch (rollbackError) { this.attachRollbackErrors(error, [rollbackError]) }
  }

  private attachRollbackErrors(error: unknown, failures: unknown[]): void {
    if (!failures.length || !(error instanceof Error) || !Object.isExtensible(error)) return
    try {
      const previous = (error as Error & { rollbackErrors?: unknown[] }).rollbackErrors
      Object.defineProperty(error, 'rollbackErrors', { value: [...(Array.isArray(previous) ? previous : []), ...failures], configurable: true })
    } catch { /* diagnostic metadata must never replace the initiating exception */ }
  }

  private reconcile(before: CanvasSnapshot, after: CanvasSnapshot, activeFloor: Workspace['activeFloor']): void {
    const runtime = this.runtime
    if (!runtime) return
    const attempted: string[] = []
    try {
      // Prepare ALL fallible starts before touching any pre-existing process/session.
      for (const [id, node] of Object.entries(after.nodes)) {
        if (node.kind !== 'terminal' || before.nodes[id]?.kind === 'terminal' || node.autoStart === false || node.unloaded || node.floorId !== activeFloor) continue
        // A spawn may install a partial runtime before throwing: clean that ID too.
        attempted.push(id)
        runtime.spawn(node)
      }
      for (const [id, node] of Object.entries(before.nodes)) {
        if (after.nodes[id]?.kind === node.kind) continue
        if (node.kind === 'terminal') runtime.dispose(id)
        if (node.kind === 'portal') runtime.unregister(id)
      }
      for (const [id, node] of Object.entries(after.nodes)) {
        const old = before.nodes[id]
        if (node.kind === 'terminal' && old?.kind === 'terminal' && (node.command !== old.command || node.cwd !== old.cwd || node.agent !== old.agent)) runtime.restart?.(node)
      }
    } catch (error) {
      const failures: unknown[] = []
      for (const id of attempted.reverse()) {
        try { runtime.dispose(id) } catch (cleanupError) { failures.push(cleanupError) }
      }
      this.attachRollbackErrors(error, failures)
      // Old runtimes were never started by this attempt. Do not inverse-reconcile:
      // it would restart unrelated processes or dispose sessions we did not create.
      throw error
    }
  }
}
