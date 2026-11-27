import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalManager, stripInherited, type TerminalManagerOptions } from '../../src/main/pty/terminal-manager'
import type { TerminalNode } from '../../src/shared/model'

const node = (id: string, over: Partial<TerminalNode> = {}): TerminalNode => ({
  id,
  kind: 'terminal',
  floorId: null,
  name: id,
  agent: 'shell',
  command: '',
  cwd: process.cwd(),
  pos: { x: 0, y: 0 },
  size: { w: 400, h: 300 },
  ...over
})

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout esperando condição')
    await new Promise((r) => setTimeout(r, 25))
  }
}

let tm: TerminalManager
const make = () =>
  (tm = new TerminalManager({
    socketPath: '/tmp/palco-test/palco.sock',
    palcoBin: '/opt/palco/bin/palco',
    env: { SHELL: '/bin/bash', PS1: '$ ' }
  }))

afterEach(() => tm?.killAll())

describe('TerminalManager', () => {
  it('injeta PALCO_TERMINAL_ID no shell', async () => {
    make()
    tm.spawn(node('t1'))
    tm.write('t1', 'echo ID=$PALCO_TERMINAL_ID\r')
    await waitFor(() => /ID=t1/.test(tm.screenText('t1')))
  })

  it('injeta PALCO_NAME: o agente sabe como se chama no palco', async () => {
    make()
    tm.spawn(node('t1', { name: 'Co2' }))
    tm.write('t1', 'echo NOME=$PALCO_NAME\r')
    await waitFor(() => /NOME=Co2/.test(tm.screenText('t1')))
  })

  it('injeta PALCO_SOCKET, PALCO_CLI e põe o bin no PATH', async () => {
    make()
    tm.spawn(node('t1'))
    // O rc do usuário pode mexer no PATH; basta o diretório do bin estar nele.
    tm.write('t1', 'echo S=$PALCO_SOCKET C=$PALCO_CLI HAS=$(echo ":$PATH:" | grep -c ":/opt/palco/bin:")\r')
    await waitFor(() => tm.screenText('t1').includes('HAS=1'))
    const s = tm.screenText('t1')
    expect(s).toContain('S=/tmp/palco-test/palco.sock')
    expect(s).toContain('C=/opt/palco/bin/palco')
  })

  it('screenText contém a saída', async () => {
    make()
    tm.spawn(node('t1'))
    tm.write('t1', 'echo olá-mundo\r')
    await waitFor(() => tm.screenText('t1').includes('olá-mundo'))
  })

  it('deliverPrompt no shell roda o texto literal', async () => {
    make()
    tm.spawn(node('t1'))
    tm.deliverPrompt('t1', 'echo "a b \\$HOME"')
    await waitFor(() => /^a b \$HOME$/m.test(tm.screenText('t1')))
  })

  it('snapshot().seq corresponde exatamente à última sequência de onData', async () => {
    make()
    let last = 0
    tm.onData((_id, _d, seq) => (last = seq))
    tm.spawn(node('t1'))
    tm.write('t1', 'echo fim-xyz\r')
    await waitFor(() => tm.screenText('t1').includes('fim-xyz'))
    await new Promise((r) => setTimeout(r, 200))
    const snap = tm.snapshot('t1')
    expect(last).toBeGreaterThan(0)
    expect(snap.seq).toBe(last)
    expect(snap.data).toContain('fim-xyz')
  })

  it('kill dispara onExit', async () => {
    make()
    const exits: string[] = []
    tm.onExit((id) => exits.push(id))
    tm.spawn(node('t1'))
    expect(tm.isRunning('t1')).toBe(true)
    tm.kill('t1')
    await waitFor(() => exits.includes('t1'))
    expect(tm.isRunning('t1')).toBe(false)
  })
})

