import { isDeepStrictEqual } from 'node:util'
import { readFileSync, renameSync } from 'node:fs'
import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'
import { defaultPreferences, validatePreferences, type Preferences } from '../../shared/preferences'
import { defaultShortcuts, rebindShortcut, isShortcutId, type KeyBinding, type ShortcutId, type ShortcutMap } from '../../shared/shortcuts'

/** Versão 3 e 4 gravam só os atalhos que diferem do padrão; as versões 1 e 2 guardavam o mapa inteiro. */
const VERSION = 4
/** Primeira versão que grava só os atalhos que diferem do padrão (as anteriores guardavam o mapa inteiro). */
const DIFF_SHORTCUTS_SINCE = 3
/** Atalhos que eram reservados (sem padrão, gravados como `[]` nos arquivos da versão 2) e ganharam padrão depois. */
const RESERVED_BEFORE_V3: readonly ShortcutId[] = ['panToggle']

/** Só o que difere do padrão vai para o disco: um atalho que ganhar padrão novo não fica preso a um `[]` antigo. */
function shortcutOverrides(map: ShortcutMap): Partial<ShortcutMap> {
  const defaults = defaultShortcuts(), out: Partial<ShortcutMap> = {}
  for (const id of Object.keys(map) as ShortcutId[]) if (!isDeepStrictEqual(map[id], defaults[id])) out[id] = map[id]
  return out
}

/** Valida campo a campo: o que for inválido é ignorado (padrão no lugar) e listado, o resto do arquivo vale. */
function lenient(raw: Record<string, unknown>, version: number): { value: Preferences; ignored: string[] } {
  let value = defaultPreferences()
  const ignored: string[] = []
  const apply = (patch: Record<string, unknown>, name: string): void => {
    try { value = validatePreferences(patch, value) } catch { ignored.push(name) }
  }
  for (const [key, v] of Object.entries(raw)) {
    if (key !== 'shortcuts') { apply({ [key]: v }, key); continue }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { ignored.push('shortcuts'); continue }
    for (const [id, bindings] of Object.entries(v)) {
      if (version < DIFF_SHORTCUTS_SINCE && Array.isArray(bindings) && bindings.length === 0 && (RESERVED_BEFORE_V3 as readonly string[]).includes(id)) continue
      apply({ shortcuts: { [id]: bindings } }, `shortcuts.${id}`)
    }
  }
  return { value, ignored }
}

function schemaVersionOf(path: string): number {
  try { const v = (JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion?: unknown }).schemaVersion; return typeof v === 'number' ? v : 1 } catch { return 1 }
}

/** Data-only preferences. Unknown future files remain intact and read-only; a corrupt file is restored from the .bak. */
export class PreferencesStore {
  private value = defaultPreferences()
  private readOnly = false
  private listeners = new Set<(p: Preferences) => void>()
  warning?: string
  constructor(private readonly file: string) {
    let envelope: ReturnType<typeof readEnvelope<Record<string, unknown>>>
    let source = file, recovered = false
    try { envelope = readEnvelope<Record<string, unknown>>(file, 'preferences', VERSION) } catch {
      try {
        source = `${file}.bak`
        envelope = readEnvelope<Record<string, unknown>>(source, 'preferences', VERSION)
        if (envelope.readOnly || envelope.payload === null) throw new Error('sem backup utilizável')
        recovered = true
      } catch {
        this.readOnly = true; this.warning = 'Preferências ilegíveis: padrões em uso, arquivo preservado (somente leitura)'
        return
      }
    }
    if (envelope.readOnly) { this.readOnly = true; this.warning = 'Preferências de versão futura: somente leitura'; return }
    if (envelope.payload !== null) {
      if (typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) { this.readOnly = true; this.warning = 'Preferências ilegíveis: padrões em uso, arquivo preservado (somente leitura)'; return }
      const raw = { ...envelope.payload }
      if (typeof raw.darkMode === 'boolean') { raw.appearance ??= raw.darkMode ? 'dark' : 'light'; delete raw.darkMode }
      const { value, ignored } = lenient(raw, schemaVersionOf(source))
      this.value = value
      if (ignored.length) this.warning = `Preferências: campos inválidos ignorados (${ignored.join(', ')})`
    }
    if (recovered) {
      try { renameSync(file, `${file}.corrupt`) } catch { /* o arquivo pode nem existir */ }
      this.warning = `Preferências ilegíveis: restauradas do backup (o arquivo original ficou em ${file}.corrupt)`
    }
  }
  get(): Preferences { return structuredClone(this.value) }
  set(patch: Partial<Preferences>): Preferences {
    if (this.readOnly) throw new Error('preferências somente leitura')
    const next = validatePreferences(patch, this.value)
    if (isDeepStrictEqual(next, this.value)) return this.get()
    writeEnvelopeAtomic(this.file, 'preferences', VERSION, { ...next, shortcuts: shortcutOverrides(next.shortcuts) })
    this.value = next
    for (const cb of this.listeners) cb(this.get())
    return this.get()
  }
  bind(id: ShortcutId, binding: KeyBinding | null): { preferences: Preferences; conflicts: ShortcutId[] } {
    if (!isShortcutId(id)) throw new Error('atalho inválido')
    const result = rebindShortcut(this.value.shortcuts, id, binding)
    return { preferences: this.set({ shortcuts: result.shortcuts }), conflicts: result.conflicts }
  }
  resetShortcuts(): Preferences { return this.set({ shortcuts: defaultShortcuts() }) }
  onChange(cb: (p: Preferences) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
}
