import type { WorkspaceRegistry } from './workspace-registry'

/** Remove o workspace do aplicativo sem tocar na pasta do projeto. */
export function removeWorkspace(registry: Pick<WorkspaceRegistry, 'get' | 'remove'>, id: string, cleanup: {
  disposeTerminal(id: string): void
  unregisterPortal(id: string): void
}): void {
  const portalIds = Object.values(registry.get(id).get().nodes).filter(n => n.kind === 'portal').map(n => n.id)
  for (const terminalId of registry.remove(id)) cleanup.disposeTerminal(terminalId)
  for (const portalId of portalIds) cleanup.unregisterPortal(portalId)
}
