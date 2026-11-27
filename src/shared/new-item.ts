import type { NoteFontFamily, Size, Vec } from './model'
import { NOTE_FONT_FAMILIES } from './model'
import type { NOTE_COLORS, Preferences } from './preferences'

/** Paleta de notas do palco (as dez cores do seletor de Padrões de Novos Itens) em hex, o formato que o nó guarda. */
export const NOTE_COLOR_HEX: Record<(typeof NOTE_COLORS)[number], string> = {
  yellow: '#e0c45c', pink: '#e58fb0', blue: '#6aa8e8', green: '#78c58a', orange: '#e8a35e',
  purple: '#a58be0', white: '#e8e8ec', charcoal: '#4a4d55', slate: '#6b7a8f', midnight: '#2f3a5c'
}
type Prefs = Pick<Preferences, 'defaultNoteColor' | 'defaultNoteFontSize' | 'defaultNoteFontFamily' | 'defaultNoteSize'>
export interface NoteDefaults { color: string; fontSize: number; fontFamily?: NoteFontFamily; size: Size }

/** O que uma nota nova herda das preferências. Fonte que o nó não sabe desenhar (só mono, sans, serif) fica de fora. */
export function noteDefaults(p: Prefs): NoteDefaults {
  const family = (NOTE_FONT_FAMILIES as readonly string[]).includes(p.defaultNoteFontFamily ?? '') ? (p.defaultNoteFontFamily as NoteFontFamily) : undefined
  return {
    color: NOTE_COLOR_HEX[p.defaultNoteColor], fontSize: p.defaultNoteFontSize, ...(family ? { fontFamily: family } : {}),
    size: { w: p.defaultNoteSize.width, h: p.defaultNoteSize.height }
  }
}

/** Tamanho do item criado por clique: terminal, nota e portal vêm das preferências; os demais tipos não têm padrão configurável. */
export function newItemSize(kind: string, p: Pick<Preferences, 'defaultTerminalSize' | 'defaultPortalSize' | 'defaultNoteSize'>): Size | null {
  const of = (s: { width: number; height: number }): Size => ({ w: s.width, h: s.height })
  return kind === 'terminal' ? of(p.defaultTerminalSize) : kind === 'portal' ? of(p.defaultPortalSize) : kind === 'note' ? of(p.defaultNoteSize) : null
}

/** Opacidade da janela (porcentagem do seletor) em fração de 0 a 1. */
export const windowOpacityValue = (percent: number): number => percent / 100

interface Boxed { pos: Vec; size: Size; floorId: string | null }
const GAP = 20
const overlaps = (at: Vec, size: Size, n: Boxed): boolean =>
  at.x < n.pos.x + n.size.w + GAP && at.x + size.w + GAP > n.pos.x && at.y < n.pos.y + n.size.h + GAP && at.y + size.h + GAP > n.pos.y

/**
 * Onde um agente põe o item que criou. `stack` usa o ponto pedido (empilha sobre o que já estiver ali);
 * `freeSpace` procura em espiral, em passos de uma grade, o primeiro lugar do mesmo andar que não encosta em nenhum item.
 */
export function freeSpot(mode: 'stack' | 'freeSpace', nodes: readonly Boxed[], floorId: string | null, origin: Vec, size: Size): Vec {
  if (mode === 'stack') return origin
  const same = nodes.filter(n => n.floorId === floorId)
  const free = (at: Vec): boolean => !same.some(n => overlaps(at, size, n))
  if (free(origin)) return origin
  const stepX = size.w + GAP, stepY = size.h + GAP
  for (let ring = 1; ring <= 40; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
      const at = { x: origin.x + dx * stepX, y: origin.y + dy * stepY }
      if (free(at)) return at
    }
  }
  return origin
}
