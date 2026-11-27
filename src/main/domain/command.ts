import type { AgentKind } from '../../shared/model'
import { commandLineError } from '../../shared/agent-command'

const MAX_COMMAND = 2000

/**
 * Comando do terminal: uma linha só, digitada como está no shell do terminal (flags, variáveis na frente e
 * wrapper de shell valem; o palco não interpola nada). O programa que a linha inicia tem de ser o do agente.
 */
export function normalizeAgentCommand(agent: AgentKind, command: string): string {
  const line = command.trim()
  if (line === '') {
    if (agent === 'other') throw new Error('agente other precisa de um comando')
    return agent === 'shell' ? '' : agent==='antigravity'?'agy':agent
  }
  if (line.length > MAX_COMMAND) throw new Error('command grande demais')
  // Uma linha só, sem caracteres de controle: o texto é digitado no terminal.
  if (/[\u0000-\u001f\u007f]/.test(line)) throw new Error('command deve ser uma linha só, sem caracteres de controle')
  if (line.startsWith('-')) throw new Error('command não pode começar com -')
  // Mesma regra da UI; o script de um wrapper `-c` também é validado.
  const why = commandLineError(line)
  if (why !== null) throw new Error(`command inválido: ${why}`)
  // Com o agente explícito, um programa próprio (wrapper como `meu-codex`) vale.
  return line
}
