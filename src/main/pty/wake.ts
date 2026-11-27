import type { TerminalNode, Workspace } from '../../shared/model'

/** Prazo para um terminal acordado sob demanda ficar pronto antes de a resposta dizer "ainda iniciando". */
export const WAKE_TIMEOUT_MS = 30_000
const WAKE_POLL_MS = 250

export interface WakeTerminals {
  /** Já houve processo para este nó nesta sessão do palco (rodando ou encerrado). */
  hasSession(id: string): boolean
  isRunning(id: string): boolean
  spawn(node: TerminalNode): void
  agentState(id: string): 'ready' | 'booting' | 'failed' | 'unknown'
}

/**
 * Acorda um terminal de andar ou workspace que não foi aberto desde que o palco iniciou (carregamento preguiçoso):
 * sobe o processo e espera o agente ficar pronto. `running`: já rodava; `ready`: acordou e está pronto;
 * `booting`: acordou, mas passou do prazo; `exited`: a sessão dele terminou (não é acordado de novo).
 */
export async function wakeTerminal(node: TerminalNode, t: WakeTerminals, opts: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<'running' | 'ready' | 'booting' | 'exited'> {
  const alreadyRunning = t.isRunning(node.id)
  if (!alreadyRunning) {
    if (t.hasSession(node.id)) return 'exited'
    t.spawn(node)
  }
  // Terminais recrutados já podem estar rodando enquanto o agente ainda inicializa.
  if (alreadyRunning && t.agentState(node.id) !== 'booting') return 'running'
  const timeout = opts.timeoutMs ?? WAKE_TIMEOUT_MS
  const poll = opts.pollMs ?? WAKE_POLL_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let waited = 0; ; waited += poll) {
    if (!t.isRunning(node.id)) return 'exited'
    if (t.agentState(node.id) === 'ready') return 'ready'
    if (waited >= timeout) return 'booting'
    await sleep(poll)
  }
}

/** Terminais que sobem sozinhos quando um workspace/andar aparece na tela (`autoStart: false` e descarregados esperam ação explícita). */
export function lazyTerminals(ws: Workspace): TerminalNode[] {
  return Object.values(ws.nodes).filter((n): n is TerminalNode => n.kind === 'terminal' && n.floorId === ws.activeFloor && n.autoStart !== false && !n.unloaded)
}
