/** A binding contains serializable key data only. `mod` accepts Ctrl OR Cmd, never both. */
export interface KeyBinding { key: string; code?: string; mod?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }
export type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { code?: string }
export type ShortcutScope = 'global' | 'canvas' | 'drawing' | 'floor' | 'dialog'
interface Definition<I extends string> { id: I; label: string; scope: ShortcutScope; defaults: KeyBinding[]; kind?: 'modifier' | 'hold'; reason?: string; loose?: boolean; allowAlt?: boolean }
const d = <I extends string>(id: I, label: string, scope: ShortcutScope, defaults: KeyBinding[], extra: Partial<Omit<Definition<I>, 'id' | 'label' | 'scope' | 'defaults'>> = {}): Definition<I> => ({ id, label, scope, defaults, ...extra })
const mod = (key: string, shift = false): KeyBinding => ({ key, mod: true, ...(shift ? { shift } : {}) })
const key = (k: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key: k, ...extra })
const back = { key: '\\', code: 'Backslash' }
/** Ações indisponíveis aparecem com o motivo e não gravam alterações. */
const needs = (what: string): string => `Depende ${what}.`
/**
 * Ctrl/Cmd = `mod`. Delete, Backspace e Ctrl+W apagam a seleção.
 * Alinhar e distribuir ficam sem atalho para o usuário escolher nas Configurações.
 */
