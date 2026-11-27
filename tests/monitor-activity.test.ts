import { ActivityMonitor, activityText, createActivityNotifier } from '../src/main/activity-monitor'

/** Relógio e timers falsos: o monitor não depende de setTimeout real. */
function harness(shouldNotify: (id: string) => boolean = () => true) {
  let now = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let seq = 0
  const notes: Array<[string, string]> = []
  const monitor = new ActivityMonitor({
    now: () => now,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id },
    clearTimer: (id) => { timers.delete(id as number) },
    shouldNotify,
    notify: (id, kind) => notes.push([id, kind])
  })
  const advance = (ms: number): void => {
    const end = now + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0]); now = next[1].at; next[1].fn()
    }
    now = end
  }
  /** Saída contínua: um chunk a cada 200 ms durante `ms`. */
  const burst = (id: string, ms: number): void => { for (let t = 0; t < ms; t += 200) { monitor.data(id); advance(200) } }
  return { monitor, notes, advance, burst, timers }
}

describe('Monitorar Atividade', () => {
  it('a primeira rajada (o boot) não notifica início; o fim de um trabalho longo notifica "done" depois de 4 s de silêncio', () => {
    const h = harness()
    h.burst('t', 3000)
    expect(h.notes).toEqual([])
    // O último chunk saiu há 200 ms (o burst avança depois de cada um): faltam 3,8 s de silêncio.
    h.advance(3700)
    expect(h.notes).toEqual([])
    h.advance(100)
    expect(h.notes).toEqual([['t', 'done']])
  })

  it('saída curta (eco de tecla, prompt) não conta como trabalho', () => {
    const h = harness()
    h.burst('t', 400)
    h.advance(10_000)
    expect(h.notes).toEqual([])
  })

  it('atividade nova depois de 60 s parado notifica "started" uma vez, e o fim notifica "done"', () => {
    const h = harness()
    h.burst('t', 2000); h.advance(5000)
    expect(h.notes).toEqual([['t', 'done']])
    h.advance(60_000)
    h.burst('t', 3000)
    expect(h.notes).toEqual([['t', 'done'], ['t', 'started']])
    h.advance(5000)
    expect(h.notes).toEqual([['t', 'done'], ['t', 'started'], ['t', 'done']])
  })

  it('retomada logo depois (menos de 60 s) não é "atividade nova"', () => {
    const h = harness()
    h.burst('t', 2000); h.advance(5000)
    h.advance(20_000)
    h.burst('t', 3000)
    expect(h.notes.filter(([, k]) => k === 'started')).toEqual([])
  })

  it('debounce: no máximo uma notificação a cada 10 s por terminal; terminais diferentes não se bloqueiam', () => {
    const h = harness()
    h.burst('a', 2000); h.burst('b', 2000); h.advance(4100)
    // Volta a trabalhar e para de novo logo: o "done" seguinte de 'a' cai dentro dos 10 s e é descartado.
    h.burst('a', 2000); h.advance(4100)
    expect(h.notes).toEqual([['a', 'done'], ['b', 'done']])
    h.advance(10_000)
    h.burst('a', 2000); h.advance(4100)
    expect(h.notes.at(-1)).toEqual(['a', 'done'])
  })

  it('sem notificação quando a janela está focada no próprio terminal (e isso não gasta o debounce)', () => {
    let focused = true
    const h = harness(() => !focused)
    h.burst('t', 2000); h.advance(4100)
    expect(h.notes).toEqual([])
    focused = false
    h.burst('t', 2000); h.advance(4100)
    expect(h.notes).toEqual([['t', 'done']])
  })

  it('forget cancela o timer pendente (terminal removido ou monitor desligado); dispose limpa tudo', () => {
    const h = harness()
    h.burst('t', 2000)
    h.monitor.forget('t')
    h.advance(10_000)
    expect(h.notes).toEqual([])
    h.burst('u', 2000)
    h.monitor.dispose()
    expect(h.timers.size).toBe(0)
  })

  it('texto da notificação', () => {
    expect(activityText('done', 'Claude 2')).toEqual({ title: 'Claude 2', body: 'Terminou a atividade.' })
    expect(activityText('started', 'Codex')).toEqual({ title: 'Codex', body: 'Voltou a ter atividade.' })
  })
})

