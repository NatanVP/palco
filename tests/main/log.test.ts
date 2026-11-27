import { describe, expect, it } from 'vitest'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { withAskLogging } from '../../src/main/log'

function setup(agent: 'shell' | 'codex' = 'shell') {
  const lines: string[] = []
  let clock = 1000
  const broker = new AskBroker(
    { deliver: () => {}, screenText: () => 'TELA-SECRETA', agentOf: () => agent, setTimeout, clearTimeout },
    { settleMs: 0, shellIdleMs: 60000 }
  )
  const logged = withAskLogging(broker, {
    info: (m) => lines.push(m),
    now: () => clock,
    nameOf: (id) => ({ a: 'Alfa', b: 'Beta' })[id] ?? id
  })
  return { lines, logged, broker, tick: (ms: number) => (clock += ms) }
}

describe('withAskLogging', () => {
  it('loga ask iniciado e resolvido (via e ms), sem o conteúdo do prompt nem da resposta', async () => {
    const { lines, logged, tick } = setup()
    const pending = logged.ask('a', 'b', 'prompt-segredo-123')
    tick(250)
    logged.onTurnEnded('b', 'resposta-segredo-456')
    expect(await pending).toEqual({ ok: true, via: 'hook', text: 'resposta-segredo-456' })
    expect(lines).toEqual([
      '[palco] ask iniciado Alfa -> Beta (prompt: 18 caracteres)',
      '[palco] hook recebido: turn-ended Beta (mensagem: 20 caracteres)',
      '[palco] ask resolvido Alfa -> Beta via=hook em 250ms'
    ])
    expect(lines.join('\n')).not.toMatch(/segredo|TELA/)
  })

  it('loga hook busy, hook sem mensagem, ask back e ask que falha', async () => {
    const { lines, logged, broker } = setup()
    const pending = logged.ask('a', 'b', 'x')
    logged.onBusy('b')
    expect(logged.tryAskBack('b', 'a', 'resp')).toBe(true)
    await pending
    broker.onTurnEnded('b') // fecha o turno que ficou ativo depois do ask back
    const second = logged.ask('a', 'b', 'y')
    logged.onTurnEnded('b')
    await second
    const third = logged.ask('a', 'b', 'z')
    broker.onExit('b')
    await third
    expect(lines).toContain('[palco] hook recebido: busy Beta')
    expect(lines).toContain('[palco] ask back Beta -> Alfa (resposta: 4 caracteres)')
    expect(lines).toContain('[palco] hook recebido: turn-ended Beta (sem mensagem)')
    expect(lines.some((l) => /ask resolvido Alfa -> Beta via=askback/.test(l))).toBe(true)
    expect(lines.some((l) => /ask resolvido Alfa -> Beta erro=exited/.test(l))).toBe(true)
  })

  it('o restante da interface passa direto ao broker', () => {
    const { logged } = setup()
    void logged.ask('a', 'b', 'x')
    expect(logged.pending()).toEqual([{ from: 'a', to: 'b' }])
    logged.onExit('b')
    expect(logged.pending()).toEqual([])
  })
  it('repassa as input-messages ao broker (filtro do notify do Codex)', async () => {
    const { logged, broker } = setup('codex')
    const pending = logged.ask('a', 'b', 'pergunta real')
    logged.onTurnEnded('b', '{"title":"internal"}', ['outra coisa'])
    expect(broker.pending()).toHaveLength(1)
    logged.onTurnEnded('b', 'ok', ['pergunta real'])
    expect(await pending).toEqual({ ok: true, via: 'hook', text: 'ok' })
  })

  it('loga ask cancelado (sem via nem erro genérico) e repassa o sinal', async () => {
    const { lines, logged, tick } = setup()
    const ac = new AbortController()
    const pending = logged.ask('a', 'b', 'x', ac.signal)
    tick(70)
    ac.abort()
    await expect(pending).resolves.toEqual({ ok: false, error: 'cancelled' })
    expect(lines).toContain('[palco] ask cancelado Alfa -> Beta em 70ms')
    expect(lines.some((l) => l.includes('ask resolvido'))).toBe(false)
  })

  it('nomes com newline ou caracteres de controle não forjam linhas do log', async () => {
    const lines: string[] = []
    const broker = new AskBroker(
      { deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout },
      { settleMs: 0, shellIdleMs: 60000 }
    )
    const evil = 'Beta\n[palco] ask resolvido Falso -> Falso via=hook em 1ms'
    const logged = withAskLogging(broker, {
      info: (m) => lines.push(m),
      now: () => 0,
      nameOf: (id) => (id === 'b' ? evil : id === 'a' ? 'Al\x1b[31mfa\r\t\u0000' : id)
    })
    const pending = logged.ask('a', 'b', 'x')
    logged.onTurnEnded('b', 'r')
    await pending
    logged.onBusy('b')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).not.toMatch(/[\x00-\x1f\x7f]/)
    expect(lines.filter((l) => l.startsWith('[palco] ask resolvido'))).toHaveLength(1)
    expect(lines.join('\n')).toContain('Beta\\n[palco] ask resolvido Falso')
  })
})
