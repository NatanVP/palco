import { defaultShortcuts, isShortcutId, SHORTCUTS, validateShortcutBinding, type ShortcutMap } from './shortcuts'
import { VOICE_LANGUAGES, VOICE_MODELS } from './voice'

/**
 * Esquema único das preferências: cada campo traz o padrão e o validador. O tipo `Preferences` sai daqui, então um campo novo
 * é uma linha só. A aparência acompanha o sistema; o cursor padrão e a fonte Cascadia Mono
 * mantêm a apresentação inicial consistente entre terminais.
 */
interface Field<T> { default: T; check(v: unknown): T }
const fail = (msg: string): never => { throw new Error(msg) }
const oneOf = <T extends string | number>(values: readonly T[], msg: string, def: T): Field<T> =>
  ({ default: def, check: v => ((values as readonly unknown[]).includes(v) ? (v as T) : fail(msg)) })
const bool = (def: boolean, msg = 'opção inválida'): Field<boolean> => ({ default: def, check: v => (typeof v === 'boolean' ? v : fail(msg)) })
const int = (min: number, max: number, def: number, msg: string, step = 1): Field<number> =>
  ({ default: def, check: v => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max && (v as number) % step === 0 ? (v as number) : fail(msg)) })
const nullable = <T>(f: Field<T>): Field<T | null> => ({ default: null, check: v => (v === null ? null : f.check(v)) })
const FONT_BAD = /[;{}<>\n]/
const font = (def: string, msg: string, allowEmpty = false): Field<string> =>
  ({ default: def, check: v => (typeof v === 'string' && (allowEmpty || v.trim()) && v.length <= 200 && !FONT_BAD.test(v) ? v : fail(msg)) })
const text = (def: string, max: number, msg: string): Field<string> =>
  ({ default: def, check: v => (typeof v === 'string' && v.trim() && v.length <= max && !/[\n\0]/.test(v) ? v : fail(msg)) })
