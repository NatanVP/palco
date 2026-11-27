import { AskBroker, type BrokerDeps } from '../../src/main/ask/ask-broker'
import type { AgentKind } from '../../src/shared/model'

let deliveries: Array<{ to: string; text: string }>
let screen: Map<string, string>
let agents: Map<string, AgentKind>
let deps: BrokerDeps
beforeEach(() => {
  vi.useFakeTimers()
  deliveries = []
  screen = new Map([['b', 'screen B'], ['c', 'screen C']])
  agents = new Map([['b', 'claude'], ['c', 'codex'], ['shell', 'shell']])
  deps = {
    deliver: (to, text) => { deliveries.push({ to, text }) },
    screenText: id => screen.get(id) ?? '',
    agentOf: id => agents.get(id) ?? 'shell',
    setTimeout, clearTimeout
  }
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('resolves a hook with the last message, falling back to the screen only when absent', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  const first = broker.ask('a', 'b', 'one')
  broker.onTurnEnded('b', 'literal answer')
  await expect(first).resolves.toEqual({ ok: true, via: 'hook', text: 'literal answer' })
  const second = broker.ask('a', 'b', 'two')
  broker.onTurnEnded('b')
  await expect(second).resolves.toEqual({ ok: true, via: 'hook', text: 'screen B' })
  const third = broker.ask('a', 'b', 'three')
  broker.onTurnEnded('b', '')
  await expect(third).resolves.toEqual({ ok: true, via: 'hook', text: '' })
  expect(broker.pending()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

it('serializes requests to a busy target in FIFO while other targets proceed independently', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  const one = broker.ask('a', 'b', 'one')
  const two = broker.ask('x', 'b', 'two')
  const three = broker.ask('y', 'b', 'three')
  const other = broker.ask('a', 'c', 'other')
  expect(deliveries).toEqual([{ to: 'b', text: 'one' }, { to: 'c', text: 'other' }])
  expect(broker.pending()).toEqual([{ from: 'a', to: 'b' }, { from: 'x', to: 'b' }, { from: 'y', to: 'b' }, { from: 'a', to: 'c' }])
  broker.onTurnEnded('b', '1')
  expect(deliveries.at(-1)).toEqual({ to: 'b', text: 'two' })
  broker.onTurnEnded('b', '2')
  expect(deliveries.at(-1)).toEqual({ to: 'b', text: 'three' })
  broker.onTurnEnded('c', '4')
  broker.onTurnEnded('b', '3')
  expect(await Promise.all([one, two, three, other])).toEqual([
    { ok: true, via: 'hook', text: '1' }, { ok: true, via: 'hook', text: '2' },
    { ok: true, via: 'hook', text: '3' }, { ok: true, via: 'hook', text: '4' }
  ])
})

it('ignores a Stop without an active ask and never credits it to a subsequent request', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  broker.onTurnEnded('b', 'unsolicited')
  broker.onOutput('b')
  const result = broker.ask('a', 'b', 'new prompt')
  let settled = false
  void result.then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(broker.pending()).toEqual([{ from: 'a', to: 'b' }])
  broker.onTurnEnded('b', 'new answer')
  await expect(result).resolves.toMatchObject({ text: 'new answer' })
})

it('resolves shells after 1500 ms of silence and resets the timer on every output chunk', async () => {
  screen.set('shell', 'shell output')
  const broker = new AskBroker(deps, { settleMs: 0 })
  const result = broker.ask('a', 'shell', 'echo hello')
  vi.advanceTimersByTime(1000)
  broker.onOutput('shell')
  vi.advanceTimersByTime(1499)
  expect(broker.pending()).toHaveLength(1)
  vi.advanceTimersByTime(1)
  await expect(result).resolves.toEqual({ ok: true, via: 'idle', text: 'shell output' })
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['claude', 'codex'] as const)('uses the 120000 ms idle fallback for %s, not the shell timer', async agent => {
  agents.set('b', agent)
  const broker = new AskBroker(deps, { settleMs: 0 })
  const result = broker.ask('a', 'b', 'work')
  vi.advanceTimersByTime(119999)
  expect(broker.pending()).toHaveLength(1)
  screen.set('b', 'completed screen')
  vi.advanceTimersByTime(1)
  await expect(result).resolves.toEqual({ ok: true, via: 'idle', text: 'completed screen' })
})

it('resolves only a matching active ask back, delivering its full text', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  const result = broker.ask('a', 'b', 'request')
  expect(broker.tryAskBack('b', 'unrelated', 'wrong')).toBe(false)
  expect(broker.tryAskBack('a', 'b', 'wrong direction')).toBe(false)
  expect(broker.tryAskBack('b', 'a', 'complete\nanswer')).toBe(true)
  await expect(result).resolves.toEqual({ ok: true, via: 'askback', text: 'complete\nanswer' })
  expect(broker.tryAskBack('b', 'a', 'duplicate')).toBe(false)
  broker.onTurnEnded('b', 'turn ended after ask back')
  expect(vi.getTimerCount()).toBe(0)
})

it('drains the exited target active request and its queue without delivering any queued prompts', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  const one = broker.ask('a', 'b', 'one')
  const two = broker.ask('x', 'b', 'two')
  const other = broker.ask('a', 'c', 'other')
  broker.onExit('b')
  broker.onTurnEnded('b', 'too late')
  await expect(one).resolves.toEqual({ ok: false, error: 'exited' })
  await expect(two).resolves.toEqual({ ok: false, error: 'exited' })
  expect(deliveries).toEqual([{ to: 'b', text: 'one' }, { to: 'c', text: 'other' }])
  expect(broker.pending()).toEqual([{ from: 'a', to: 'c' }])
  broker.onTurnEnded('c', 'still alive')
  await expect(other).resolves.toMatchObject({ ok: true, text: 'still alive' })
  expect(vi.getTimerCount()).toBe(0)
})

it('times out after 1800000 ms even if output keeps resetting the idle timer', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  const result = broker.ask('a', 'b', 'long job')
  for (let i = 0; i < 17; i++) {
    vi.advanceTimersByTime(100000)
    broker.onOutput('b')
  }
  vi.advanceTimersByTime(99999)
  expect(broker.pending()).toHaveLength(1)
  vi.advanceTimersByTime(1)
  await expect(result).resolves.toEqual({ ok: false, error: 'timeout' })
  broker.onTurnEnded('b', 'late completion after timeout')
  expect(vi.getTimerCount()).toBe(0)
})

