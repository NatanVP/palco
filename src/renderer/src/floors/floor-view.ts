import type { CanvasNode, Connection, CrossLinkView, FloorId, FloorState, Workspace } from '../../../shared/model'
import { t } from '../i18n'

/** Os nós do floor ativo (Ground = null): o canvas só desenha estes. */
export function nodesOnFloor(ws: Workspace): CanvasNode[] {
  return Object.values(ws.nodes).filter((n) => n.floorId === ws.activeFloor)
}

/** Conexões entre nós do floor ativo (o store já impede ligar floors diferentes). */
export function visibleConnections(ws: Workspace): Connection[] {
  const shown = new Set(nodesOnFloor(ws).map((n) => n.id))
  return ws.connections.filter((c) => shown.has(c.a) && shown.has(c.b))
}

export interface FloorTab {
  id: FloorId
  label: string
  active: boolean
  status?: { state: FloorState; progress?: string; text?: string }
  tooltip: string
}

const statusTip = (s: { state: FloorState; progress?: string; text?: string }): string =>
  `${s.state}${s.text ? ` — ${s.text}` : ''}${s.progress ? ` (${s.progress})` : ''}`

/** Ground primeiro, depois os floors por ordem de criação. */
export function floorTabs(ws: Workspace): FloorTab[] {
  const g = ws.groundStatus
  const tabs: FloorTab[] = [{ id: null, label: t('floors.floor-view.ground'), active: ws.activeFloor === null, ...(g ? { status: g } : {}), tooltip: g ? statusTip(g) : t('floors.floor-view.canvas_principal') }]
  for (const f of Object.values(ws.floors).sort((a, b) => a.createdAt - b.createdAt)) {
    tabs.push({
      id: f.id,
      label: f.name,
      active: ws.activeFloor === f.id,
      ...(f.status ? { status: f.status } : {}),
      tooltip: f.status ? statusTip(f.status) : f.branch
    })
  }
  return tabs
}

export interface CrossFloorPeer {
  connectionId: string
  peerId: string
  peerName: string
  floorId: FloorId
  floorLabel: string
}

/** Conexões deste terminal com terminais de OUTRO floor (o canvas não as desenha: viram chips no cabeçalho). */
export function crossFloorPeers(ws: Workspace, nodeId: string): CrossFloorPeer[] {
  const self = ws.nodes[nodeId]
  if (self?.kind !== 'terminal') return []
  const peers: CrossFloorPeer[] = []
  for (const c of ws.connections) {
    if (c.a !== nodeId && c.b !== nodeId) continue
    const peer = ws.nodes[c.a === nodeId ? c.b : c.a]
    if (peer?.kind !== 'terminal' || peer.floorId === self.floorId) continue
    peers.push({
      connectionId: c.id,
      peerId: peer.id,
      peerName: peer.name,
      floorId: peer.floorId,
      floorLabel: peer.floorId === null ? 'Ground' : (ws.floors[peer.floorId]?.name ?? peer.floorId)
    })
  }
  return peers
}

export interface CrossWorkspacePeer { linkId: string; peerId: string; label: string }

/** Cordas deste nó com nós de OUTRO workspace (chips no cabeçalho, com o endereço `Nome @ Workspace`). */
export function crossWorkspacePeers(links: readonly CrossLinkView[], nodeId: string): CrossWorkspacePeer[] {
  return links.flatMap((l) => {
    const other = l.a.id === nodeId ? l.b : l.b.id === nodeId ? l.a : undefined
    return other ? [{ linkId: l.id, peerId: other.id, label: `${other.name} @ ${other.workspace}` }] : []
  })
}