const size = (w: number, h: number, msg: string): Field<{ width: number; height: number }> => ({
  default: { width: w, height: h },
  check: v => {
    const o = v as Record<string, unknown> | null
    const ok = !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === 'height,width'
      && [o.width, o.height].every(n => Number.isInteger(n) && (n as number) >= 100 && (n as number) <= 4000)
    return ok ? { width: o.width as number, height: o.height as number } : fail(msg)
  }
})
export const LANGUAGES = ['de', 'en', 'es', 'fr', 'ja', 'pt-BR', 'zh-Hans'] as const
export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white', 'charcoal', 'slate', 'midnight'] as const
const themeId = /^[a-z0-9-]{1,64}$/
const SCHEMA = {
  // Geral › Sistema
  appLanguage: nullable(oneOf(LANGUAGES, 'idioma inválido', 'pt-BR')),
  appearance: oneOf(['system', 'light', 'dark'] as const, 'aparência inválida', 'system'),
  pointerCursors: bool(false),
  sleepPrevention: oneOf(['never', 'whileAgentsWork', 'whileAppIsOpen'] as const, 'política de suspensão inválida', 'whileAgentsWork'),
  confirmBeforeQuitting: bool(false),
  // Ditado local (Geral › Sistema)
  voiceModel: oneOf(VOICE_MODELS, 'modelo de ditado inválido', 'base'),
  voiceLanguage: oneOf(VOICE_LANGUAGES, 'idioma de ditado inválido', 'app'),
  resumeSessionsOnRelaunch: bool(true),
  closeToTray: bool(false),
  // Geral › Tela
  canvasBackground: oneOf(['grid', 'plain', 'transparent'] as const, 'fundo inválido', 'grid'),
  windowOpacity: oneOf([100, 95, 90, 85, 80, 70, 60] as const, 'opacidade inválida', 100),
  ropeRouting: oneOf(['avoidNodes', 'behindNodes', 'circuit'] as const, 'estilo de corda inválido', 'avoidNodes'),
  selectionIndicatorStyle: oneOf(['dashedBorder', 'solidBorder', 'corners', 'cornerDots', 'elevation'] as const, 'indicador de seleção inválido', 'dashedBorder'),
  cameraMovement: oneOf(['glide', 'instant'] as const, 'movimento de câmera inválido', 'glide'),
  focusNodeOnHover: bool(false),
  rightDragPansCanvas: bool(false),
  confirmFileDelete: bool(true),
  zoomStepPercent: nullable(int(2, 50, 10, 'passo de zoom inválido (2–50)')),
  alwaysCopyAttachments: bool(false),
  // Geral › Tela › Padrões de Novos Itens
  defaultNoteColor: oneOf(NOTE_COLORS, 'cor de nota inválida', 'yellow'),
  defaultNoteRender: oneOf(['markdown', 'raw'] as const, 'modo de nota inválido', 'markdown'),
  defaultNoteSize: size(260, 160, 'tamanho de nota inválido'),
  agentNotePlacement: oneOf(['stack', 'freeSpace'] as const, 'posicionamento inválido', 'stack'),
  defaultNoteFontFamily: nullable(font('', 'família de fonte inválida')),
  defaultNoteFontSize: int(8, 64, 14, 'tamanho de fonte inválido (8–64)'),
  defaultTerminalSize: size(800, 500, 'tamanho de terminal inválido'),
  defaultPortalSize: size(800, 600, 'tamanho de portal inválido'),
  // Menu do portal › Mostrar Tamanho (largura × altura sobre a página).
  portalSizeReadout: oneOf(['onResize', 'always', 'never'] as const, 'leitura de tamanho inválida', 'onResize'),
  agentPortalPlacement: oneOf(['stack', 'freeSpace'] as const, 'posicionamento inválido', 'stack'),
  fileEditorFontFamily: font("Cascadia Mono, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace", 'família de fonte inválida'),
  fileEditorFontSize: int(8, 32, 13, 'tamanho de fonte inválido (8–32)'),
  fileEditorTabWidth: oneOf([2, 4, 8] as const, 'tabulação inválida', 4),
  fileEditorRendersMarkdown: bool(true),
  // Geral › Notificações
  completionBadges: oneOf(['all', 'maestros'] as const, 'selos inválidos', 'all'),
  showAppIconBadge: bool(true),
  flashTaskbarOnAttention: bool(false),
  notifyOnTurnComplete: bool(false),
  notifyOnAttention: bool(true),
  notifyOnFloorStatus: bool(true),
  notifyOnPullRequests: bool(true),
  // Geral › Ambientes
  wslEnabled: bool(true),
  sshEnabled: bool(false),
  sshScriptPath: text('~/.palco/bin/palco', 1024, 'caminho do script inválido'),
  sshAddToPath: bool(true),
  dockerEnabled: bool(false),
  sandboxEnabled: bool(false),
  localTmuxEnabled: bool(false),
  tunnelPort: int(1024, 65535, 7433, 'porta inválida (1024–65535)'),
  // Terminal
  defaultTerminalTheme: { default: 'system', check: v => (typeof v === 'string' && themeId.test(v) ? v : fail('tema inválido')) } as Field<string>,
  defaultTerminalDarkThemeId: nullable({ default: '', check: v => (typeof v === 'string' && themeId.test(v) ? v : fail('tema escuro inválido')) } as Field<string>),
  terminalFontFamily: font("Cascadia Mono, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace", 'família de fonte inválida'),
  terminalFontSize: int(8, 32, 13, 'fonte inválida (8–32)'),
  terminalPaddingHorizontal: int(0, 40, 0, 'espaçamento inválido (0–40, passo 2)', 2),
  terminalPaddingVertical: int(0, 40, 0, 'espaçamento inválido (0–40, passo 2)', 2),
  usesSystemHorizontalTerminalPadding: bool(true),
  chatFontFamily: font('', 'família de fonte inválida', true),
  chatFontSize: int(8, 32, 13, 'tamanho de fonte de chat inválido (8–32)'),
  promptComposerFontSize: nullable(int(10, 28, 13, 'tamanho do compositor inválido (10–28)')),
  terminalScrollback: int(100, 100000, 5000, 'scrollback inválido'),
  terminalCursorBlink: bool(true),
  copyOnSelect: bool(false),
  memoryLimitEnabled: bool(false),
  memoryLimitMB: int(256, 65536, 2048, 'limite de memória inválido (256–65536 MB)'),
  preferredShellPath: nullable(text('', 1024, 'shell inválido')),
  // Agentes
  usageEnabled: bool(true),
  computerUseEnabled: bool(false),
  computerUseBypassPermissions: bool(false),
  // Dados
  defaultPortalStorage: oneOf(['isolated', 'workspace', 'global'] as const, 'armazenamento inválido', 'isolated')
} satisfies Record<string, Field<unknown>>
type Schema = typeof SCHEMA
export type Preferences = { [K in keyof Schema]: ReturnType<Schema[K]['check']> } & { shortcuts: ShortcutMap }
/** Chaves de preferência (sem os atalhos, que têm rota própria). */
export type PreferenceKey = keyof Schema
export const PREFERENCE_KEYS = Object.keys(SCHEMA) as PreferenceKey[]
export const defaultPreferences = (): Preferences => ({
  ...(Object.fromEntries(Object.entries(SCHEMA).map(([k, f]) => [k, structuredClone((f as Field<unknown>).default)])) as { [K in keyof Schema]: ReturnType<Schema[K]['check']> }),
  shortcuts: defaultShortcuts()
})
/** Strict patches from IPC; persisted data is migrated separately. */
export function validatePreferences(raw: unknown, base = defaultPreferences()): Preferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('preferências inválidas')
  const patch = raw as Record<string, unknown>, result = structuredClone(base) as Preferences & Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'shortcuts') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('atalhos inválidos')
      const map = structuredClone(result.shortcuts)
      for (const [id, bindings] of Object.entries(value)) {
        if (!isShortcutId(id) || !Array.isArray(bindings) || bindings.length > 4) throw new Error('atalho inválido')
        const def = SHORTCUTS.find(d => d.id === id)!
        if (def.reason && bindings.length) throw new Error('atalho indisponível')
        map[id] = bindings.map(b => validateShortcutBinding(id, b))
      }
      result.shortcuts = map; continue
    }
    if (!Object.hasOwn(SCHEMA, key)) throw new Error(`preferência desconhecida: ${key}`)
    result[key] = (SCHEMA[key as PreferenceKey] as Field<unknown>).check(value)
  }
  // Mexer no espaçamento horizontal desliga a herança do sistema (a menos que o patch diga o contrário).
  if (Object.hasOwn(patch, 'terminalPaddingHorizontal') && !Object.hasOwn(patch, 'usesSystemHorizontalTerminalPadding')) result.usesSystemHorizontalTerminalPadding = false
  return result
}