it('waits for a timed-out turn to end before delivering queued work within its remaining deadline', async () => {
  const broker = new AskBroker(deps, { settleMs: 0, timeoutMs: 1000, agentIdleMs: 10000 })
  const one = broker.ask('a', 'b', 'one')
  vi.advanceTimersByTime(500)
  const two = broker.ask('x', 'b', 'two')
  vi.advanceTimersByTime(500)
  await expect(one).resolves.toEqual({ ok: false, error: 'timeout' })
  expect(deliveries).toEqual([{ to: 'b', text: 'one' }])
  broker.onTurnEnded('b', 'old timed-out turn')
  expect(deliveries).toEqual([{ to: 'b', text: 'one' }, { to: 'b', text: 'two' }])
  vi.advanceTimersByTime(499)
  expect(broker.pending()).toHaveLength(1)
  vi.advanceTimersByTime(1)
  await expect(two).resolves.toEqual({ ok: false, error: 'timeout' })
})

it('sets active state before delivery so synchronous hooks are not lost and leave no timers behind', async () => {
  let broker: AskBroker
  deps.deliver = (to, text) => { broker.onTurnEnded(to, `answer: ${text}`) }
  broker = new AskBroker(deps, { settleMs: 0 })
  await expect(broker.ask('a', 'b', 'immediate')).resolves.toEqual({ ok: true, via: 'hook', text: 'answer: immediate' })
  expect(broker.pending()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

it('settles failed delivery as exited rather than leaving requests or timers stuck', async () => {
  deps.deliver = () => { throw new Error('process gone') }
  const broker = new AskBroker(deps, { settleMs: 0 })
  await expect(broker.ask('a', 'b', 'request')).resolves.toEqual({ ok: false, error: 'exited' })
  expect(broker.pending()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

it('does not deliver queued work whose submission deadline has already expired', async () => {
  const broker = new AskBroker(deps, { settleMs: 0, timeoutMs: 1000, agentIdleMs: 10000 })
  const one = broker.ask('a', 'b', 'one')
  const two = broker.ask('x', 'b', 'two')
  vi.advanceTimersByTime(1000)
  expect(await Promise.all([one, two])).toEqual([{ ok: false, error: 'timeout' }, { ok: false, error: 'timeout' }])
  expect(deliveries).toEqual([{ to: 'b', text: 'one' }])
})


it('does not credit the Stop after an ask back to the next queued caller', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  const first = broker.ask('a', 'b', 'first prompt')
  const second = broker.ask('c', 'b', 'second prompt')
  expect(broker.tryAskBack('b', 'a', 'first reply')).toBe(true)
  await expect(first).resolves.toEqual({ ok: true, via: 'askback', text: 'first reply' })
  expect(deliveries).toEqual([{ to: 'b', text: 'first prompt' }])
  expect(broker.pending()).toEqual([{ from: 'c', to: 'b' }])
  broker.onTurnEnded('b', 'first turn summary')
  expect(deliveries).toEqual([{ to: 'b', text: 'first prompt' }, { to: 'b', text: 'second prompt' }])
  let finished = false
  void second.then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  broker.onTurnEnded('b', 'second reply')
  await expect(second).resolves.toEqual({ ok: true, via: 'hook', text: 'second reply' })
  expect(vi.getTimerCount()).toBe(0)
})

it('uses idle as a turn boundary after ask back when a hook is missing', async () => {
  const broker = new AskBroker(deps, { settleMs: 0, agentIdleMs: 1000 })
  const first = broker.ask('a', 'b', 'first')
  const second = broker.ask('c', 'b', 'second')
  broker.tryAskBack('b', 'a', 'first reply')
  await first
  vi.advanceTimersByTime(900)
  broker.onOutput('b')
  vi.advanceTimersByTime(999)
  expect(deliveries).toEqual([{ to: 'b', text: 'first' }])
  vi.advanceTimersByTime(1)
  expect(deliveries.at(-1)).toEqual({ to: 'b', text: 'second' })
  broker.onExit('b')
  await expect(second).resolves.toEqual({ ok: false, error: 'exited' })
})

describe('fim de turno em duas fases (settle)', () => {
  it('o hook só resolve depois de 2000 ms sem outro hook ou atividade', async () => {
    const broker = new AskBroker(deps)
    const first = broker.ask('a', 'b', 'one')
    const second = broker.ask('x', 'b', 'two')
    broker.onTurnEnded('b', 'resposta')
    vi.advanceTimersByTime(1999)
    expect(broker.pending()).toHaveLength(2)
    expect(deliveries).toEqual([{ to: 'b', text: 'one' }])
    vi.advanceTimersByTime(1)
    await expect(first).resolves.toEqual({ ok: true, via: 'hook', text: 'resposta' })
    expect(deliveries.at(-1)).toEqual({ to: 'b', text: 'two' })
  })

  it('um novo hook substitui a mensagem e rearma o settle', async () => {
    const broker = new AskBroker(deps)
    const result = broker.ask('a', 'b', 'one')
    broker.onTurnEnded('b', 'primeira')
    vi.advanceTimersByTime(1500)
    broker.onTurnEnded('b', 'segunda')
    vi.advanceTimersByTime(1999)
    expect(broker.pending()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: 'segunda' })
  })

  it('onBusy cancela o settle pendente: o Stop foi bloqueado e o agente continua', async () => {
    const broker = new AskBroker(deps)
    const result = broker.ask('a', 'b', 'one')
    const second = broker.ask('x', 'b', 'two')
    broker.onTurnEnded('b', 'parcial')
    vi.advanceTimersByTime(1000)
    broker.onBusy('b')
    vi.advanceTimersByTime(10000)
    expect(broker.pending()).toHaveLength(2)
    expect(deliveries).toEqual([{ to: 'b', text: 'one' }])
    broker.onTurnEnded('b', 'final')
    vi.advanceTimersByTime(2000)
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: 'final' })
    expect(deliveries.at(-1)).toEqual({ to: 'b', text: 'two' })
    broker.onExit('b')
    await second
  })

  it('hook sem mensagem usa a tela lida só quando o settle dispara', async () => {
    const broker = new AskBroker(deps)
    const result = broker.ask('a', 'b', 'one')
    broker.onTurnEnded('b')
    screen.set('b', 'tela depois do settle')
    vi.advanceTimersByTime(2000)
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: 'tela depois do settle' })
  })

  it('onBusy sem ask ativo é ignorado e onExit limpa o settle', async () => {
    const broker = new AskBroker(deps)
    broker.onBusy('b')
    const result = broker.ask('a', 'b', 'one')
    broker.onTurnEnded('b', 'x')
    broker.onExit('b')
    await expect(result).resolves.toEqual({ ok: false, error: 'exited' })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('input-messages do notify', () => {
  it('ignora JSON title sem o prompt entregue nas input-messages', async () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    const result = broker.ask('a', 'c', 'responda só: oi do codex')
    broker.onTurnEnded('c', '{"title":"interno"}', ['Generate a thread title from the conversation'])
    expect(broker.pending()).toHaveLength(1)
    broker.onTurnEnded('c', 'oi do codex', ['responda só: oi do codex'])
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: 'oi do codex' })
  })

  it('compara ignorando espaços e quebras de linha', async () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    const result = broker.ask('a', 'c', 'linha 1\nlinha   2')
    broker.onTurnEnded('c', 'ok', ['linha 1 linha 2'])
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: 'ok' })
  })
})

