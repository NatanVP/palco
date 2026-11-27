import { DICTATE_EVENT } from '../../voice/events'
import { useCallback, useRef, type MutableRefObject } from 'react'
import type { CanvasNode, Size, Workspace } from '../../../../shared/model'
import { MAX_ZOOM, MIN_ZOOM, zoomAt, type Camera } from '../camera'
import { focusCamera } from '../contextual'
import { zoomStepBy } from '../screen-options'
import { alignFrames } from './align'
import { movableNodeIds } from '../selection/group'
import type { Command } from './keymap'
import { connectedOrder, cycleId, spatialOrder } from './order'
import { TIDY_LAYOUTS, tidyFrames } from './tidy'
import { fitCamera, unionBox } from './view'
import { isLiftable } from '../lift'
import { dismissLift, landDocked, togglePanel, type DockState } from '../dock'
import { getPreferences } from '../../settings/preferences'
import type { Sidebar } from '../../../../shared/model'
import { t } from '../../i18n'

export interface CommandDeps {
  ws: MutableRefObject<Workspace | null>
  camera: MutableRefObject<Camera>
  view: MutableRefObject<Size>
  sidebar: MutableRefObject<Sidebar | null>
  selection: ReadonlySet<string>
  setSelection(ids: Set<string>): void
  changeCamera(c: Camera, jump?: boolean): void
  switchWorkspace(id: string): Promise<void>
  toggleMinimap(): void
  openSearch(): void
  notify(message: string): void
  /** Elemento elevado agora (painel central) e como mudar. */
  dock: DockState
  setDock(next: DockState): void
}

/** Os nós do andar à vista, sem as bandas (elas não têm moldura própria). */
export const visibleNodes = (ws: Workspace): CanvasNode[] => Object.values(ws.nodes).filter(n => n.floorId === ws.activeFloor && n.kind !== 'band')

/**
 * Executa um comando do canvas (atalho, Batuta Search). Guarda o que precisa entre uma tecla e outra: a âncora do ciclo de
 * conectados, a vista anterior do "Alternar foco" e o próximo layout do "Organizar".
 */
