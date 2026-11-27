import { describe, expect, it, vi } from 'vitest'
import { TerminalManager } from '../../src/main/pty/terminal-manager'
import type { TerminalNode } from '../../src/shared/model'

const node: TerminalNode = {
  id: 'queries', kind: 'terminal', floorId: null, name: 'queries', agent: 'shell', command: '',
  cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 600, h: 400 }
}

/** Primary Device Attributes: o fish 4 só desenha depois da resposta (espera 10 s sem ela). */
const DA1 = '\x1b[0c'

function setup() {
  let emit: (data: string) => void = () => {}
  const written: string[] = []
  const fake = {
    pid: 999999999, process: 'fish', cols: 80, rows: 24,
    onData: (cb: (data: string) => void) => { emit = cb; return { dispose() {} } },
    onExit: () => ({ dispose() {} }),
    write: (d: string) => { written.push(d) }, resize() {}, kill() {}
  }
  const manager = new TerminalManager({ socketPath: '/tmp/palco-queries.sock', palcoBin: 'palco', spawnPty: (() => fake) as never })
  const applied = vi.fn()
  manager.onData(applied)
  manager.spawn(node)
  /** Manda um trecho do processo e espera a tela do main aplicá-lo. */
  const output = async (data: string): Promise<void> => {
    const before = applied.mock.calls.length
    emit(data)
    await vi.waitFor(() => expect(applied.mock.calls.length).toBeGreaterThan(before))
  }
  return { manager, written, output, emit: (d: string) => emit(d), applied }
}

describe('consultas do programa ao terminal', () => {
  it('o main responde enquanto nenhuma tela está ligada', async () => {
    const { written, output } = setup()
    await output(DA1)
    expect(written.join('')).toMatch(/^\x1b\[\?[\d;]+c$/)
  })

  it('com uma tela ligada, o main fica calado: quem responde é a tela', async () => {
    const { manager, written, output } = setup()
    manager.attach(node.id)
    await output(DA1)
    expect(written).toEqual([])
  })

  it('trecho recebido e ainda não aplicado na hora do attach fica para a tela', async () => {
    const { manager, written, emit, applied } = setup()
    emit(DA1)
    const snapshot = manager.attach(node.id)
    await vi.waitFor(() => expect(applied).toHaveBeenCalled())
    // A tela recebe esse trecho (seq maior que o do snapshot) e responde sozinha.
    expect(applied.mock.calls[0]![2]).toBeGreaterThan(snapshot.seq)
    expect(written).toEqual([])
  })

  it('volta a responder quando a tela é desmontada', async () => {
    const { manager, written, output } = setup()
    manager.attach(node.id)
    manager.detach(node.id)
    await output(DA1)
    expect(written.join('')).toMatch(/^\x1b\[\?[\d;]+c$/)
  })

  it('saída comum não escreve nada no processo', async () => {
    const { written, output } = setup()
    await output('olá\r\n')
    expect(written).toEqual([])
  })
})
