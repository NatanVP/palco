import type { AgentKind } from '../../shared/model'
import { commandShape } from '../../shared/agent-command'

function shQuote(text: string): string {
  return `'${text.replace(/'/g, `'"'"'`)}'`
}

/** Grava o stdin da statusline em ~/.palco/usage/claude/<terminal>.json (0600, troca atômica). */
export const CLAUDE_USAGE_STATUSLINE =
  'umask 077; d="$HOME/.palco/usage/claude"; mkdir -p "$d" && cat > "$d/$PALCO_TERMINAL_ID.$$.tmp" && mv -f "$d/$PALCO_TERMINAL_ID.$$.tmp" "$d/$PALCO_TERMINAL_ID.json"'

/**
 * Variável de ambiente, injetada no PTY, com o role do Codex já como string TOML (JSON é TOML válido).
 * O comando digitado só a referencia: o texto do role não passa pela tela nem pelo histórico do shell.
 */
export const CODEX_ROLE_ENV = 'PALCO_ROLE_TOML'
export const CLAUDE_SETTINGS_ENV = 'PALCO_CLAUDE_SETTINGS_FILE'

export function claudeSettings(palcoBin: string, dynamicCli = false): object {
  const hook = (event: 'claude-stop' | 'claude-busy' | 'claude-ready') => ({ type: 'command', command: `${dynamicCli ? '"$PALCO_CLI"' : shQuote(palcoBin)} hook ${event}` })
  return {
    hooks: {
      SessionStart: [{ hooks: [hook('claude-ready')] }],
      Stop: [{ hooks: [hook('claude-stop')] }],
      PreToolUse: [{ matcher: '*', hooks: [hook('claude-busy')] }],
      UserPromptSubmit: [{ hooks: [hook('claude-busy')] }]
    },
    statusLine: { type: 'command', command: CLAUDE_USAGE_STATUSLINE }
  }
}

/** Teto do role do Codex depois de codificado: cada variável e cada argumento do execve cabem em 128 KiB no Linux. */
export const MAX_CODEX_ROLE_BYTES = 100_000

/** Variáveis que o PTY precisa para o boot com role (só o Codex usa). */
export function agentRoleEnv(agent: AgentKind, role?: { text: string }): Record<string, string> {
  return agent === 'codex' && role ? { [CODEX_ROLE_ENV]: JSON.stringify(role.text) } : {}
}

/** O role cabe na linha de comando do Codex? */
export function codexRoleFits(text: string): boolean {
  return Buffer.byteLength(JSON.stringify(text)) + 'developer_instructions='.length <= MAX_CODEX_ROLE_BYTES
}

export function buildAgentCommand(agent: AgentKind, base: string, palcoBin: string, role?: { file: string; text: string }, dynamicCli=false): string {
  if (agent === 'shell') { if (role) throw new Error('role não se aplica a shell'); return '' }
  // Wrapper de shell (`fish -c "claude --model opus"`): hooks e role vão para dentro do script, depois do agente.
  if (agent === 'claude' || agent === 'codex') {
    const shape = commandShape(base)
    if (shape.wrapper) {
      // Só o script é trocado; prefixo e argumentos ficam como foram digitados.
      const { script, scriptStart, scriptEnd } = shape.wrapper
      return base.slice(0, scriptStart) + shQuote(buildAgentCommand(agent, script, palcoBin, role,dynamicCli)) + base.slice(scriptEnd)
    }
  }
  // Agente genérico: o comando vai como está, sem hooks nem settings (não há como injetar o role).
  if (agent === 'other' || agent === 'antigravity') { if (role) throw new Error('role não se aplica a agente other'); return base }
  if (agent === 'codex') {
    // O acesso ao socket Unix permite a comunicação com o palco; um modo de sandbox explícito no comando é preservado.
    const hasSandbox = /(^|\s)(-s|--sandbox(=\S+)?|--dangerously-bypass-approvals-and-sandbox)(\s|$)/.test(base)
    const sandbox = hasSandbox ? '' : ' -s danger-full-access'
    return `${base}${sandbox}${role ? ` -c "developer_instructions=$${CODEX_ROLE_ENV}"` : ''} -c ${shQuote(`notify=${JSON.stringify(dynamicCli?['/bin/sh','-c','exec "$PALCO_CLI" hook codex-notify "$@"','palco-hook']:[palcoBin, 'hook', 'codex-notify'])}`)}`
  }
  return `${base}${role ? ` --append-system-prompt-file ${shQuote(role.file)}` : ''} --settings "$${CLAUDE_SETTINGS_ENV}"`
}
