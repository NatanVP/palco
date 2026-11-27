import type { AgentKind, Preset } from './model'

/** No máximo 10 presets ativos aparecem no Novo Terminal. */
export const MAX_ACTIVE_PRESETS = 10
/** Os atalhos que o Novo Terminal já traz (Claude Code, Codex, Antigravity, OpenCode, Shell); "Redefinir para Padrão" volta a eles. */
export const BUILTIN_PRESETS: ReadonlyArray<Preset> = [
  { name: 'Claude Code', agent: 'claude', command: 'claude', quickStart: true },
  { name: 'Codex', agent: 'codex', command: 'codex', quickStart: true },
  { name: 'Antigravity', agent: 'antigravity', command: 'agy', quickStart: true },
  { name: 'OpenCode', agent: 'other', command: 'opencode', quickStart: true },
  { name: 'Shell', agent: 'shell', command: '', quickStart: true }
]
const BUILTIN_ICONS: Record<string, string> = { 'claude code': 'badge-check', codex: 'brain', antigravity: 'sparkle', opencode: 'rectangle-vertical', shell: 'terminal' }
const AGENT_ICONS: Record<AgentKind, string> = { antigravity:'sparkle', claude: 'badge-check', codex: 'brain', shell: 'terminal', other: 'terminal' }
/** O ícone de um preset: o escolhido nele; senão o do embutido (pelo nome) ou o do agente. Os desenhos são os do palco. */
export function presetIcon(p: Pick<Preset, 'name' | 'agent'> & Partial<Pick<Preset, 'appearance'>>): string {
  return p.appearance?.icon ?? BUILTIN_ICONS[p.name.toLowerCase()] ?? AGENT_ICONS[p.agent]
}
