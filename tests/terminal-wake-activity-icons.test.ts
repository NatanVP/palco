// wake sob demanda e carregamento preguiçoso.
import { wakeTerminal, lazyTerminals } from '../src/main/pty/wake'
import type { TerminalNode, Workspace } from '../src/shared/model'

const node = (id: string, over: Partial<TerminalNode> = {}): TerminalNode => ({ id, kind: 'terminal', floorId: null, name: id, agent: 'claude', command: 'claude', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 }, ...over })

function fakeTerminals(readyAfter: number) {
  const sessions = new Map<string, { running: boolean; since: number }>()
  let now = 0
  return {
    sessions,
    tick: (ms: number) => { now += ms },
    t: {
      hasSession: (id: string) => sessions.has(id),
      isRunning: (id: string) => sessions.get(id)?.running === true,
      spawn: (n: TerminalNode) => { sessions.set(n.id, { running: true, since: now }) },
      agentState: (id: string) => { const s = sessions.get(id); return !s?.running ? 'unknown' as const : now - s.since >= readyAfter ? 'ready' as const : 'booting' as const }
    }
  }
}

describe('wakeTerminal', () => {
  it('terminal que nunca subiu nesta sessão: sobe e espera ficar pronto', async () => {
    const f = fakeTerminals(300)
    const r = await wakeTerminal(node('a'), f.t, { timeoutMs: 1000, pollMs: 100, sleep: async (ms) => f.tick(ms) })
    expect(r).toBe('ready')
    expect(f.sessions.has('a')).toBe(true)
  })
  it('passou do prazo: "booting" (a resposta diz que ainda está iniciando)', async () => {
    const f = fakeTerminals(5000)
    expect(await wakeTerminal(node('a'), f.t, { timeoutMs: 1000, pollMs: 100, sleep: async (ms) => f.tick(ms) })).toBe('booting')
  })
  it('sessão que terminou não é acordada; rodando volta na hora', async () => {
    const f = fakeTerminals(0)
    f.sessions.set('morto', { running: false, since: 0 })
    expect(await wakeTerminal(node('morto'), f.t, { timeoutMs: 1000, pollMs: 100, sleep: async () => {} })).toBe('exited')
    f.sessions.set('vivo', { running: true, since: 0 })
    expect(await wakeTerminal(node('vivo'), f.t, { timeoutMs: 1000, pollMs: 100, sleep: async () => {} })).toBe('running')
  })
  it('terminal rodando espera a inicialização do agente antes do ask', async () => {
    const f = fakeTerminals(300)
    f.sessions.set('recrutado', { running: true, since: 0 })
    expect(await wakeTerminal(node('recrutado'), f.t, { timeoutMs: 1000, pollMs: 100, sleep: async (ms) => f.tick(ms) })).toBe('ready')
  })
  it('shell fica pronto ao subir', async () => {
    const f = fakeTerminals(99999)
    f.t.agentState = () => 'ready'
    expect(await wakeTerminal(node('s', { agent: 'shell', command: '' }), f.t, { timeoutMs: 1000, pollMs: 100, sleep: async (ms) => f.tick(ms) })).toBe('ready')
  })
})

describe('carregamento preguiçoso', () => {
  it('sobem só os terminais do andar na tela do workspace aberto, e nunca os autoStart: false', () => {
    const ws = { id: 'w', name: 'W', activeFloor: 'f1', floors: {}, connections: [], camera: { offset: { x: 0, y: 0 }, zoom: 1 }, nodes: {
      g: node('g'), f: node('f', { floorId: 'f1' }), off: node('off', { floorId: 'f1', autoStart: false }),
      n: { id: 'n', kind: 'note', floorId: 'f1', name: 'n', content: '', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } }
    } } as unknown as Workspace
    expect(lazyTerminals(ws).map((t) => t.id)).toEqual(['f'])
  })
})

import { makeRoutineFire } from '../src/main/routines/fire'

describe('routine run acorda o destino', () => {
  const ws = { id: 'w', name: 'W', nodes: { d: node('d', { agent: 'shell', command: '' }) }, connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 } } as unknown as Workspace
  it('dormindo: acorda e entrega; ainda iniciando: pula com o motivo; sessão encerrada: pula', async () => {
    const writes: string[] = []
    let running = false
    const terminals = { isRunning: () => running, agentState: () => 'ready' as const, write: (_: string, d: string) => void writes.push(d), deliverPrompt: () => {}, dialogOpen: () => null }
    const routine = { id: 'r', name: 'R', schedule: { kind: 'every' as const, seconds: 60 }, terminalId: 'd', content: 'ls', enabled: true, createdBy: 'x' }
    expect(await makeRoutineFire({ workspace: () => ws, terminals, wake: async () => { running = true; return 'ready' } })(routine)).toBe('ok')
    expect(writes).toEqual(['ls\r'])
    running = false
    expect(await makeRoutineFire({ workspace: () => ws, terminals, wake: async () => 'booting' })(routine)).toBe('pulado: terminal ainda iniciando')
    expect(await makeRoutineFire({ workspace: () => ws, terminals, wake: async () => 'exited' })(routine)).toBe('pulado: terminal parado')
  })
})

import { lucideIcon } from '../src/renderer/src/nodes/terminal-icons'

describe('ícones de banda e terminal', () => {
  it('qualquer nome lucide em kebab-case vira ícone; emoji não; nome inexistente não', () => {
    expect(lucideIcon('bird')).toBeDefined()
    expect(lucideIcon('arrow-up')).toBeDefined()
    expect(lucideIcon('brain')).toBeDefined()
    expect(lucideIcon('🦅')).toBeUndefined()
    expect(lucideIcon('nao-existe-mesmo')).toBeUndefined()
  })
})

import { helpFor } from '../src/cli/help'
import { formatPresets } from '../src/cli/text-format'
import { parseArgs } from '../src/cli/args'

describe("ajuda dos comandos e apresentação dos presets", () => {
  it('ajuda de subcomando mostra só aquela alternativa, com as flags dela', () => {
    const out = helpFor(['preset', 'create', '--help'])
    expect(out.split('\n')[0]).toBe('palco preset create <nome> [--command C] [--account A] [--maestro on|off] [--chat on|off] [--quick-start on|off]')
    expect(out).not.toContain('palco preset set')
    expect(out).toMatch(/^  --quick-start .+/m)
    expect(out).not.toMatch(/^  --name /m)
  })
  it('portal --help lista os verbos da skill', () => {
    const out = helpFor(['portal', '--help'])
    for (const verb of ['key', 'type', 'evaluate', 'resize', 'ua', 'logs', 'scrollintoview', 'upload']) expect(out).toContain(`${verb} `)
  })
  it('preset list em texto, como a skill: accounts e starts on', () => {
    expect(parseArgs(['preset', 'list', '--json'])).toEqual({ cmd: 'preset-list', json: true })
    expect(formatPresets([{ name: 'Claude Opus', agent: 'claude', command: 'claude --model opus', account: 'Trabalho', accounts: ['Default', 'Trabalho'], maestro: true }]))
      .toBe('- "Claude Opus" (claude) command: "claude --model opus", maestro; accounts: "Default", "Trabalho"; starts on "Trabalho"\n')
  })
})