describe('notificador: liga o monitor aos terminais e à notificação do sistema', () => {
  type Node = { id: string; name: string; monitor?: boolean }
  function setup(nodes: Record<string, Node>) {
    let onData: (id: string) => void = () => {}
    const shown: Array<{ title: string; body: string; onClick(): void }> = []
    const focused: string[] = []
    let windowFocused = false
    const notifier = createActivityNotifier({
      terminals: { onData: (cb) => { onData = (id) => cb(id, '', 0, 1); return () => {} } },
      nodeOf: (id) => nodes[id] as never,
      isWindowFocused: () => windowFocused,
      showNotification: (n) => shown.push(n),
      focusTerminal: (id) => focused.push(id)
    })
    return { notifier, shown, focused, data: (id: string) => onData(id), setWindowFocused: (v: boolean) => { windowFocused = v } }
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const work = (s: ReturnType<typeof setup>, id: string): void => {
    for (let t = 0; t < 2000; t += 200) { s.data(id); vi.advanceTimersByTime(200) }
    vi.advanceTimersByTime(4100)
  }

  it('só terminais com monitor ligado avisam; clicar na notificação foca o terminal', () => {
    const s = setup({ a: { id: 'a', name: 'Claude 2', monitor: true }, b: { id: 'b', name: 'Shell' } })
    work(s, 'a'); work(s, 'b')
    expect(s.shown.map((n) => [n.title, n.body])).toEqual([['Claude 2', 'Terminou a atividade.']])
    s.shown[0]!.onClick()
    expect(s.focused).toEqual(['a'])
    s.notifier.dispose()
  })

  it('janela focada no próprio terminal: sem aviso; focada em outro terminal ou desfocada: avisa', () => {
    const s = setup({ a: { id: 'a', name: 'A', monitor: true } })
    s.setWindowFocused(true)
    s.notifier.setFocused('a')
    work(s, 'a')
    expect(s.shown).toEqual([])
    s.notifier.setFocused('outro')
    vi.advanceTimersByTime(10_000)
    work(s, 'a')
    expect(s.shown).toHaveLength(1)
    s.notifier.dispose()
  })

  it('monitor desligado no meio do trabalho, ou nó removido: nada é avisado', () => {
    const nodes: Record<string, Node> = { a: { id: 'a', name: 'A', monitor: true } }
    const s = setup(nodes)
    for (let t = 0; t < 2000; t += 200) { s.data('a'); vi.advanceTimersByTime(200) }
    nodes.a = { ...nodes.a!, monitor: false }
    vi.advanceTimersByTime(5000)
    expect(s.shown).toEqual([])
    s.notifier.dispose()
  })
})

describe('ligar/desligar o monitor num terminal existente (Editar terminal)', () => {
  it('patch aceita monitor só em terminal e com booleano', async () => {
    const { parseNodePatch } = await import('../src/main/validate')
    expect(parseNodePatch({ monitor: true }, 'terminal')).toEqual({ monitor: true })
    expect(() => parseNodePatch({ monitor: 'sim' }, 'terminal')).toThrow()
    expect(() => parseNodePatch({ monitor: true }, 'note')).toThrow()
  })
  it('store grava o monitor do terminal', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { WorkspaceStore } = await import('../src/main/domain/workspace-store')
    const dir = mkdtempSync(join(tmpdir(), 'palco-mon-'))
    try {
      const store = new WorkspaceStore(join(dir, 'ws.json'))
      const id = store.addNode({ kind: 'terminal', floorId: null, name: 'T', agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })
      store.patchNode(id, { monitor: true })
      expect(store.get().nodes[id]).toMatchObject({ monitor: true })
      store.flush()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('notificador: ciclo de vida do terminal', () => {
  function lifecycle() {
    let onData: (id: string, gen: number) => void = () => {}
    let onExit: (id: string) => void = () => {}
    const shown: string[] = []
    const notifier = createActivityNotifier({
      terminals: {
        onData: (cb) => { onData = (id, gen) => cb(id, '', 0, gen); return () => {} },
        onExit: (cb) => { onExit = (id) => cb(id, 0); return () => {} }
      },
      nodeOf: () => ({ name: 'T', monitor: true }),
      isWindowFocused: () => false,
      showNotification: (n) => shown.push(n.body),
      focusTerminal: () => {}
    })
    const work = (gen = 1): void => { for (let t = 0; t < 2000; t += 200) { onData('t', gen); vi.advanceTimersByTime(200) } }
    return { notifier, shown, work, exit: () => onExit('t'), data: (gen: number) => onData('t', gen) }
  }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('terminal que sai (ou é removido) antes do silêncio de 4 s não gera aviso e o timer some', () => {
    const h = lifecycle()
    h.work()
    h.exit()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(h.shown).toEqual([])
    h.notifier.dispose()
  })

  it('geração nova (restart) recomeça do zero: o boot do processo novo não continua a rajada antiga', () => {
    const h = lifecycle()
    h.work(1)
    // Restart: a saída da geração 2 chega sem um exit no meio; a rajada antiga é descartada.
    h.data(2)
    vi.advanceTimersByTime(10_000)
    expect(h.shown).toEqual([])
    h.notifier.dispose()
  })

  it('dispose cancela as duas assinaturas e os timers', () => {
    const offs = { data: vi.fn(), exit: vi.fn() }
    let onData: (id: string) => void = () => {}
    const notifier = createActivityNotifier({
      terminals: { onData: (cb) => { onData = (id) => cb(id, '', 0, 1); return offs.data }, onExit: () => offs.exit },
      nodeOf: () => ({ name: 'T', monitor: true }), isWindowFocused: () => false, showNotification: () => {}, focusTerminal: () => {}
    })
    onData('t')
    notifier.dispose()
    expect(offs.data).toHaveBeenCalled()
    expect(offs.exit).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
