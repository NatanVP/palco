import type { Size, Vec } from '../../../shared/model'
import { newItemSize } from '../../../shared/new-item'
import type { Preferences } from '../../../shared/preferences'

/** Tipos de nó que as ferramentas do dock colocam desenhando a área no canvas. */
export type PlaceKind = 'terminal' | 'note' | 'filetree' | 'portal' | 'text' | 'file'

/** Tamanho usado quando o gesto é um clique (arrasto curto), centrado no ponto. */
export const PLACE_DEFAULTS: Record<PlaceKind, Size> = {
  terminal: { w: 560, h: 360 },
  note: { w: 260, h: 100 },
  filetree: { w: 300, h: 300 },
  portal: { w: 640, h: 420 },
  text: { w: 240, h: 60 },
  file: { w: 520, h: 420 }
}

/** Abaixo disto (em unidades de mundo, nos dois eixos) o gesto conta como clique. */
export const CLICK_THRESHOLD = 24

/** Lado mínimo de um retângulo desenhado: a validação do main recusa nós com lado < 50. */
export const MIN_DRAWN_SIDE = 60

export const isPlaceKind = (v: unknown): v is PlaceKind => typeof v === 'string' && Object.hasOwn(PLACE_DEFAULTS, v)

const snap = (v: number, grid: number): number => Math.round(v / grid) * grid

/**
 * Frame do nó a criar, em coordenadas de mundo, a partir do início e do fim do gesto.
 * - Arrasto: o retângulo com os cantos levados para fora da grade (nunca encolhe o que foi desenhado).
 * - Clique (menos de 24 nos dois eixos): o tamanho padrão do tipo, centrado no ponto e alinhado à grade.
 */
export function placementFrame(start: Vec, end: Vec, kind: PlaceKind, grid = 20, prefs?: Pick<Preferences, 'defaultTerminalSize' | 'defaultPortalSize' | 'defaultNoteSize'>): { pos: Vec; size: Size } {
  if (Math.abs(end.x - start.x) < CLICK_THRESHOLD && Math.abs(end.y - start.y) < CLICK_THRESHOLD) {
    const size = (prefs && newItemSize(kind, prefs)) || PLACE_DEFAULTS[kind]
    return { pos: { x: snap(start.x - size.w / 2, grid), y: snap(start.y - size.h / 2, grid) }, size: { ...size } }
  }
  const drawn = previewFrame(start, end, grid)
  return { pos: drawn.pos, size: { w: Math.max(drawn.size.w, MIN_DRAWN_SIDE), h: Math.max(drawn.size.h, MIN_DRAWN_SIDE) } }
}

/** Retângulo do preview durante o arrasto: o mesmo snap para fora, sem mínimo (mostra o gesto como está). */
export function previewFrame(start: Vec, end: Vec, grid = 20): { pos: Vec; size: Size } {
  const x0 = Math.floor(Math.min(start.x, end.x) / grid) * grid
  const y0 = Math.floor(Math.min(start.y, end.y) / grid) * grid
  const x1 = Math.ceil(Math.max(start.x, end.x) / grid) * grid
  const y1 = Math.ceil(Math.max(start.y, end.y) / grid) * grid
  return { pos: { x: x0, y: y0 }, size: { w: x1 - x0, h: y1 - y0 } }
}

/**
 * O gesto de colocação: começa no pointerdown, mostra o preview no move e entrega o frame no up.
 * `cancel` (Esc, pointercancel, janela perdendo o foco) descarta tudo: o próximo `end` não cria nada.
 */
export class PlacementGesture {
  private kind: PlaceKind | null = null
  private start: Vec | null = null
  private shown: { pos: Vec; size: Size } | null = null
  /** Padrões de tamanho (Configurações › Padrões de Novos Itens) usados quando o gesto é um clique. */
  prefs: Parameters<typeof placementFrame>[4]

  get active(): boolean { return this.start !== null }
  get preview(): { pos: Vec; size: Size } | null { return this.shown }

  begin(kind: PlaceKind, at: Vec): void {
    this.kind = kind
    this.start = { ...at }
    this.shown = previewFrame(at, at)
  }

  move(to: Vec): { pos: Vec; size: Size } | null {
    if (!this.start) return null
    this.shown = previewFrame(this.start, to)
    return this.shown
  }

  end(at: Vec): { kind: PlaceKind; frame: { pos: Vec; size: Size } } | null {
    if (!this.start || !this.kind) return null
    const result = { kind: this.kind, frame: placementFrame(this.start, at, this.kind, 20, this.prefs) }
    this.cancel()
    return result
  }

  cancel(): void {
    this.kind = null
    this.start = null
    this.shown = null
  }
}