describe('TerminalManager: geração, prontidão do agente e descarte', () => {
  const scripts: string[] = []
  const fakeAgent = (body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'palco-agent-'))
    scripts.push(dir)
    const file = join(dir, 'agent.sh')
    writeFileSync(file, `#!/bin/sh\n${body}\n`)
    chmodSync(file, 0o755)
    return file
  }
  afterEach(() => {
    for (const d of scripts.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('reiniciar o mesmo id cria outra geração, com seq recomeçando', async () => {
    make()
    const seen: Array<[number, number]> = []
    tm.onData((_id, _d, seq, gen) => seen.push([gen, seq]))
    const exits: string[] = []
    tm.onExit((id) => exits.push(id))
    tm.spawn(node('t1'))
    await waitFor(() => seen.length > 0)
    expect(tm.snapshot('t1').gen).toBe(1)
    tm.kill('t1')
    await waitFor(() => exits.length === 1)
    const before = seen.length
    tm.spawn(node('t1'))
    await waitFor(() => seen.slice(before).some(([gen]) => gen === 2))
    const second = seen.slice(before).filter(([gen]) => gen === 2)
    expect(second[0]![1]).toBe(1)
    expect(seen.slice(before).every(([gen]) => gen === 2)).toBe(true)
    expect(tm.snapshot('t1').gen).toBe(2)
  })

  it('prompt para agente espera o agente ficar pronto (silêncio após a saída do boot)', async () => {
    tm = new TerminalManager({
      socketPath: '/tmp/palco-test/palco.sock',
      palcoBin: '/opt/palco/bin/palco',
      env: { SHELL: '/bin/bash', PS1: '$ ' },
      readyQuietMs: 400,
      readyTimeoutMs: 10000
    })
    const agent = fakeAgent('echo AGENT-UP; exec cat')
    tm.spawn(node('a1', { agent: 'claude', command: agent }))
    tm.deliverPrompt('a1', 'minha-pergunta')
    await waitFor(() => tm.screenText('a1').includes('AGENT-UP'))
    expect(tm.screenText('a1')).not.toContain('minha-pergunta')
    await waitFor(() => tm.screenText('a1').includes('minha-pergunta'))
    const screen = tm.screenText('a1')
    expect(screen.indexOf('AGENT-UP')).toBeLessThan(screen.lastIndexOf('minha-pergunta'))
    expect(screen).not.toContain('command not found')
  })

  const agentManager = (readyQuietMs: number, readyTimeoutMs: number) =>
    (tm = new TerminalManager({
      socketPath: '/tmp/palco-test/palco.sock',
      palcoBin: '/opt/palco/bin/palco',
      env: { SHELL: '/bin/bash', PS1: '$ ' },
      readyQuietMs,
      readyTimeoutMs
    }))
  const noisyAgent = () => fakeAgent('while :; do echo tick; sleep 0.1; done')

  it('markReady libera a entrega 500 ms depois, mesmo com a TUI sempre emitindo saída', async () => {
    agentManager(60000, 60000)
    tm.spawn(node('a1', { agent: 'claude', command: noisyAgent() }))
    tm.deliverPrompt('a1', 'depois-do-hook')
    await new Promise((r) => setTimeout(r, 900))
    expect(tm.screenText('a1')).not.toContain('depois-do-hook')
    const t0 = Date.now()
    tm.markReady('a1')
    tm.markReady('a1') // idempotente
    await new Promise((r) => setTimeout(r, 250))
    expect(tm.screenText('a1')).not.toContain('depois-do-hook')
    await waitFor(() => tm.screenText('a1').includes('depois-do-hook'), 4000)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(450)
  })

  it('depois de pronto, a entrega é imediata', async () => {
    agentManager(60000, 60000)
    tm.spawn(node('a1', { agent: 'claude', command: noisyAgent() }))
    tm.markReady('a1')
    await new Promise((r) => setTimeout(r, 800))
    tm.deliverPrompt('a1', 'imediato-ok')
    await waitFor(() => tm.screenText('a1').includes('imediato-ok'), 2000)
  })

  it('markReady de terminal desconhecido, shell ou encerrado não faz nada nem lança', () => {
    agentManager(60000, 60000)
    expect(() => tm.markReady('nao-existe')).not.toThrow()
    tm.spawn(node('t1'))
    expect(() => tm.markReady('t1')).not.toThrow()
  })

  it('o teto conta do boot e, ao estourar, FALHA os pendentes (não entrega às cegas) até um sinal de prontidão', async () => {
    agentManager(500, 1200)
    const failed: string[] = []
    tm.onDeliveryFailed((id) => failed.push(id))
    tm.spawn(node('a1', { agent: 'codex', command: noisyAgent() }))
    expect(tm.agentState('a1')).toBe('booting')
    tm.deliverPrompt('a1', 'nunca-entregue')
    await waitFor(() => failed.includes('a1'), 5000)
    expect(tm.agentState('a1')).toBe('failed')
    await new Promise((r) => setTimeout(r, 300))
    expect(tm.screenText('a1')).not.toContain('nunca-entregue')
    // Depois da falha, prompts novos também não entram no PTY.
    tm.deliverPrompt('a1', 'tambem-nao')
    await new Promise((r) => setTimeout(r, 300))
    expect(tm.screenText('a1')).not.toContain('tambem-nao')
    // Um sinal de prontidão (hook) recupera o agente: o estado volta a 'ready' e a entrega funciona.
    tm.markReady('a1')
    await waitFor(() => tm.agentState('a1') === 'ready', 3000)
    tm.deliverPrompt('a1', 'agora-sim')
    await waitFor(() => tm.screenText('a1').includes('agora-sim'), 2000)
    expect(tm.screenText('a1')).not.toContain('nunca-entregue')
  })

  it('agentState: shell e desconhecido', () => {
    agentManager(60000, 60000)
    tm.spawn(node('t1'))
    expect(tm.agentState('t1')).toBe('ready')
    expect(tm.agentState('nao-existe')).toBe('unknown')
  })

  it('dispose libera a entrada, avisa a saída uma vez e silencia eventos', async () => {
    make()
    const exits: string[] = []
    const data: string[] = []
    tm.onExit((id) => exits.push(id))
    tm.spawn(node('t1'))
    tm.onData((id) => data.push(id))
    tm.dispose('t1')
    expect(exits).toEqual(['t1'])
    expect(tm.isRunning('t1')).toBe(false)
    expect(tm.snapshot('t1')).toEqual({ data: '', seq: 0, gen: 0 })
    expect(tm.screenText('t1')).toBe('')
    const seen = data.length
    await new Promise((r) => setTimeout(r, 300))
    expect(data.length).toBe(seen)
    expect(exits).toEqual(['t1'])
  })
})


describe('TerminalManager: token por terminal', () => {
  it('identify devolve {id, gen} da geração atual e nada para token revogado', async () => {
    make()
    const exits: string[] = []
    tm.onExit((id) => exits.push(id))
    tm.spawn(node('t1'))
    tm.write('t1', 'echo TK=$PALCO_TOKEN\r')
    await waitFor(() => /TK=[0-9a-f]{64}/.test(tm.screenText('t1')))
    const first = /TK=([0-9a-f]{64})/.exec(tm.screenText('t1'))![1]!
    expect(tm.identify(first)).toEqual({ id: 't1', gen: 1 })
    tm.kill('t1')
    await waitFor(() => exits.length === 1)
    expect(tm.identify(first)).toBeUndefined()
    tm.spawn(node('t1'))
    tm.write('t1', 'echo TK2=$PALCO_TOKEN\r')
    await waitFor(() => /TK2=[0-9a-f]{64}/.test(tm.screenText('t1')))
    const second = /TK2=([0-9a-f]{64})/.exec(tm.screenText('t1'))![1]!
    expect(tm.identify(second)).toEqual({ id: 't1', gen: 2 })
    expect(tm.identify(first)).toBeUndefined()
  })

  const readToken = async (id: string): Promise<string> => {
    tm.write(id, 'echo TK=$PALCO_TOKEN\r')
    await waitFor(() => /TK=[0-9a-f]{64}/.test(tm.screenText(id)))
    return /TK=([0-9a-f]{64})/.exec(tm.screenText(id))![1]!
  }

  it('cada spawn recebe um PALCO_TOKEN aleatório de 64 hex, mapeado para o terminal', async () => {
    make()
    tm.spawn(node('t1'))
    tm.spawn(node('t2'))
    const [a, b] = [await readToken('t1'), await readToken('t2')]
    expect(a).not.toBe(b)
    expect(tm.terminalForToken(a)).toBe('t1')
    expect(tm.terminalForToken(b)).toBe('t2')
    expect(tm.terminalForToken('0'.repeat(64))).toBeUndefined()
    expect(tm.terminalForToken('')).toBeUndefined()
  })

  it('reiniciar troca o token; dispose o revoga', async () => {
    make()
    const exits: string[] = []
    tm.onExit((id) => exits.push(id))
    tm.spawn(node('t1'))
    const old = await readToken('t1')
    tm.kill('t1')
    await waitFor(() => exits.length === 1)
    tm.spawn(node('t1'))
    const fresh = await readToken('t1')
    expect(fresh).not.toBe(old)
    expect(tm.terminalForToken(old)).toBeUndefined()
    expect(tm.terminalForToken(fresh)).toBe('t1')
    tm.dispose('t1')
    expect(tm.terminalForToken(fresh)).toBeUndefined()
  })

  it('terminal encerrado perde o token', async () => {
    make()
    const exits: string[] = []
    tm.onExit((id) => exits.push(id))
    tm.spawn(node('t1'))
    const t = await readToken('t1')
    tm.kill('t1')
    await waitFor(() => exits.length === 1)
    expect(tm.terminalForToken(t)).toBeUndefined()
  })
})

describe('TerminalManager: env herdado', () => {
  const session = {
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_SSE_PORT: '1234',
    CODEX_SANDBOX: 'seatbelt',
    CODEX_SANDBOX_NETWORK_DISABLED: '1',
    CODEX_THREAD_ID: 'abc',
    CODEX_CI: '1',
    PALCO_ANTIGA: 'sim',
    PALCO_TOKEN: 'velho',
    PALCO_SOCKET: '/velho.sock',
    PALCO_TERMINAL_ID: 'velho',
    PALCO_CLI: '/velho/palco'
  }
  const durable = {
    CODEX_HOME: '/perfil/codex',
    CLAUDE_CONFIG_DIR: '/perfil/claude',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    MANTIDA: 'fica'
  }
  const all = { ...session, ...durable }
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const [k, v] of Object.entries(all)) {
      saved[k] = process.env[k]
      process.env[k] = v
    }
  })
  afterEach(() => {
    for (const k of Object.keys(all)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  // CLAUDE_CONFIG_DIR e CODEX_HOME do processo do palco também saem: "Padrão" é a pasta padrão do CLI
  // (o rc do shell do usuário, se as definir, as recria dentro do terminal).
  it('remove variáveis de SESSÃO e a pasta de conta herdadas, preserva o resto do perfil e injeta os PALCO_* novos', async () => {
    make()
    tm.spawn(node('t1'))
    const names = Object.keys(session).filter((k) => !k.startsWith('PALCO_')).concat('PALCO_ANTIGA')
    tm.write('t1', `echo LEFT=$(env | grep -cE '^(${names.join('|')})=') KEEP=$CODEX_HOME,$CLAUDE_CONFIG_DIR,$CLAUDE_CODE_USE_BEDROCK,$CLAUDE_CODE_USE_VERTEX,$MANTIDA\r`)
    await waitFor(() => tm.screenText('t1').includes('LEFT=0 KEEP=,,1,1,fica'))
    tm.write('t1', 'echo NEW=$PALCO_TERMINAL_ID:$PALCO_SOCKET:$PALCO_CLI:${#PALCO_TOKEN}\r')
    await waitFor(() => tm.screenText('t1').includes('NEW=t1:/tmp/palco-test/palco.sock:/opt/palco/bin/palco:64'))
  })

  it('stripInherited é uma lista explícita: CLAUDE_CODE_* e CODEX_* desconhecidos ficam', () => {
    const out = stripInherited({ CLAUDE_CODE_OUTRA: 'x', CODEX_OUTRA: 'y', CLAUDECODE: '1', PALCO_X: '1', CODEX_HOME: 'h' })
    expect(out).toEqual({ CLAUDE_CODE_OUTRA: 'x', CODEX_OUTRA: 'y', CODEX_HOME: 'h' })
  })
})

describe('confirmação de entrega do prompt', () => {
  const fake = (o: Partial<TerminalManagerOptions> = {}) =>
    (tm = new TerminalManager({ socketPath: '/tmp/palco-test/palco.sock', palcoBin: '/opt/palco/bin/palco', env: { SHELL: '/bin/bash', PS1: '$ ' }, readyQuietMs: 200, promptConfirmMs: 400, ...o }))

  it('agente que não confirma o prompt (nenhum hook) dispara onPromptRejected', async () => {
    fake()
    const rejected: string[] = []
    tm.onPromptRejected((id) => rejected.push(id))
    // "claude" falso: o comando de boot não existe, o shell fica e nunca chega hook.
    tm.spawn(node('t1', { agent: 'claude', command: 'palco-agente-inexistente' }))
    await waitFor(() => tm.agentState('t1') === 'ready')
    tm.deliverPrompt('t1', 'oi')
    await waitFor(() => rejected.length === 1)
    expect(rejected).toEqual(['t1'])
  })

  it('um hook depois da entrega confirma: nada é rejeitado', async () => {
    fake()
    const rejected: string[] = []
    tm.onPromptRejected((id) => rejected.push(id))
    tm.spawn(node('t1', { agent: 'claude', command: 'palco-agente-inexistente' }))
    await waitFor(() => tm.agentState('t1') === 'ready')
    tm.deliverPrompt('t1', 'oi')
    tm.notePromptHook('t1')
    await new Promise((r) => setTimeout(r, 800))
    expect(rejected).toEqual([])
  })
})

describe('diálogo aberto no agente', () => {
  it('não cola o prompt quando há um diálogo na tela: rejeita na hora', async () => {
    tm = new TerminalManager({ socketPath: '/tmp/palco-test/palco.sock', palcoBin: '/opt/palco/bin/palco', env: { SHELL: '/bin/bash', PS1: '$ ' }, readyQuietMs: 200, promptConfirmMs: 5000 })
    const rejected: string[] = []
    tm.onPromptRejected((id) => rejected.push(id))
    tm.spawn(node('t1', { agent: 'codex', command: 'palco-agente-inexistente' }))
    await waitFor(() => tm.agentState('t1') === 'ready')
    tm.write('t1', 'echo "enter select · esc back"\r')
    await waitFor(() => tm.dialogOpen('t1') !== null)
    tm.deliverPrompt('t1', 'PROMPT_QUE_NAO_PODE_ENTRAR')
    expect(rejected).toEqual(['t1'])
    await new Promise((r) => setTimeout(r, 300))
    expect(tm.screenText('t1')).not.toContain('PROMPT_QUE_NAO_PODE_ENTRAR')
  })
})
