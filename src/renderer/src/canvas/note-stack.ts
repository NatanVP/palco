import type { CanvasNode, NodePatch, NoteNode, Workspace } from '../../../shared/model'
import { isHeld } from '../../../shared/lock'

/** Espaço entre a nota que sai do fichário e o card dele. */
const UNFILE_GAP = 40

export interface StackTab { id: string; name: string; active: boolean }

/** "Colocar no fichário": todas as notas ganham o id novo e o frame da primeira da seleção. */
export function fileNotes(ws: Workspace, ids: string[], stackId: string): Array<{ id: string; patch: NodePatch }> {
  // Nota presa no lugar (bloqueada, ou no fichário de uma) não é movida para outro fichário.
  const notes = ids.map((id) => ws.nodes[id]).filter((n): n is NoteNode => n?.kind === 'note' && !isHeld(ws.nodes, n))
  const first = notes[0]
  if (!first) return []
  return notes.map((n) => ({ id: n.id, patch: { stackId, pos: { ...first.pos }, size: { ...first.size } } }))
}

/** "Tirar do fichário": a nota volta a ser solta, ao lado do card. */
export function unfileNote(ws: Workspace, id: string): { id: string; patch: NodePatch } | null {
  const n = ws.nodes[id]
  if (n?.kind !== 'note' || !n.stackId) return null
  // A bloqueada sai do fichário sem sair do lugar.
  return { id, patch: n.positionLocked ? { stackId: null } : { stackId: null, pos: { x: n.pos.x + n.size.w + UNFILE_GAP, y: n.pos.y } } }
}

/** Notas do mesmo fichário (na ordem do workspace). */
export function stackMembers(nodes: Iterable<CanvasNode>, stackId: string): NoteNode[] {
  return [...nodes].filter((n): n is NoteNode => n.kind === 'note' && n.stackId === stackId)
}

/**
 * Vista do canvas: cada fichário com 2+ notas vira um card só — a nota da frente (escolhida na aba, ou a
 * primeira) aparece com as abas; as outras ficam escondidas. Fichário com uma nota é uma nota comum.
 */
export function stackView(nodes: CanvasNode[], front: Record<string, string>): { hidden: Set<string>; tabs: Map<string, StackTab[]> } {
  const groups = new Map<string, NoteNode[]>()
  for (const n of nodes) if (n.kind === 'note' && n.stackId) groups.set(n.stackId, [...(groups.get(n.stackId) ?? []), n])
  const hidden = new Set<string>()
  const tabs = new Map<string, StackTab[]>()
  for (const [stack, members] of groups) {
    if (members.length < 2) continue
    const shown = members.find((m) => m.id === front[stack]) ?? members[0]!
    for (const m of members) if (m.id !== shown.id) hidden.add(m.id)
    tabs.set(shown.id, members.map((m) => ({ id: m.id, name: m.name, active: m.id === shown.id })))
  }
  return { hidden, tabs }
}