export const SHORTCUTS = [
  d('settings', 'Configurações', 'global', [mod(',')]),
  d('prompter', 'Compositor de Prompts', 'global', [mod('p', true)]),
  d('filter', 'Batuta Search', 'global', [mod('p')]),
  d('partituras', 'Partituras', 'global', [mod('l', true)]),
  d('connect', 'Conectar', 'canvas', [mod('l')]),
  d('newTerminal', 'Novo terminal', 'canvas', [mod('t')]),
  d('toggleSidebar', 'Mostrar/ocultar barra lateral', 'global', [mod('s')], { allowAlt: true }),
  d('floorOverview', 'Visão geral de andares', 'floor', [{ ...back, mod: true, shift: true }], { allowAlt: true }),
  d('undo', 'Desfazer', 'canvas', [mod('z')]),
  d('redo', 'Refazer', 'canvas', [mod('z', true)]),
  d('drawRectangle', 'Armar retângulo', 'drawing', [{ key: 'b' }]),
  d('drawThinner', 'Diminuir espessura', 'drawing', [{ key: '[' }]),
  d('drawThicker', 'Aumentar espessura', 'drawing', [{ key: ']' }]),
  d('cancel', 'Cancelar/voltar à seleção', 'global', [{ key: 'Escape' }], { loose: true }),
  d('deleteSelection', 'Apagar seleção / corda', 'canvas', [mod('w'), { key: 'Delete' }, { key: 'Backspace' }]),
  d('selectAll', 'Selecionar tudo', 'canvas', [mod('a')]),
  d('copy', 'Copiar seleção', 'canvas', [mod('c')]),
  d('paste', 'Colar', 'canvas', [mod('v')]),
  d('duplicate', 'Duplicar seleção', 'canvas', [mod('d')]),
  d('panToggle', 'Alternar pan', 'canvas', [{ key: 'h' }]),
  d('panHold', 'Segurar pan', 'canvas', [{ key: '', ctrl: true }, { key: ' ' }], { kind: 'hold' }),
  d('zoomWheel', 'Zoom com a roda', 'canvas', [{ key: '', alt: true }], { kind: 'modifier', loose: true }),
  d('nextWorkspace', 'Próximo espaço de trabalho', 'global', [mod('ArrowDown')]),
  d('prevWorkspace', 'Espaço de trabalho anterior', 'global', [mod('ArrowUp')]),
  d('nextNode', 'Próximo elemento', 'global', [key('Tab', { ctrl: true })]),
  d('prevNode', 'Elemento anterior', 'global', [key('Tab', { ctrl: true, shift: true })]),
  d('toggleFocus', 'Alternar foco', 'global', [{ ...back, mod: true }]),
  // Sem atribuição por padrão: o usuário escolhe a combinação nas Configurações.
  d('lift', 'Elevar elemento', 'canvas', []),
  d('nextConnected', 'Próximo elemento conectado', 'global', [{ key: 'ArrowRight', mod: true, alt: true }], { allowAlt: true }),
  d('prevConnected', 'Elemento conectado anterior', 'global', [{ key: 'ArrowLeft', mod: true, alt: true }], { allowAlt: true }),
  // Padrão do palco quando o consumidor existir: Ctrl+Shift+A.
  d('attention', 'Ir para a próxima notificação', 'global', [mod('a', true)]),
  // Padrão do palco quando o consumidor existir: Ctrl+Alt+A.
  d('notifications', 'Mostrar todas as notificações', 'global', [{ key: 'a', mod: true, alt: true }]),
  d('tile', 'Modificador de encaixe magnético', 'canvas', [{ key: '', mod: true }], { kind: 'modifier', loose: true }),
  d('workspaceJump', 'Modificador para pular ao espaço de trabalho', 'global', [{ key: '', mod: true }], { kind: 'modifier', loose: true }),
  d('nodeJump', 'Modificador para pular ao terminal', 'global', [{ key: '', mod: true }], { kind: 'modifier', loose: true }),
  d('chatSwap', 'Alternar entre chat e terminal', 'global', [key('j', { ctrl: true, shift: true })]),
  // O ditado tem uma combinação própria para não conflitar com a duplicação no canvas.
  d('dictate', 'Ditar no chat', 'global', [key('d', { ctrl: true, shift: true })]),
  d('minimap', 'Alternar minimapa', 'global', [mod('m', true)]),
  d('tidy', 'Organizar seleção', 'global', [mod('t', true)]),
  d('zoomSelection', 'Zoom na seleção', 'global', [{ ...back, mod: true, alt: true }], { allowAlt: true }),
  d('zoomIn', 'Aumentar zoom pelo teclado', 'canvas', [{ key: '=', code: 'Equal', mod: true }, { key: '+', code: 'Equal', mod: true, shift: true }]),
  d('zoomOut', 'Diminuir zoom pelo teclado', 'canvas', [{ key: '-', code: 'Minus', mod: true }]),
  d('zoom100', 'Zoom 100% pelo teclado', 'canvas', [{ key: '0', code: 'Digit0', mod: true }]),
  d('left', 'Alinhar à Esquerda', 'canvas', []),
  d('centerHorizontally', 'Centralizar Horizontalmente', 'canvas', []),
  d('right', 'Alinhar à Direita', 'canvas', []),
  d('top', 'Alinhar ao Topo', 'canvas', []),
  d('centerVertically', 'Centralizar Verticalmente', 'canvas', []),
  d('bottom', 'Alinhar Embaixo', 'canvas', []),
  d('distributeHorizontally', 'Distribuir Horizontalmente', 'canvas', []),
  d('distributeVertically', 'Distribuir Verticalmente', 'canvas', [])
] as const
export type ShortcutId = (typeof SHORTCUTS)[number]['id']
export type ShortcutMap = Record<ShortcutId, KeyBinding[]>
export const defaultShortcuts = (): ShortcutMap => Object.fromEntries(SHORTCUTS.map(d => [d.id, structuredClone(d.defaults)])) as ShortcutMap
export function isShortcutId(id: unknown): id is ShortcutId { return typeof id === 'string' && SHORTCUTS.some(d => d.id === id) }
export function validateBinding(raw: unknown, modifier = false): KeyBinding {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('atalho inválido')
  const b = raw as Record<string, unknown>
  if (Object.keys(b).some(k => !['key', 'code', 'mod', 'ctrl', 'meta', 'alt', 'shift'].includes(k)) || typeof b.key !== 'string' || b.key.length > 40 || (!b.key && !modifier)) throw new Error('tecla inválida')
  for (const k of ['mod', 'ctrl', 'meta', 'alt', 'shift']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw new Error('modificador inválido')
  if (!modifier && ['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'Dead', 'Unidentified'].includes(b.key as string)) throw new Error('escolha uma tecla além do modificador')
  if (b.code !== undefined && (typeof b.code !== 'string' || b.code.length > 40)) throw new Error('código inválido')
  if (b.mod && (b.ctrl || b.meta)) throw new Error('modificadores ambíguos')
  if (modifier && !(b.ctrl || b.meta || b.mod || b.shift || b.alt)) throw new Error('escolha um modificador')
  return structuredClone(raw as KeyBinding)
}
/** Hold actions accept either an ordinary key or a standalone modifier, independent of chord conflicts. */
export function validateShortcutBinding(id: ShortcutId, raw: unknown): KeyBinding {
  const def = SHORTCUTS.find(d => d.id === id)!
  const b = raw as Partial<KeyBinding> | null
  return validateBinding(raw, def.kind === 'modifier' || (def.kind === 'hold' && b?.key === ''))
}
export function matchShortcut(id: ShortcutId, e: KeyInput, map: ShortcutMap, policy: { exact?: boolean; ignoreShift?: boolean } = {}): boolean {
  const def = SHORTCUTS.find(d => d.id === id)!
  if (def.reason) return false
  return map[id].some(b => {
    const heldModifier = def.kind === 'hold' && b.key === ''
    if (heldModifier && e.key !== '' && !['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return false
    if (def.kind !== 'modifier' && !heldModifier && (b.code ? e.code !== b.code : e.key.toLowerCase() !== b.key.toLowerCase())) return false
    const loose = def.loose && !policy.exact
    const primary = b.mod ? (e.ctrlKey !== e.metaKey) : true
    if (!primary) return false
    if (!b.mod && (loose ? (b.ctrl && !e.ctrlKey) || (b.meta && !e.metaKey) : e.ctrlKey !== !!b.ctrl || e.metaKey !== !!b.meta)) return false
    if (loose ? (b.alt && !e.altKey) : !def.allowAlt && e.altKey !== !!b.alt) return false
    if (!policy.ignoreShift && (loose ? (b.shift && !e.shiftKey) : e.shiftKey !== !!b.shift)) return false
    return true
  })
}
const identity = (b: KeyBinding): string => `${(b.key || b.code || '').toLowerCase()}|${!!b.mod}|${!!b.ctrl}|${!!b.meta}|${!!b.alt}|${!!b.shift}`
function conflicts(a: KeyBinding, b: KeyBinding): boolean {
  if ((a.code && b.code ? a.code !== b.code : a.key.toLowerCase() !== b.key.toLowerCase())) return false
  return [false, true].some(mac => {
    const actual = (v: KeyBinding) => ({ ...v, key: '', mod: false, ctrl: !!v.ctrl || (!!v.mod && !mac), meta: !!v.meta || (!!v.mod && mac), code: undefined })
    return identity(actual(a)) === identity(actual(b))
  })
}
export function rebindShortcut(map: ShortcutMap, id: ShortcutId, binding: KeyBinding | null): { shortcuts: ShortcutMap; conflicts: ShortcutId[] } {
  const def = SHORTCUTS.find(d => d.id === id)
  if (!def || def.reason) throw new Error('atalho indisponível')
  const b = binding === null ? null : validateShortcutBinding(id, binding)
  const next = structuredClone(map), cleared: ShortcutId[] = []
  if (b) for (const other of SHORTCUTS) {
    if (other.id === id || other.reason || (def.kind === 'hold' && b.key === '') || (def.kind === 'modifier') !== (other.kind === 'modifier')) continue
    const overlap = def.scope === 'global' || other.scope === 'global' || def.scope === other.scope || (['canvas', 'drawing', 'floor'].includes(def.scope) && ['canvas', 'drawing', 'floor'].includes(other.scope))
    if (overlap && next[other.id].some(old => conflicts(old, b))) { next[other.id] = next[other.id].filter(old => !conflicts(old, b)); cleared.push(other.id) }
  }
  next[id] = b ? [b] : []
  return { shortcuts: next, conflicts: cleared }
}
export function bindingFromEvent(e: KeyInput): KeyBinding | null {
  if (['Escape', 'Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'Dead', 'Unidentified'].includes(e.key) || !e.key) return null
  return { key: e.key.length === 1 ? e.key.toLowerCase() : e.key, ...(e.key.length === 1 && !/[\p{L}\p{N}]/u.test(e.key) && e.code ? { code: e.code } : {}), ...((e.ctrlKey || e.metaKey) && !(e.ctrlKey && e.metaKey) ? { mod: true } : {}), ...(e.ctrlKey && e.metaKey ? { ctrl: true, meta: true } : {}), ...(e.altKey ? { alt: true } : {}), ...(e.shiftKey ? { shift: true } : {}) }
}
export function formatBinding(b: KeyBinding, spaceName = 'Espaço'): string { return [b.mod ? 'Ctrl/Cmd' : null, b.ctrl ? 'Ctrl' : null, b.meta ? 'Cmd' : null, b.alt ? 'Alt' : null, b.shift ? 'Shift' : null, b.key === ' ' ? spaceName : b.key].filter(Boolean).join('+') }
