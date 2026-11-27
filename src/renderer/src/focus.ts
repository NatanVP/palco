import type { Size, Workspace } from '../../shared/model'
import type { Camera } from './canvas/camera'
import { focusCamera } from './canvas/contextual'

const DEFAULT_CAMERA: Camera = { offset: { x: 0, y: 0 }, zoom: 1 }

/** A câmera salva de quem está na tela: a do Ground ou a do floor ativo. */
export function savedCamera(ws: Workspace): Camera {
  return ws.activeFloor === null ? ws.camera : (ws.floors[ws.activeFloor]?.camera ?? DEFAULT_CAMERA)
}

/**
 * O que a tela mostra quando chega um workspace/floor novo. Com um foco pendente ("Conexões" → nó de outro
 * floor) que está no floor que chegou, centraliza esse nó e o seleciona; senão, a câmera salva e nada selecionado.
 */
export function viewOnAdopt(ws: Workspace, pendingFocus: string | null, view: Size): { camera: Camera; selection: string[] } {
  const camera = savedCamera(ws)
  const target = pendingFocus ? ws.nodes[pendingFocus] : undefined
  if (target && target.floorId === ws.activeFloor) return { camera: focusCamera(camera, target, view), selection: [target.id] }
  return { camera, selection: [] }
}
