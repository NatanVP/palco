import type { CanvasNode, TerminalNode } from '../../shared/model'
/** One stale role/failed PTY cannot make all other saved workspaces inaccessible. */
export function restoreTerminals(nodes: CanvasNode[], spawn: (node: TerminalNode) => void): string[] {
  const failed: string[] = []
  for (const node of nodes) if (node.kind === 'terminal' && node.autoStart !== false) {
    try { spawn(node) } catch { failed.push(node.id) }
  }
  return failed
}
