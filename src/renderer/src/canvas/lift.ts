import type { CanvasNode, Size, Vec } from '../../../shared/model'
import type { Camera } from './camera'

/** Menor lado do painel elevado e a folga da barra do topo (dock + barra de contexto). */
export const LIFT_MIN = 240
export const LIFT_TOP_INSET = 96

/** Terminal, nota, portal e árvore de arquivos se elevam; banda e itens soltos (arquivo, texto, link) não. */
export const isLiftable = (n: Pick<CanvasNode, 'kind'>): boolean => n.kind === 'terminal' || n.kind === 'note' || n.kind === 'portal' || n.kind === 'filetree'

export interface PanelRect { x: number; y: number; w: number; h: number }

/**
 * Painel central do elemento elevado, em pixels de tela: nota estreita (720), terminal e portal largos
 * (até 1400, 80 de folga), árvore de arquivos (560); centrado na área abaixo da barra do topo, nunca menor que 240 nem maior que a área livre.
 */
export function liftRect(n: Pick<CanvasNode, 'kind'>, view: { w: number; h: number }): PanelRect {
  const availW = Math.max(view.w, LIFT_MIN), availH = Math.max(view.h - LIFT_TOP_INSET, LIFT_MIN)
  const want = n.kind === 'note' ? { w: Math.min(720, availW - 96), h: availH - 72 }
    : n.kind === 'filetree' ? { w: Math.min(560, availW - 96), h: availH - 56 }
      : { w: Math.min(availW - 80, 1400), h: availH - 56 }
  const w = Math.min(Math.max(want.w, LIFT_MIN), Math.max(availW - 40, LIFT_MIN)), h = Math.min(Math.max(want.h, LIFT_MIN), Math.max(availH - 16, LIFT_MIN))
  return { x: (availW - w) / 2, y: LIFT_TOP_INSET + (availH - h) / 2, w, h }
}

/** O painel de tela como moldura de mundo: o card segue no mesmo lugar do React (sem remontar), só com a escala 1/zoom para ficar do tamanho real. */
export function liftFrame(r: PanelRect, camera: Camera): { pos: Vec; size: Size; scale: number } {
  return { pos: { x: (r.x - camera.offset.x) / camera.zoom, y: (r.y - camera.offset.y) / camera.zoom }, size: { w: r.w, h: r.h }, scale: 1 / camera.zoom }
}