export function useCanvasCommands(d: CommandDeps): (command: Command) => void {
  const anchor = useRef<string | null>(null)
  const previousView = useRef<{ camera: Camera; id: string } | null>(null)
  const tidyStep = useRef({ key: '', index: 0 })
  const depsRef = useRef(d); depsRef.current = d
  return useCallback((command: Command): void => {
    const x = depsRef.current, ws = x.ws.current
    if (!ws) return
    const nodes = visibleNodes(ws), selected = [...x.selection].filter(id => ws.nodes[id] && ws.nodes[id]!.floorId === ws.activeFloor && ws.nodes[id]!.kind !== 'band')
    const current = selected.length === 1 ? selected[0]! : null
    const go = (id: string, jump = true): void => {
      const node = ws.nodes[id]; if (!node) return
      x.changeCamera(focusCamera(x.camera.current, node, x.view.current), jump); x.setSelection(new Set([id]))
    }
    const commit = (patches: Array<{ id: string; pos: { x: number; y: number } }>): void => {
      const ops = patches.filter(p => { const n = ws.nodes[p.id]!; return n.pos.x !== p.pos.x || n.pos.y !== p.pos.y }).map(p => ({ type: 'node.patch' as const, id: p.id, patch: { pos: p.pos } }))
      if (ops.length) void window.palco.history.commit(ws.id, ops).catch(() => x.notify(t('canvas.commands.useCommands.nao_foi_possivel_mover_os_elem')))
    }
    /** Molduras para olhar (zoom, foco): a trava não importa. Para mover (alinhar, organizar), só o que não está preso. */
    const framesOf = (ids: string[]) => ids.map(id => ({ id, pos: ws.nodes[id]!.pos, size: ws.nodes[id]!.size }))
    const movableFrames = (ids: string[]) => framesOf(movableNodeIds(ws, ids))
    switch (command.kind) {
      case 'workspace': {
        const sb = x.sidebar.current; if (!sb) return
        const next = cycleId(sb.order, sb.active, command.dir); if (next && next !== sb.active) void x.switchWorkspace(next)
        return
      }
      case 'jumpWorkspace': { const id = x.sidebar.current?.order[command.index]; if (id && id !== x.sidebar.current?.active) void x.switchWorkspace(id); return }
      case 'node': { anchor.current = null; const id = cycleId(spatialOrder(nodes).map(n => n.id), current, command.dir); if (id) go(id); return }
      case 'jumpNode': { const id = spatialOrder(nodes)[command.index]?.id; if (id) go(id); return }
      case 'connected': {
        if (!current) return
        const a = anchor.current && connectedOrder(nodes, ws.connections, anchor.current).includes(current) ? anchor.current : current
        const peers = connectedOrder(nodes, ws.connections, a)
        if (!peers.length) { x.notify(t('canvas.commands.useCommands.este_elemento_nao_tem_conexoes')); return }
        anchor.current = a
        // Na âncora, o primeiro (ou último) vizinho; num vizinho, o seguinte; depois do último, volta para o primeiro.
        const id = current === a ? (command.dir === 1 ? peers[0]! : peers[peers.length - 1]!) : cycleId(peers, current, command.dir)
        if (id) go(id)
        return
      }
      case 'toggleFocus': {
        const prev = previousView.current
        if (prev && current === prev.id) { x.changeCamera(prev.camera, true); previousView.current = null; return }
        if (!current) return
        previousView.current = { camera: x.camera.current, id: current }
        x.changeCamera(fitCamera(unionBox(framesOf([current])), x.view.current), true)
        return
      }
      case 'zoomSelection': {
        const ids = selected.length ? selected : []
        if (!ids.length) return
        x.changeCamera(fitCamera(unionBox(framesOf(ids)), x.view.current), true)
        return
      }
      case 'zoom': {
        const cam = x.camera.current, c = { x: x.view.current.w / 2, y: x.view.current.h / 2 }
        const target = command.op === 'reset' ? 1 : zoomStepBy(cam.zoom, command.op === 'in' ? 1 : -1, getPreferences().zoomStepPercent)
        x.changeCamera(zoomAt(cam, c, Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target)) / cam.zoom))
        return
      }
      case 'chatSwap': {
        // Alterna a face do terminal de agente que tem o foco (ou, sem foco em nenhum, o selecionado): chat ↔ terminal.
        const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null
        const id = focused ?? current, n = id ? ws.nodes[id] : undefined
        if (!n || n.kind !== 'terminal' || n.agent === 'shell') { x.notify(t('canvas.commands.useCommands.selecione_um_terminal_de_agent')); return }
        void window.palco.node.patch(n.id, { chatMode: n.chatMode !== true })
        return
      }
      case 'dictate': {
        // Liga ou desliga o ditado no chat que tem o foco (ou no selecionado).
        const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null
        const id = focused ?? current, n = id ? ws.nodes[id] : undefined
        if (!n || n.kind !== 'terminal' || n.agent === 'shell' || n.chatMode !== true) { x.notify(t('canvas.commands.useCommands.abra_um_chat_para_ditar')); return }
        window.dispatchEvent(new CustomEvent(DICTATE_EVENT, { detail: { id: n.id } }))
        return
      }
      case 'lift': {
        // Elevar/recolher: com algo elevado, recolhe; senão eleva o elemento selecionado (ou o que tem o foco).
        if (x.dock.liftedId) { x.setDock(dismissLift(x.dock)); return }
        const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null
        const id = current ?? focused, n = id ? ws.nodes[id] : undefined
        if (!n && x.dock.dockedId) { x.setDock(landDocked(x.dock)); return }
        if (!n || n.floorId !== ws.activeFloor || !isLiftable(n)) { x.notify(t('canvas.commands.useCommands.selecione_um_terminal_nota_por')); return }
        x.setDock(togglePanel(x.dock, n.id)); x.setSelection(new Set([n.id])); return
      }
      case 'minimap': x.toggleMinimap(); return
      case 'search': x.openSearch(); return
      case 'align': {
        if (selected.length < 2) { x.notify(t('canvas.commands.useCommands.selecione_dois_ou_mais_element')); return }
        const r = alignFrames(command.action, movableFrames(selected))
        if (!r.length) { x.notify(t('canvas.commands.useCommands.distribuir_precisa_de_tres_ele')); return }
        commit(r); return
      }
      case 'tidy': {
        if (selected.length < 2) { x.notify(t('canvas.commands.useCommands.selecione_dois_ou_mais_element')); return }
        const key = [...selected].sort().join(',')
        const index = tidyStep.current.key === key ? (tidyStep.current.index + 1) % TIDY_LAYOUTS.length : 0
        tidyStep.current = { key, index }
        commit(tidyFrames(movableFrames(selected), TIDY_LAYOUTS[index]!)); return
      }
    }
  }, [])
}
