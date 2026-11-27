import { getPreferences } from '../settings/preferences'
import { validateEnvironment, type Environment } from '../../../shared/environment'
import { presetIcon } from '../../../shared/presets'
import type { AgentKind, FloorId, NewNode, Preset, Size, Vec } from '../../../shared/model'

/** Atalhos do "Início rápido", na ordem do palco. */
export type QuickStartId = 'claude' | 'codex' | 'agy' | 'opencode' | 'shell'

export const QUICK_START: ReadonlyArray<{ id: QuickStartId; name: string; command: string; icon: string }> = [
  { id: 'claude', name: 'Claude Code', command: 'claude', icon: 'badge-check' },
  { id: 'codex', name: 'Codex', command: 'codex', icon: 'brain' },
  { id: 'agy', name: 'Antigravity', command: 'agy', icon: 'sparkle' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', icon: 'rectangle-vertical' },
  { id: 'shell', name: 'Shell', command: '', icon: 'terminal' }
]

/** Um atalho do início rápido: os fixos e os presets do usuário (com `quickStart` ligado). */
export interface QuickTile { id: string; name: string; command: string; icon: string; preset?: Preset }


/**
 * Atalhos do início rápido: os embutidos que ainda não foram gravados (na ordem do palco) e depois os presets, na ordem da lista
 * das Configurações. Um preset com o nome de um embutido toma o lugar dele; `quickStart: false` esconde o preset.
 */
export function quickStartTiles(presets: readonly Preset[]): QuickTile[] {
  const stored = new Set(presets.map((p) => p.name.toLowerCase()))
  const tile = (p: Preset): QuickTile => ({ id: `preset:${p.name}`, name: p.name, command: p.command, icon: presetIcon(p), preset: p })
  const out: QuickTile[] = QUICK_START.filter((q) => !stored.has(q.name.toLowerCase())).map((q) => ({ ...q }))
  for (const p of presets) if (p.quickStart !== false) out.push(tile(p))
  return out
}

/** O que um atalho preenche; num preset também Maestro, role e conta (pelo nome, entre as contas do agente). */
export function quickTileForm(t: QuickTile, accounts: ReadonlyArray<{ id: string; name: string; agent: string }>): Partial<NewTerminalForm> {
  const p = t.preset, look = p?.appearance
  // A aparência é sempre reposta: escolher outro atalho não pode herdar a cor ou o tema do anterior.
  const base: Partial<NewTerminalForm> = {
    agent: p?.agent ?? agentForCommand(t.command), name: t.name, command: t.command, monitor: t.command !== '', icon: look?.icon ?? t.icon, color: look?.color ?? DEFAULT_COLOR, fontSize: look?.fontSize ?? getPreferences().terminalFontSize,
    themeId: look?.themeId, darkThemeId: look?.darkThemeId, fontFamily: look?.fontFamily, chatFontFamily: look?.chatFontFamily, chatFontSize: look?.chatFontSize
  }
  if (!p) return { ...base, accountId: null, ...(t.command === '' || !['claude', 'codex'].includes(agentForCommand(t.command)) ? { role: null } : {}) }
  const account = p.account === undefined ? undefined : accounts.find((a) => a.agent === p.agent && a.name.toLowerCase() === p.account!.toLowerCase())
  return { ...base, maestro: p.maestro === true, role: p.role ?? null, accountId: account?.id ?? null, startInChat: p.startInChat === true }
}

/** Paleta de cores em bolinhas (padrão: azul). */
export const COLORS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#007AFF', name: 'Azul' }, { hex: '#FF3B30', name: 'Vermelho' }, { hex: '#34C759', name: 'Verde' },
  { hex: '#FF9500', name: 'Laranja' }, { hex: '#AF52DE', name: 'Roxo' }, { hex: '#FF2D55', name: 'Rosa' },
  { hex: '#5AC8FA', name: 'Ciano' }, { hex: '#FFCC00', name: 'Amarelo' }
]
export const DEFAULT_COLOR = '#007AFF'
export const DEFAULT_FONT_SIZE = 13
export const DEFAULT_ICON = 'terminal'
export const MAX_NAME = 120

export interface NewTerminalForm {
  agent: AgentKind | 'auto'
  agentWarning?: string
  name: string
  command: string
  cwd: string
  monitor: boolean
  maestro: boolean
  color: string
  icon: string
  fontSize: number
  role: string | null
  accountId: string | null
  /** Preset com 'Iniciar no Modo de Chat': o terminal nasce na face de chat (só agente). */
  startInChat?: boolean
  /** Aparência vinda do preset (vazio = herda das Configurações). */
  themeId?: string; darkThemeId?: string; fontFamily?: string; chatFontFamily?: string; chatFontSize?: number
  /** Onde roda (ausente = local). */
  environment?: Environment
}