describe('cancelamento (AbortSignal)', () => {
  it('sinal já abortado resolve cancelled sem entrar na fila nem entregar', async () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    const ac = new AbortController()
    ac.abort()
    await expect(broker.ask('a', 'b', 'x', ac.signal)).resolves.toEqual({ ok: false, error: 'cancelled' })
    expect(deliveries).toEqual([])
    expect(broker.pending()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abort de um ask na fila o tira da fila sem mexer no ativo', async () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    const first = broker.ask('a', 'b', 'one')
    const ac = new AbortController()
    const queued = broker.ask('x', 'b', 'two', ac.signal)
    const third = broker.ask('y', 'b', 'three')
    ac.abort()
    await expect(queued).resolves.toEqual({ ok: false, error: 'cancelled' })
    expect(broker.pending()).toEqual([{ from: 'a', to: 'b' }, { from: 'y', to: 'b' }])
    broker.onTurnEnded('b', '1')
    await expect(first).resolves.toMatchObject({ text: '1' })
    expect(deliveries.map(d => d.text)).toEqual(['one', 'three'])
    broker.onTurnEnded('b', '3')
    await expect(third).resolves.toMatchObject({ text: '3' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abort do ativo cancela o settle mas só entrega o próximo após descartar a fronteira', async () => {
    const broker = new AskBroker(deps)
    const ac = new AbortController()
    const active = broker.ask('a', 'b', 'one', ac.signal)
    const next = broker.ask('x', 'b', 'two')
    broker.onTurnEnded('b', 'parcial') // settle armado
    ac.abort()
    await expect(active).resolves.toEqual({ ok: false, error: 'cancelled' })
    expect(deliveries.map(d => d.text)).toEqual(['one'])
    vi.advanceTimersByTime(2000)
    expect(deliveries.map(d => d.text)).toEqual(['one'])
    expect(broker.tryAskBack('b', 'a', 'late')).toBe(false)
    broker.onTurnEnded('b', 'cancelled turn', ['unrelated'])
    expect(deliveries.at(-1)).toEqual({ to: 'b', text: 'two' })
    expect(broker.pending()).toEqual([{ from: 'x', to: 'b' }])
    broker.onTurnEnded('b', 'fim')
    vi.advanceTimersByTime(2000)
    await expect(next).resolves.toMatchObject({ text: 'fim' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abort depois de resolvido não tem efeito (nem libera o turno ainda ativo)', async () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    const ac = new AbortController()
    const first = broker.ask('a', 'b', 'one', ac.signal)
    const second = broker.ask('c', 'b', 'two')
    expect(broker.tryAskBack('b', 'a', 'resposta')).toBe(true)
    await expect(first).resolves.toMatchObject({ via: 'askback' })
    ac.abort()
    expect(deliveries.map(d => d.text)).toEqual(['one'])
    broker.onTurnEnded('b', 'x')
    expect(deliveries.map(d => d.text)).toEqual(['one', 'two'])
    broker.onExit('b')
    await second
  })

  it('sem sinal o comportamento é o de sempre', async () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    const r = broker.ask('a', 'b', 'x')
    broker.onTurnEnded('b', 'ok')
    await expect(r).resolves.toMatchObject({ ok: true })
  })
})

it('accepts a legitimate title response, but only once the turn goes quiet (title-shaped never resolves alone)', async () => {
  const broker = new AskBroker(deps, { settleMs: 0, agentIdleMs: 1000 })
  const result = broker.ask('a', 'c', 'give a title JSON')
  broker.onTurnEnded('c', '{"title":"real"}', ['give a title JSON'])
  expect(broker.pending()).toHaveLength(1)
  vi.advanceTimersByTime(1000)
  await expect(result).resolves.toMatchObject({ text: '{"title":"real"}' })
})
it('accepts ordinary answers even if input-messages truncate the delivered long prompt', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  const prompt = 'long prompt '.repeat(1000)
  const result = broker.ask('a', 'c', prompt)
  broker.onTurnEnded('c', 'legitimate', [prompt.slice(0, 100)])
  await expect(result).resolves.toMatchObject({ text: 'legitimate' })
})
it.each(['idle', 'exit'])('cleans draining timers at %s without crediting old work', async boundary => {
  const broker = new AskBroker(deps, { agentIdleMs: 1000 })
  const ac = new AbortController()
  const old = broker.ask('a', 'b', 'old', ac.signal)
  const next = broker.ask('c', 'b', 'next')
  ac.abort()
  await expect(old).resolves.toMatchObject({ error: 'cancelled' })
  expect(deliveries.map(d => d.text)).toEqual(['old'])
  if (boundary === 'idle') {
    vi.advanceTimersByTime(999)
    expect(deliveries.map(d => d.text)).toEqual(['old'])
    vi.advanceTimersByTime(1)
    expect(deliveries.map(d => d.text)).toEqual(['old', 'next'])
  }
  broker.onExit('b')
  await expect(next).resolves.toMatchObject({ error: 'exited' })
  expect(vi.getTimerCount()).toBe(0)
})
it('does not use an internal title notify as the cancelled Codex turn boundary', async () => {
  const broker = new AskBroker(deps, { settleMs: 0 })
  const ac = new AbortController()
  const first = broker.ask('a', 'c', 'first real prompt', ac.signal)
  const second = broker.ask('b', 'c', 'second real prompt')
  ac.abort()
  await expect(first).resolves.toMatchObject({ error: 'cancelled' })
  broker.onTurnEnded('c', '{"title":"internal"}', ['generate a title'])
  expect(deliveries.map(d => d.text)).toEqual(['first real prompt'])
  broker.onTurnEnded('c', 'old answer', ['first real prompt'])
  expect(deliveries.map(d => d.text)).toEqual(['first real prompt', 'second real prompt'])
  broker.onTurnEnded('c', 'new answer', ['second real prompt'])
  await expect(second).resolves.toMatchObject({ text: 'new answer' })
  expect(vi.getTimerCount()).toBe(0)
})

describe('turno de título do Codex (smoke final eff282f)', () => {
  const titulo = '{"title":"Responder oi do Codex"}'
  const prompt = 'responda só: oi do codex'

  it('título depois da resposta, na janela do settle: a resposta vence', async () => {
    const broker = new AskBroker(deps)
    const result = broker.ask('a', 'c', prompt)
    broker.onTurnEnded('c', 'oi do codex', [prompt])
    vi.advanceTimersByTime(500)
    broker.onTurnEnded('c', titulo, [prompt])
    vi.advanceTimersByTime(2000)
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: 'oi do codex' })
  })

  it('título antes da resposta, com a resposta demorando mais que o settle: espera a resposta', async () => {
    const broker = new AskBroker(deps)
    const result = broker.ask('a', 'c', prompt)
    broker.onTurnEnded('c', titulo, [prompt])
    vi.advanceTimersByTime(10000)
    expect(broker.pending()).toHaveLength(1)
    broker.onTurnEnded('c', 'oi do codex', [prompt])
    vi.advanceTimersByTime(2000)
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: 'oi do codex' })
  })

  it('se só chegar mensagem com forma de título (pedido legítimo), o silêncio devolve essa mensagem', async () => {
    const broker = new AskBroker(deps, { agentIdleMs: 5000 })
    const result = broker.ask('a', 'c', 'gere um título em JSON')
    broker.onTurnEnded('c', '{"title":"Meu doc"}', ['gere um título em JSON'])
    vi.advanceTimersByTime(5000)
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: '{"title":"Meu doc"}' })
  })

  it('Claude não tem turno de título: JSON com title resolve normalmente', async () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    const result = broker.ask('a', 'b', 'x')
    broker.onTurnEnded('b', '{"title":"t"}')
    await expect(result).resolves.toEqual({ ok: true, via: 'hook', text: '{"title":"t"}' })
  })
})

describe('prompt rejeitado (diálogo aberto no agente)', () => {
  it('onRejected resolve o ask ativo com rejected e entrega o próximo da fila', async () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    const first = broker.ask('a', 'c', 'um')
    const second = broker.ask('x', 'c', 'dois')
    broker.onRejected('c')
    await expect(first).resolves.toEqual({ ok: false, error: 'rejected' })
    expect(deliveries.at(-1)).toEqual({ to: 'c', text: 'dois' })
    broker.onTurnEnded('c', 'resposta dois')
    await expect(second).resolves.toEqual({ ok: true, via: 'hook', text: 'resposta dois' })
  })

  it('onRejected sem ask ativo não faz nada', () => {
    const broker = new AskBroker(deps, { settleMs: 0 })
    expect(() => broker.onRejected('c')).not.toThrow()
    expect(broker.pending()).toHaveLength(0)
  })
})
