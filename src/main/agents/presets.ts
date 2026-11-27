import type { AgentKind, Preset } from '../../shared/model'
import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'
import { normalizeAgentCommand } from '../domain/command'
import { agentForCommand, firstLine } from '../../shared/agent-command'
import { validateAppearance } from '../../shared/appearance'
import { AgentConfigError, configName, RoleStore } from './roles'
const AGENTS = ['claude', 'codex', 'antigravity', 'shell', 'other']
export { BUILTIN_PRESETS, MAX_ACTIVE_PRESETS } from '../../shared/presets'
import { MAX_ACTIVE_PRESETS, BUILTIN_PRESETS } from '../../shared/presets'

/** Entrada válida de preset (o comando passa pelas regras atuais), ou `undefined`. */
function validPreset(p: unknown): Preset | undefined {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined
  const v = p as Record<string, unknown>
  if (typeof v.name !== 'string' || !v.name.trim() || typeof v.agent !== 'string' || !AGENTS.includes(v.agent) || typeof v.command !== 'string'
    || (v.role !== undefined && (typeof v.role !== 'string' || !v.role.trim() || v.agent === 'shell'))
    || (v.account !== undefined && (typeof v.account !== 'string' || !v.account.trim()))
    || (v.maestro !== undefined && typeof v.maestro !== 'boolean') || (v.quickStart !== undefined && typeof v.quickStart !== 'boolean') || (v.startInChat !== undefined && typeof v.startInChat !== 'boolean')) return undefined
  let appearance: ReturnType<typeof validateAppearance> | undefined
  try { appearance = v.appearance === undefined ? undefined : validateAppearance(v.appearance) } catch { return undefined }
  try { normalizeAgentCommand(v.agent as AgentKind, v.command) } catch { return undefined }
  return {
    name: v.name, agent: v.agent as AgentKind, command: v.command, ...(v.role === undefined ? {} : { role: v.role as string }),
    ...(v.account === undefined ? {} : { account: v.account as string }),
    ...(v.maestro === undefined ? {} : { maestro: v.maestro as boolean }),
    ...(v.quickStart === undefined ? {} : { quickStart: v.quickStart as boolean }),
    ...(v.startInChat === undefined ? {} : { startInChat: v.startInChat as boolean }),
    ...(appearance && Object.keys(appearance).length ? { appearance } : {})
  }
}

/**
 * Presets em `presets.json`. Nunca derruba o boot: arquivo ilegível abre vazio e somente
 * leitura (o original fica intacto); entradas inválidas são ignoradas com aviso e
 * regravadas como estavam quando o arquivo for salvo.
 */
