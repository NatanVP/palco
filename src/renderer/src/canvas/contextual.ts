import type { FloorId, Size, Vec, Workspace } from '../../../shared/model'
import type { Camera } from './camera'
import { t } from '../i18n'

/**
 * O que a barra contextual mostra para a seleção atual (só nós do floor ativo contam):
 * - um terminal → a barra do terminal; um nó de outro tipo → conectar e excluir;
 * - 2+ terminais fora de banda → "Criar banda"; 1 banda + terminais soltos → "Adicionar à banda";
 * - qualquer outra mistura → só excluir.
 */
export type BarContent =
  | { kind: 'terminal'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'portal'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'band-create'; terminals: string[]; ids: string[] }
  | { kind: 'band-add'; band: string; terminals: string[]; ids: string[] }
  | { kind: 'notes'; ids: string[] }
  | { kind: 'multi'; ids: string[] }

export function barContent(ws: Workspace, selection: ReadonlySet<string>): BarContent | null {
  const ids = [...selection].filter((id) => ws.nodes[id] && ws.nodes[id]!.floorId === ws.activeFloor)
  if (ids.length === 0) return null
  if (ids.length === 1) {
    const id = ids[0]!
    const node = ws.nodes[id]!
    if (node.kind === 'band') return { kind: 'multi', ids }
    if (node.kind === 'terminal' || node.kind === 'note' || node.kind === 'portal') return { kind: node.kind, id }
    return { kind: 'node', id }
  }
  // Só notas: "Colocar no fichário".
  if (ids.every((id) => ws.nodes[id]!.kind === 'note')) return { kind: 'notes', ids }
  const inBand = new Set(Object.values(ws.nodes).flatMap((n) => (n.kind === 'band' ? n.members : [])))
  const loose: string[] = []
  const bands: string[] = []
  for (const id of ids) {
    const node = ws.nodes[id]!
    if (node.kind === 'terminal' && !inBand.has(id)) loose.push(id)
    else if (node.kind === 'band') bands.push(id)
    else return { kind: 'multi', ids }
  }
  if (bands.length === 0) return loose.length >= 2 ? { kind: 'band-create', terminals: loose, ids } : { kind: 'multi', ids }
  if (bands.length === 1 && loose.length > 0) return { kind: 'band-add', band: bands[0]!, terminals: loose, ids }
  return { kind: 'multi', ids }
}

export interface ConnectionRow {
  connectionId: string
  peerId: string
  peerName: string
  /** Floor do outro lado; `floorLabel` só vem preenchido quando é outro floor. */
  floorId: FloorId
  floorLabel: string | null
}

/** Bandas que contêm o nó (para não contar a ligação interna entre colegas de banda). */
function bandMates(ws: Workspace, id: string): Set<string> {
  const mates = new Set<string>()
  for (const n of Object.values(ws.nodes)) if (n.kind === 'band' && n.members.includes(id)) for (const m of n.members) if (m !== id) mates.add(m)
  return mates
}

/** As cordas do nó (em qualquer floor), menos as que vão a um colega da mesma banda. */
export function connectionRows(ws: Workspace, id: string): ConnectionRow[] {
  const self = ws.nodes[id]
  if (!self) return []
  const mates = bandMates(ws, id)
  const rows: ConnectionRow[] = []
  for (const c of ws.connections) {
    if (c.a !== id && c.b !== id) continue
    const peerId = c.a === id ? c.b : c.a
    const peer = ws.nodes[peerId]
    if (!peer || mates.has(peerId)) continue
    const other = peer.floorId !== self.floorId
    rows.push({
      connectionId: c.id,
      peerId,
      peerName: peer.name,
      floorId: peer.floorId,
      floorLabel: other ? (peer.floorId === null ? 'Ground' : (ws.floors[peer.floorId]?.name ?? peer.floorId)) : null
    })
  }
  return rows
}

/** Número do selo azul ao lado do Conectar (0 = o selo some). */
export function connectionCount(ws: Workspace, id: string): number {
  return connectionRows(ws, id).length
}

