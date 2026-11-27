import type { AskBroker } from './ask/ask-broker'

export interface LogDeps {
  info(message: string): void
  now(): number
  /** Nome legível do terminal (nunca conteúdo, nunca token). */
  nameOf(terminalId: string): string
}

const PREFIX = '[palco]'

/** Nome de usuário em uma linha de log: controles e quebras viram escapes visíveis, nunca uma linha nova. */
function safe(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, (c) => {
    if (c === '\n') return '\\n'
    if (c === '\r') return '\\r'
    if (c === '\t') return '\\t'
    return `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
  })
}

/**
 * Envolve o broker com log enxuto: quem perguntou a quem, tamanhos, via e duração.
 * Nunca registra o texto de prompts ou respostas, nem tokens.
 */
export function withAskLogging(broker: AskBroker, deps: LogDeps): AskBroker {
  const { info, now } = deps
  const nameOf = (id: string): string => safe(deps.nameOf(id))
  const override: Partial<Record<keyof AskBroker, unknown>> = {
    ask: (from: string, to: string, prompt: string, signal?: AbortSignal) => {
      const route = `${nameOf(from)} -> ${nameOf(to)}`
      const started = now()
      info(`${PREFIX} ask iniciado ${route} (prompt: ${prompt.length} caracteres)`)
      return broker.ask(from, to, prompt, signal).then((result) => {
        if (!result.ok && result.error === 'cancelled') {
          info(`${PREFIX} ask cancelado ${route} em ${now() - started}ms`)
          return result
        }
        const outcome = result.ok ? `via=${result.via}` : `erro=${result.error}`
        info(`${PREFIX} ask resolvido ${route} ${outcome} em ${now() - started}ms`)
        return result
      })
    },
    onTurnEnded: (terminalId: string, lastMessage?: string, inputMessages?: string[]) => {
      const detail = lastMessage === undefined ? 'sem mensagem' : `mensagem: ${lastMessage.length} caracteres`
      info(`${PREFIX} hook recebido: turn-ended ${nameOf(terminalId)} (${detail})`)
      broker.onTurnEnded(terminalId, lastMessage, inputMessages)
    },
    onBusy: (terminalId: string) => {
      info(`${PREFIX} hook recebido: busy ${nameOf(terminalId)}`)
      broker.onBusy(terminalId)
    },
    tryAskBack: (from: string, to: string, text: string) => {
      const delivered = broker.tryAskBack(from, to, text)
      if (delivered) info(`${PREFIX} ask back ${nameOf(from)} -> ${nameOf(to)} (resposta: ${text.length} caracteres)`)
      return delivered
    }
  }
  return new Proxy(broker, {
    get(target, prop) {
      if (prop in override) return override[prop as keyof AskBroker]
      const value = Reflect.get(target, prop, target) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    }
  })
}