export function emptyForm(): NewTerminalForm {
  return { agent: 'auto', name: '', command: '', cwd: '', monitor: false, maestro: false, color: DEFAULT_COLOR, icon: DEFAULT_ICON, fontSize: getPreferences().terminalFontSize, role: null, accountId: null }
}

/** O que um atalho do início rápido preenche: nome, comando e o monitoramento (ligado quando há comando). */
export function quickStart(id: QuickStartId): Pick<NewTerminalForm, 'name' | 'command' | 'monitor'> {
  const q = QUICK_START.find((x) => x.id === id)!
  return { name: q.name, command: q.command, monitor: q.command !== '' }
}

/** Só a primeira linha não vazia do comando, sem espaços nas pontas. */
// A regra fica em src/shared para o main (Editar terminal) usar a mesma.
import { agentForCommand, commandLineError, firstLine } from '../../../shared/agent-command'
import { localizeMessage } from '../../../shared/i18n/messages'
import { getLocale } from '../i18n'
import { t } from '../i18n'
export { agentForCommand, firstLine }

/** Nome vazio vira "Terminal"; repetido (sem diferenciar maiúsculas) ganha " 2", " 3"… */
export function uniqueTerminalName(wanted: string, existing: readonly string[]): string {
  const base = (wanted.trim() || t('dialogs.new-terminal.terminal')).slice(0, MAX_NAME)
  const taken = new Set(existing.map((n) => n.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`
    const name = base.slice(0, MAX_NAME - suffix.length) + suffix
    if (!taken.has(name.toLowerCase())) return name
  }
}

/** O nó a criar a partir do formulário, no frame desenhado (ou no padrão centrado, decidido por quem chama). */
export function toNewNode(form: NewTerminalForm, frame: { pos: Vec; size: Size }, floorId: FloorId, existingNames: readonly string[]): NewNode {
  const command = firstLine(form.command)
  const agent = form.agent === 'auto' ? agentForCommand(command) : form.agent
  return {
    kind: 'terminal', floorId, name: uniqueTerminalName(form.name, existingNames), agent, command, cwd: form.cwd.trim(),
    // O tamanho padrão não fica no nó: assim ele acompanha a preferência.
    color: form.color, icon: form.icon, ...(form.fontSize !== getPreferences().terminalFontSize && { fontSize: form.fontSize }), monitor: form.monitor, maestro: form.maestro,
    ...(form.role !== null && (agent === 'claude' || agent === 'codex') ? { role: form.role } : {}),
    ...(form.accountId !== null ? { accountId: form.accountId } : {}),
    ...(form.startInChat && agent !== 'shell' ? { chatMode: true } : {}),
    ...(form.themeId !== undefined ? { themeId: form.themeId } : {}), ...(form.darkThemeId !== undefined ? { darkThemeId: form.darkThemeId } : {}),
    ...(form.fontFamily !== undefined ? { fontFamily: form.fontFamily } : {}), ...(form.chatFontFamily !== undefined ? { chatFontFamily: form.chatFontFamily } : {}), ...(form.chatFontSize !== undefined ? { chatFontSize: form.chatFontSize } : {}),
    ...(form.environment && form.environment.kind !== 'local' ? { environment: validateEnvironment(form.environment) } : {}),
    pos: { ...frame.pos }, size: { ...frame.size }
  }
}

/** Mesma regra do main (`normalizeAgentCommand`): uma linha que inicia um programa só; flags e variáveis valem. */
export function commandError(command: string): string | null {
  const line = firstLine(command)
  if (line === '') return null
  const raw = commandLineError(line), why = raw === null ? null : localizeMessage(raw, getLocale())
  return why === null ? null : t('dialogs.new-terminal.v1_v2_ex_claude_model_opus', { v1: why[0]!.toUpperCase(), v2: why.slice(1) })
}

/**
 * Trava do "Criar": uma operação por vez (adquirida antes do primeiro `await`, então dois cliques
 * rápidos não criam dois terminais) e cancelável ao fechar o diálogo, para que uma continuação
 * pendente (exists, mkdir) não crie nada depois do Cancelar.
 */
export class SubmitGuard {
  private generation = 0
  private current: number | null = null

  get running(): boolean { return this.current !== null }

  begin(): { alive(): boolean; end(): void } | null {
    if (this.current !== null) return null
    const mine = ++this.generation
    this.current = mine
    return {
      alive: () => this.current === mine,
      end: () => { if (this.current === mine) this.current = null }
    }
  }

  cancel(): void {
    this.current = null
    this.generation++
  }
}
