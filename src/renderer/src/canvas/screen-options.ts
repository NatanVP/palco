import type { Preferences } from '../../../shared/preferences'
import type { Vec } from '../../../shared/model'
import { MAX_ZOOM, MIN_ZOOM } from './camera'
import type { RopeFrame } from './rope'

type Routing = Preferences['ropeRouting']

/** Só "Ao Redor dos Nós" faz a simulação empurrar a corda para fora dos cards; nos outros estilos ela passa por trás. */
export function ropeObstacles(routing: Routing, obstacles: RopeFrame[]): RopeFrame[] { return routing === 'avoidNodes' ? obstacles : [] }

/** Estilo "Circuito": só segmentos horizontais e verticais, com o degrau no meio do vão maior. */
export function circuitPoints(a: Vec, b: Vec): Vec[] {
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) { const mid = (a.x + b.x) / 2; return [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b] }
  const mid = (a.y + b.y) / 2
  return [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b]
}
export function circuitPath(a: Vec, b: Vec): string {
  const n = (v: number): string => String(Math.round(v * 100) / 100)
  const [p0, ...rest] = circuitPoints(a, b)
  return `M ${n(p0!.x)} ${n(p0!.y)}${rest.map(p => ` L ${n(p.x)} ${n(p.y)}`).join('')}`
}

/** Passo de zoom: 10% por padrão; com "Passo de zoom personalizado" ligado, o percentual escolhido (2–50). */
export function zoomStepBy(zoom: number, dir: 1 | -1, percent: number | null): number {
  const step = percent ?? 10
  const pct = Math.round(zoom * 1000) / 10
  const next = dir > 0 ? (Math.floor(pct / step + 1e-9) + 1) * step : (Math.ceil(pct / step - 1e-9) - 1) * step
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 10) / 1000))
}

/** Duração (ms) da transição da câmera nos saltos (ir até um nó). Movimento reduzido nunca anima. */
export function cameraTransition(movement: Preferences['cameraMovement'], reducedMotion: boolean): number { return movement === 'glide' && !reducedMotion ? 350 : 0 }

export interface HoverState { enabled: boolean; dragging: boolean; linking: boolean; editing: boolean; dialogOpen: boolean; alreadyFocused: boolean }
/** "Focar ao passar o cursor": nunca no meio de um arrasto, de uma ligação, de uma edição ou com diálogo aberto. */
/**
 * Há um campo ou editor em uso fora do card sob o ponteiro? Então focar ao passar o cursor não pode tirar o teclado dele.
 * Vale para input, textarea e editores `contenteditable` (o do Compositor); o terminal não conta.
 */
export function isEditingElsewhere(active: Element | null, target: Element): boolean {
  if (!(active instanceof HTMLElement) || active.closest('.xterm') || target.contains(active)) return false
  return /^(INPUT|TEXTAREA)$/.test(active.tagName) || active.isContentEditable || active.closest('[contenteditable="true"]') !== null
}
export function shouldHoverFocus(s: HoverState): boolean { return s.enabled && !s.dragging && !s.linking && !s.editing && !s.dialogOpen && !s.alreadyFocused }

export { windowOpacityValue } from '../../../shared/new-item'
