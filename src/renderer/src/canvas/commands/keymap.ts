import { matchShortcut, type KeyInput, type ShortcutId, type ShortcutMap } from '../../../../shared/shortcuts'
import { isAlignId, ALIGN_IDS, type AlignId } from './align'
import type { WorkspaceJumpArm } from './jump'

export type Command =
  | { kind: 'workspace'; dir: 1 | -1 } | { kind: 'node'; dir: 1 | -1 } | { kind: 'connected'; dir: 1 | -1 }
  | { kind: 'toggleFocus' } | { kind: 'lift' } | { kind: 'chatSwap' } | { kind: 'dictate' } | { kind: 'zoomSelection' } | { kind: 'search' } | { kind: 'minimap' } | { kind: 'tidy' }
  | { kind: 'zoom'; op: 'in' | 'out' | 'reset' }
  | { kind: 'jumpNode'; index: number } | { kind: 'jumpWorkspace'; index: number }
  | { kind: 'align'; action: AlignId }

/** `consume: false` só espia (o terminal pergunta se a tecla é do canvas sem gastar o salto armado). */
export interface KeymapContext { shortcuts: ShortcutMap; jump: WorkspaceJumpArm; now: number; consume?: boolean }
const SIMPLE: ReadonlyArray<[ShortcutId, Command]> = [
  ['nextWorkspace', { kind: 'workspace', dir: 1 }], ['prevWorkspace', { kind: 'workspace', dir: -1 }],
  ['nextNode', { kind: 'node', dir: 1 }], ['prevNode', { kind: 'node', dir: -1 }],
  ['nextConnected', { kind: 'connected', dir: 1 }], ['prevConnected', { kind: 'connected', dir: -1 }],
  ['toggleFocus', { kind: 'toggleFocus' }], ['lift', { kind: 'lift' }], ['zoomSelection', { kind: 'zoomSelection' }], ['filter', { kind: 'search' }], ['chatSwap', { kind: 'chatSwap' }], ['dictate', { kind: 'dictate' }],
  ['minimap', { kind: 'minimap' }], ['tidy', { kind: 'tidy' }],
  ['zoomIn', { kind: 'zoom', op: 'in' }], ['zoomOut', { kind: 'zoom', op: 'out' }], ['zoom100', { kind: 'zoom', op: 'reset' }]
]
const DIGIT = /^(?:Digit|Numpad)([1-9])$/

/**
 * Traduz uma tecla no comando do canvas, pelo mapa de atalhos vivo. Não decide foco nem contexto (isso é do chamador) e não executa nada.
 * Ações reservadas (com `reason`) nunca disparam: `matchShortcut` as recusa.
 */
export function resolveCommand(e: KeyInput, ctx: KeymapContext): Command | null {
  for (const [id, command] of SIMPLE) if (matchShortcut(id, e, ctx.shortcuts)) return command
  for (const id of ALIGN_IDS) if (isAlignId(id) && matchShortcut(id, e, ctx.shortcuts)) return { kind: 'align', action: id }
  const digit = DIGIT.exec(e.code ?? '')?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : undefined)
  if (digit) {
    const n = Number(digit)
    if (matchShortcut('workspaceJump', e, ctx.shortcuts)) {
      const i = ctx.consume === false ? (ctx.jump.armed(ctx.now) ? n - 1 : null) : ctx.jump.digit(ctx.now, n)
      if (i !== null) return { kind: 'jumpWorkspace', index: i }
    }
    if (matchShortcut('nodeJump', e, ctx.shortcuts)) return { kind: 'jumpNode', index: n - 1 }
  }
  return null
}