/** Câmera que centraliza o frame na área visível, sem mudar o zoom. */
export function focusCamera(camera: Camera, frame: { pos: Vec; size: Size }, view: Size): Camera {
  const cx = frame.pos.x + frame.size.w / 2
  const cy = frame.pos.y + frame.size.h / 2
  return { zoom: camera.zoom, offset: { x: view.w / 2 - cx * camera.zoom, y: view.h / 2 - cy * camera.zoom } }
}


export type NoteCommand =
  | { kind: 'bold' | 'italic' | 'strike' | 'code' | 'task' | 'list' | 'code-block' }
  | { kind: 'heading'; level: number }
  | { kind: 'image'; url: string; alt: string }
export const NOTE_FORMAT_EVENT = 'palco:note-format'
export interface NoteFormatDetail { command: NoteCommand; error?: string }

/** Comandos do editor de texto Markdown; nunca altera texto fora da seleção/bloco. */
export function formatNote(text: string, start: number, end: number, command: NoteCommand): { text: string; start: number; end: number } {
  const lo = Math.max(0, Math.min(start, end, text.length)), hi = Math.max(lo, Math.min(Math.max(start, end), text.length))
  const replace = (from: number, to: number, value: string, selectionStart = from, selectionEnd = from + value.length) => ({ text: text.slice(0, from) + value + text.slice(to), start: selectionStart, end: selectionEnd })
  if (command.kind === 'image') {
    const url = new URL(command.url.trim())
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(t('canvas.contextual.use_uma_imagem_http_ou_https'))
    const alt = command.alt.replace(/[\\\[\]]/g, '\\$&')
    return replace(lo, hi, `![${alt}](<${url.href.replace(/[<>]/g, c => encodeURIComponent(c))}>)`)
  }
  if (command.kind === 'heading' || command.kind === 'task' || command.kind === 'list') {
    const from = lo === 0 ? 0 : text.lastIndexOf('\n', lo - 1) + 1
    const last = hi > lo && text[hi - 1] === '\n' ? hi - 1 : hi
    const newline = text.indexOf('\n', last), to = newline === -1 ? text.length : newline
    const lines = text.slice(from, to).split('\n')
    if (command.kind === 'heading' && command.level === 0) return replace(from, to, lines.map(line => line.replace(/^#{1,6}\s+/, '')).join('\n'))
    const prefix = command.kind === 'heading' ? '#'.repeat(Math.max(1, Math.min(6, Math.floor(command.level)))) + ' ' : command.kind === 'task' ? '- [ ] ' : '- '
    const remove = lines.every(line => line.startsWith(prefix))
    const value = lines.map(line => remove ? line.slice(prefix.length) : prefix + (command.kind === 'heading' ? line.replace(/^#{1,6}\s+/, '') : line)).join('\n')
    return replace(from, to, value)
  }
  const selected = text.slice(lo, hi)
  if (command.kind === 'code-block') {
    const fence = '`'.repeat(Math.max(3, ...[...selected.matchAll(/`+/g)].map(m => m[0].length + 1)))
    const body = selected || t('canvas.contextual.codigo')
    const prefix = (lo > 0 && text[lo - 1] !== '\n' ? '\n' : '') + fence + '\n'
    const suffix = '\n' + fence + (hi < text.length && text[hi] !== '\n' ? '\n' : '')
    return replace(lo, hi, prefix + body + suffix, lo + prefix.length, lo + prefix.length + body.length)
  }
  const body = selected || (command.kind === 'code' ? t('canvas.contextual.codigo') : 'texto')
  const marker = command.kind === 'bold' ? '**' : command.kind === 'italic' ? '*' : command.kind === 'strike' ? '~~' : '`'.repeat(Math.max(1, ...[...body.matchAll(/`+/g)].map(m => m[0].length + 1)))
  return replace(lo, hi, marker + body + marker, lo + marker.length, lo + marker.length + body.length)
}
