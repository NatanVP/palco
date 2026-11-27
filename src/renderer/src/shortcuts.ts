import { getPreferences, matchesShortcut } from './settings/preferences'
import { resolveCommand } from './canvas/commands/keymap'
import { WorkspaceJumpArm } from './canvas/commands/jump'
import { matchShortcut, type KeyInput, type ShortcutId, type ShortcutMap } from '../../shared/shortcuts'
/** Focus routing stays in each consumer; bindings come from the live preference snapshot. */
export const isPartiturasShortcut = (e: KeyInput): boolean => matchesShortcut('partituras', e)
export const isConnectShortcut = (e: KeyInput): boolean => matchesShortcut('connect', e)
const GLOBAL_IDS = ['partituras', 'settings', 'prompter'] as const
type GlobalId = (typeof GLOBAL_IDS)[number]

/** Quem digita: campo, nota em edição, terminal, seletor. Uma tecla sem Ctrl/Cmd/Alt aí é texto, não atalho. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null
  if (!t) return false
  const tag = (t.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true
  return !!t.closest?.('.xterm, [contenteditable="true"]')
}

/** Um caractere sem Ctrl, Cmd nem Alt, onde alguém está digitando, é texto: nenhum comando o toma (mesmo regravado assim). */
export const typingKeepsKey = (e: KeyInput & { target?: EventTarget | null }): boolean => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && isTypingTarget(e.target ?? null)

/** Atalho global com o mapa dado. Sem modificador principal (Ctrl/Cmd/Alt), o foco em quem digita fica com a tecla. */
export function matchesGlobalShortcutIn(id: GlobalId, e: KeyInput & { target?: EventTarget | null }, map: ShortcutMap): boolean {
  if (!matchShortcut(id as ShortcutId, e, map)) return false
  return e.ctrlKey || e.metaKey || e.altKey || !isTypingTarget(e.target ?? null)
}
export const matchesGlobalShortcut = (id: GlobalId, e: KeyInput & { target?: EventTarget | null }): boolean =>
  matchesShortcut(id, e) && matchesGlobalShortcutIn(id, e, getPreferences().shortcuts)
/** Teclas que o canvas toma do terminal (ciclos, saltos, zoom, busca…): o xterm não as manda ao shell. Só espia: não gasta o salto armado. */
export const isCanvasCommandKey = (e: KeyInput & { target?: EventTarget | null }): boolean => !typingKeepsKey(e) && resolveCommand(e, { shortcuts: getPreferences().shortcuts, jump: sharedJump, now: performance.now(), consume: false }) !== null
export const sharedJump = new WorkspaceJumpArm()
export const isGlobalShortcut = (e: KeyInput & { target?: EventTarget | null }): boolean => GLOBAL_IDS.some(id => matchesGlobalShortcut(id, e)) || isCanvasCommandKey(e)
