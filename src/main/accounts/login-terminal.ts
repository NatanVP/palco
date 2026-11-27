import type { Account, FloorId, NewNode } from '../../shared/model'
import type { ProviderSpec } from '../../shared/providers'
import { shQuote } from '../../shared/agent-command'

/**
 * O terminal do "Entrar": a CLI faz o login nele, com a pasta da conta. É um terminal `other` porque o palco roda a linha como está;
 * num terminal `shell` o comando é descartado e abriria só o prompt.
 */
export function loginTerminal(account: Account, provider: ProviderSpec, at: { cwd: string; floorId: FloorId | null; name: string }): Extract<NewNode, { kind: 'terminal' }> {
  const isolation = provider.agent==='antigravity' ? `-u JETSKI_OAUTH_TOKEN -u AGY_ADC_AUTH -u GEMINI_API_KEY ${shQuote(`XDG_CONFIG_HOME=${account.configDir}/.config`)} ` : ''
  const command = `env ${isolation}${shQuote(`${provider.configEnv}=${account.configDir}`)} ${[provider.command, ...provider.loginArgs].map(shQuote).join(' ')}`
  return { kind: 'terminal', agent: 'other', name: at.name, cwd: at.cwd, command, floorId: at.floorId, pos: { x: 80, y: 80 }, size: { w: 640, h: 400 }, autoStart: true }
}
