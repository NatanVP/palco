import type { IPty } from 'node-pty'
import { TerminalManager, type TerminalManagerOptions } from '../src/main/pty/terminal-manager'
import type { TerminalNode } from '../src/shared/model'

/** PTY falso: a saída só acontece quando o teste manda (simula processo que ignora sinais). */
function fakePty(pid: number) {
  let exit: ((e: { exitCode: number }) => void) | undefined
  const pty = {
    pid,
    onData: () => ({ dispose() {} }),
    onExit: (cb: (e: { exitCode: number }) => void) => { exit = cb; return { dispose() {} } },
    kill: vi.fn(), write() {}, resize: vi.fn()
  }
  return { pty: pty as unknown as IPty & { resize: ReturnType<typeof vi.fn> }, exit: (code = 0) => exit?.({ exitCode: code }) }
}

function setup(opts: Partial<TerminalManagerOptions> = {}) {
  const ptys: Array<ReturnType<typeof fakePty>> = []
  const spawned: Array<{ cwd: string; cols: number; rows: number }> = []
  const signals: Array<[number, string]> = []
  const spawnPty = vi.fn<NonNullable<TerminalManagerOptions['spawnPty']>>((_f, _a, o) => {
    const p = fakePty(1000 + ptys.length)
    ptys.push(p)
    spawned.push({ cwd: String(o.cwd), cols: Number(o.cols), rows: Number(o.rows) })
    return p.pty
  })
  const manager = new TerminalManager({
    socketPath: '/s', palcoBin: '/p', spawnPty,
    signalProcess: (pid, sig) => { signals.push([pid, sig]) },
    stopTimeoutMs: 3000, killTimeoutMs: 1000, ...opts
  })
  const exits: Array<[string, number]> = []
  manager.onExit((id, code) => exits.push([id, code]))
  return { manager, ptys, spawned, signals, exits }
}

const node: TerminalNode = { id: 't', kind: 'terminal', name: 'T', agent: 'shell', command: '', floorId: null, cwd: '/a', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('restart aguarda o processo antigo', () => {
  it('SIGTERM, espera a saída e só então sobe o novo (a saída real é avisada uma vez)', async () => {
    const h = setup()
    h.manager.spawn(node)
    const done = h.manager.restart({ ...node, cwd: '/b' })
    await vi.advanceTimersByTimeAsync(500)
    expect(h.signals).toEqual([[1000, 'SIGTERM']])
    expect(h.spawned).toHaveLength(1)
    h.ptys[0]!.exit(143)
    await done
    expect(h.spawned.map((s) => s.cwd)).toEqual(['/a', '/b'])
    expect(h.exits).toEqual([['t', 143]])
    expect(h.manager.isRunning('t')).toBe(true)
  })

  it('processo que ignora SIGTERM leva SIGKILL no prazo; o novo sobe depois que ele sai', async () => {
    const h = setup()
    h.manager.spawn(node)
    const done = h.manager.restart(node)
    await vi.advanceTimersByTimeAsync(2999)
    expect(h.signals.map(([, s]) => s)).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(1)
    expect(h.signals.map(([, s]) => s)).toEqual(['SIGTERM', 'SIGKILL'])
    expect(h.spawned).toHaveLength(1)
    h.ptys[0]!.exit(137)
    await done
    expect(h.spawned).toHaveLength(2)
  })

  it('processo que não sai nem com SIGKILL: restart falha e nenhum PTY novo é criado', async () => {
    const h = setup()
    h.manager.spawn(node)
    const done = h.manager.restart(node)
    const failed = expect(done).rejects.toThrow(/não encerrou/)
    await vi.advanceTimersByTimeAsync(3000 + 1000)
    await failed
    expect(h.spawned).toHaveLength(1)
    // O antigo continua sendo o terminal registrado (nada vazou para fora do manager).
    expect(h.manager.isRunning('t')).toBe(true)
    // Se ele sair depois, a saída é avisada normalmente e um restart seguinte funciona.
    h.ptys[0]!.exit(0)
    expect(h.manager.isRunning('t')).toBe(false)
    await h.manager.restart(node)
    expect(h.spawned).toHaveLength(2)
  })

  it('duas chamadas seguidas sobem um processo só', async () => {
    const h = setup()
    h.manager.spawn(node)
    const a = h.manager.restart(node), b = h.manager.restart(node)
    h.ptys[0]!.exit(0)
    await Promise.all([a, b])
    expect(h.spawned).toHaveLength(2)
  })

  it('parado: só sobe de novo, sem sinal', async () => {
    const h = setup()
    h.manager.spawn(node)
    h.ptys[0]!.exit(0)
    await h.manager.restart(node)
    expect(h.signals).toEqual([])
    expect(h.spawned).toHaveLength(2)
  })
})

describe('restart usa o tamanho atual do terminal', () => {
  it('resize para 70×18 e restart: o PTY novo nasce em 70×18 (sem esperar novo resize)', async () => {
    const h = setup()
    h.manager.spawn(node)
    h.manager.resize('t', 70, 18)
    const done = h.manager.restart(node)
    h.ptys[0]!.exit(0)
    await done
    expect(h.spawned.map(({ cols, rows }) => [cols, rows])).toEqual([[120, 32], [70, 18]])
  })
})