export class PresetStore {
  private entries: Preset[] = []
  private readOnly = false
  /** Entradas que não passaram na validação, mantidas para não se perderem ao salvar. */
  private dropped: unknown[] = []
  private notice?: string
  get warning(): string | undefined { return this.notice }
  constructor(private readonly file: string, private readonly roles: RoleStore) {
    let envelope: { payload: unknown; readOnly: boolean }
    try {
      envelope = readEnvelope<unknown>(file, 'presets', 1)
    } catch {
      this.readOnly = true
      this.notice = 'presets.json ilegível: presets desativados (somente leitura; o arquivo não foi alterado)'
      return
    }
    this.readOnly = envelope.readOnly
    if (envelope.readOnly) this.notice = 'presets.json de versão futura: somente leitura'
    if (envelope.payload === null) return
    if (!Array.isArray(envelope.payload)) {
      this.readOnly = true
      this.notice = 'presets.json inválido: presets desativados (somente leitura; o arquivo não foi alterado)'
      return
    }
    for (const raw of envelope.payload) {
      const preset = validPreset(raw)
      if (preset && !this.entries.some(p => p.name.toLowerCase() === preset.name.toLowerCase())) this.entries.push(preset)
      else this.dropped.push(raw)
    }
    if (this.dropped.length) {
      const n = this.dropped.length
      this.notice = [this.notice, `${n} preset${n > 1 ? 's' : ''} inválido${n > 1 ? 's' : ''} ignorado${n > 1 ? 's' : ''} em presets.json`].filter(Boolean).join('; ')
    }
  }
  list(): Preset[] { return structuredClone(this.entries) }
  get(name: string): Preset {
    const preset = this.entries.find(p => p.name.toLowerCase() === configName(name).toLowerCase())
    if (!preset) throw new AgentConfigError(404, 'preset não encontrado')
    return structuredClone(preset)
  }
  /** Sem `agent`, o agente sai do comando (claude, codex, vazio = shell, outro = genérico). */
  create(input: Omit<Preset, 'agent'> & { agent?: AgentKind }): Preset {
    const name = configName(input.name)
    if (this.entries.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new AgentConfigError(409, 'preset já existe')
    const preset = this.normalized({ ...input, name, agent: input.agent ?? agentForCommand(input.command) })
    // Mantém o início rápido dentro do limite: presets adicionais entram inativos.
    if (preset.quickStart !== false && this.activeCount() >= MAX_ACTIVE_PRESETS) preset.quickStart = false
    this.save([...this.entries, preset])
    return structuredClone(preset)
  }
  /** Muda só o que veio; trocar o comando recalcula o agente. */
  set(name: string, patch: { newName?: string; command?: string; account?: string | null; maestro?: boolean; quickStart?: boolean; startInChat?: boolean; appearance?: Preset['appearance'] }): Preset {
    const current = this.get(name)
    const newName = patch.newName === undefined ? current.name : configName(patch.newName)
    if (newName.toLowerCase() !== current.name.toLowerCase() && this.entries.some(p => p.name.toLowerCase() === newName.toLowerCase())) throw new AgentConfigError(409, 'preset já existe')
    const { account: _a, ...rest } = current
    const account = patch.account === undefined ? current.account : (patch.account ?? undefined)
    const next = this.normalized({
      ...rest, name: newName,
      ...(patch.command === undefined ? {} : { command: patch.command, agent: agentForCommand(patch.command) }),
      ...(account === undefined ? {} : { account }),
      ...(patch.maestro === undefined ? {} : { maestro: patch.maestro }),
      ...(patch.quickStart === undefined ? {} : { quickStart: patch.quickStart }),
      ...(patch.startInChat === undefined ? {} : { startInChat: patch.startInChat }),
      ...(patch.appearance === undefined ? {} : { appearance: patch.appearance })
    })
    if (next.appearance && Object.keys(next.appearance).length === 0) delete next.appearance
    if (next.role !== undefined && next.agent !== 'claude' && next.agent !== 'codex') delete next.role
    if (patch.quickStart === true && current.quickStart === false && this.activeCount() >= MAX_ACTIVE_PRESETS) throw new AgentConfigError(409, `no máximo ${MAX_ACTIVE_PRESETS} presets ativos`)
    this.save(this.entries.map(p => (p.name === current.name ? next : p)))
    return structuredClone(next)
  }
  /** GUI role deletion unassigns future launches as well as existing terminals. */
  clearRole(name: string): void {
    const canonical = this.roles.canonical(name)
    if (!this.entries.some(p => p.role && this.roles.canonical(p.role) === canonical)) return
    this.save(this.entries.map(p => { if (!p.role || this.roles.canonical(p.role) !== canonical) return p; const { role: _role, ...rest } = p; return rest }))
  }
  private normalized(input: Preset): Preset {
    if (!AGENTS.includes(input.agent)) throw new AgentConfigError(400, 'agente inválido')
    if (input.role && input.agent === 'shell') throw new AgentConfigError(400, 'role não se aplica a shell')
    const role = input.role === undefined ? undefined : this.roles.get(input.role).name
    let command: string
    try { command = normalizeAgentCommand(input.agent, firstLine(input.command)) } catch (e) { throw new AgentConfigError(400, `command inválido: ${(e as Error).message}`) }
    return {
      name: input.name, agent: input.agent, command, ...(role === undefined ? {} : { role }),
      ...(input.account === undefined ? {} : { account: input.account }),
      ...(input.maestro === undefined ? {} : { maestro: input.maestro }),
      ...(input.quickStart === undefined ? {} : { quickStart: input.quickStart }),
      ...(input.startInChat === undefined ? {} : { startInChat: input.startInChat }),
      ...(input.appearance === undefined || Object.keys(validateAppearance(input.appearance)).length === 0 ? {} : { appearance: validateAppearance(input.appearance) })
    }
  }
  private activeCount(): number { return this.entries.filter(p => p.quickStart !== false).length }
  /** Nova ordem (a do Novo Terminal): precisa citar exatamente os presets que existem, cada um uma vez. */
  reorder(names: string[]): void {
    const byName = new Map(this.entries.map(p => [p.name.toLowerCase(), p]))
    const wanted = names.map(n => n.toLowerCase())
    if (wanted.length !== byName.size || new Set(wanted).size !== wanted.length || wanted.some(n => !byName.has(n))) throw new AgentConfigError(400, 'a ordem precisa citar cada preset uma vez')
    this.save(wanted.map(n => byName.get(n)!))
  }
  /** "Redefinir para Padrão": a lista volta a ser só a dos embutidos (os personalizados saem). */
  resetDefaults(): void { this.save(BUILTIN_PRESETS.map(b => this.normalized({ ...b }))) }
  /** Embutidos que não existem na lista (pelo nome). */
  missingDefaults(): Preset[] { return BUILTIN_PRESETS.filter(b => !this.entries.some(p => p.name.toLowerCase() === b.name.toLowerCase())).map(b => ({ ...b })) }
  /** Recoloca os embutidos que faltam, na frente da lista; os que já existem ficam como estão. */
  restoreDefaults(): void {
    const missing = this.missingDefaults()
    if (missing.length) this.save([...missing.map(m => this.normalized(m)), ...this.entries])
  }
  remove(name: string): void { const p = this.get(name); this.save(this.entries.filter(item => item.name !== p.name)) }
  private save(entries: Preset[]): void {
    if (this.readOnly) throw new AgentConfigError(409, 'presets somente leitura')
    writeEnvelopeAtomic(this.file, 'presets', 1, [...entries, ...this.dropped])
    this.entries = entries
  }
}
export class AgentCatalog {
  constructor(readonly presets: PresetStore, readonly roles: RoleStore) {}
  recruit(body: Record<string, unknown>): { agent: AgentKind; command: string; role?: string; account?: string; maestro?: boolean; look?: NonNullable<Preset['appearance']> } {
    const preset = body.preset === undefined ? undefined : this.presets.get(configName(body.preset))
    if (preset && ['agent', 'command'].some(k => body[k] !== undefined)) throw new AgentConfigError(400, 'preset não pode ser combinado com agent ou command')
    // Sem preset nem --agent, o agente sai do programa que a linha do --command inicia.
    const agent = preset?.agent ?? body.agent ?? (typeof body.command === 'string' && body.command.trim() !== '' ? agentForCommand(body.command) : 'claude')
    if (typeof agent !== 'string' || !['claude', 'codex', 'antigravity', 'shell', 'other'].includes(agent)) throw new AgentConfigError(400, 'agente inválido')
    // `--role` vence o role do preset (skill: `--preset "Codex" --role "Escritor de Testes"`).
    const role = body.role ?? preset?.role
    if (role !== undefined && agent === 'shell') throw new AgentConfigError(400, 'role não se aplica a shell')
    const resolved = role === undefined ? undefined : this.roles.get(configName(role)).name
    let command: string
    try { command = normalizeAgentCommand(agent as AgentKind, preset?.command ?? (typeof body.command === 'string' ? body.command : '')) } catch (e) { throw new AgentConfigError(400, `command inválido: ${(e as Error).message}`) }
    return {
      agent: agent as AgentKind, command, ...(resolved === undefined ? {} : { role: resolved }),
      ...(preset?.account === undefined ? {} : { account: preset.account }),
      ...(preset?.maestro ? { maestro: true } : {}),
      // A aparência salva no preset vale no terminal recrutado (ícone, cor, tema e fontes).
      ...(preset?.appearance ? { look: { ...preset.appearance } } : {})
    }
  }
}
