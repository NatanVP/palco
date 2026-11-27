import type { Vec, Workspace } from '../../../shared/model'

export type Camera = Workspace['camera']

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2

export function screenToWorld(p: Vec, cam: Camera): Vec {
  return { x: (p.x - cam.offset.x) / cam.zoom, y: (p.y - cam.offset.y) / cam.zoom }
}

export function worldToScreen(p: Vec, cam: Camera): Vec {
  return { x: p.x * cam.zoom + cam.offset.x, y: p.y * cam.zoom + cam.offset.y }
}

/** Zoom em torno de um ponto da tela: o ponto do mundo sob o cursor não se mexe. */
export function zoomAt(cam: Camera, screenPoint: Vec, factor: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor))
  const world = screenToWorld(screenPoint, cam)
  return { zoom, offset: { x: screenPoint.x - world.x * zoom, y: screenPoint.y - world.y * zoom } }
}

export function snap(v: number, grid = 20): number {
  return Math.round(v / grid) * grid
}

/** Próximo passo de 10% (sempre num múltiplo de 10%), entre 25% e 200%. */
export function zoomStep(zoom: number, dir: 1 | -1): number {
  const pct = Math.round(zoom * 100)
  const next = dir > 0 ? Math.floor(pct / 10) * 10 + 10 : Math.ceil(pct / 10) * 10 - 10
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next / 100))
}
