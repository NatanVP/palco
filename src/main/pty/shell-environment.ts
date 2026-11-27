import { dirname } from 'node:path'

/**
 * Variáveis de SESSÃO de outro Claude/Codex/palco, que não podem vazar para os agentes deste canvas.
 * Lista explícita: perfil e configuração duráveis (CODEX_HOME, CLAUDE_CONFIG_DIR, CLAUDE_CODE_USE_*) são preservados.
 */
const SESSION_VARS = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SSE_PORT',
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_THREAD_ID',
  'CODEX_CI'
])

export function stripInherited(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SESSION_VARS.has(k) && !k.startsWith('PALCO_')))
}

/** Ambiente local sem identidade herdada de outro terminal ou conta selecionada. */
export function localShellEnvironment(inherited: NodeJS.ProcessEnv, overrides?: NodeJS.ProcessEnv): Record<string, string> {
  const env = Object.fromEntries(Object.entries({ ...stripInherited(inherited), ...overrides }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.CLAUDE_CONFIG_DIR; delete env.CODEX_HOME
  return env
}

export function addCliToEnvironment(env: Record<string, string>, palcoBin: string): void {
  env.PALCO_CLI = palcoBin
  env.PATH = [dirname(palcoBin), env.PATH].filter(Boolean).join(':')
}
