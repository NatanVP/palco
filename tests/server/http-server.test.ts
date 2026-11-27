import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { startServer } from '../../src/main/server/http-server'
import { HEADER_TOKEN } from '../../src/shared/auth'
import { HEADER_TERMINAL } from '../../src/shared/model'

interface Res { status: number; body: string }

function call(socket: string, method: string, path: string, terminal?: string, body?: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const headers: Record<string, string> = {}
    if (terminal !== undefined) headers[HEADER_TOKEN] = tokens.get(terminal) ?? terminal
    if (payload !== undefined) headers['content-type'] = 'application/json'
    const req = http.request({ socketPath: socket, method, path, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

const waitFor = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout esperando condição')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let dir: string
let socket: string
let store: WorkspaceStore
let broker: AskBroker
let server: { close(): Promise<void> }
let delivered: Array<[string, string]>
let ids: { a: string; b: string; c: string; n: string }
let cliPath: string
let tokens: Map<string, string>
let readied: string[]
let hooked: string[]
const tok = (id: string): string => tokens.get(id) ?? id

const term = (name: string, x: number) =>
  store.addNode({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: '/tmp', pos: { x, y: 0 }, size: { w: 400, h: 300 } })

beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'palco-cli-'))
  cliPath = join(out, 'palco.cjs')
  await build({ entryPoints: ['src/cli/palco.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: cliPath, logLevel: 'silent' })
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'palco-srv-'))
  socket = join(dir, 'palco.sock')
  store = new WorkspaceStore(join(dir, 'ws.json'))
  delivered = []
  readied = []
  hooked = []
  gens = new Map()
  states = new Map()
  const a = term('Alfa', 500)
  const b = term('Beta', 0)
  const c = term('Gama', 0)
  const n = store.addNode({ kind: 'note', floorId: null, name: 'Plano', content: 'um\ndois\ntres', pos: { x: 0, y: 400 }, size: { w: 300, h: 200 } })
  store.connect(a, b)
  store.connect(a, n)
  ids = { a, b, c, n }
  tokens = new Map([[a, `tok-a-${a}`], [b, `tok-b-${b}`], [c, `tok-c-${c}`]])
  broker = new AskBroker(
    {
      deliver: (id, text) => delivered.push([id, text]),
      screenText: () => 'tela',
      agentOf: () => 'shell',
      setTimeout,
      clearTimeout
    },
    { shellIdleMs: 60000, settleMs: 0 }
  )
  server = await startServer(socket, { store, broker, terminals: terminalsFake() })
})

let gens: Map<string, number>
let states: Map<string, 'ready' | 'booting' | 'failed'>
const terminalsFake = () => ({
  markReady: (id: string) => void readied.push(id),
  notePromptHook: (id: string) => void hooked.push(id),
  screenText: (id: string) => `tela-de-${id}`,
  isRunning: () => true,
  agentState: (id: string) => states.get(id) ?? 'ready',
  identify: (t: string) => {
    const id = [...tokens].find(([, v]) => v === t)?.[0]
    return id === undefined ? undefined : { id, gen: gens.get(id) ?? 1 }
  }
})

afterEach(async () => {
  // O store grava com debounce: cancela a gravação pendente antes de apagar a fixture.
  try {
    store?.flush()
    if (broker && ids) for (const id of Object.values(ids)) broker.onExit(id)
    await server?.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

afterAll(() => rmSync(join(cliPath, '..'), { recursive: true, force: true }))

describe('http-server', () => {
  it('o cabeçalho de terminal não é identidade: só o token vale (sem personificação)', async () => {
    const raw = (headers: Record<string, string>): Promise<Res> =>
      new Promise((resolve, reject) => {
        const req = http.request({ socketPath: socket, method: 'GET', path: '/note/read?name=Plano', headers }, (res) => {
          let d = ''
          res.on('data', (c) => (d += c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d }))
        })
        req.on('error', reject)
        req.end()
      })
    // B (não conectado à nota) alegando ser A, com o token de B: continua sendo B → 404.
    expect((await raw({ [HEADER_TERMINAL]: ids.a, [HEADER_TOKEN]: tok(ids.b) })).status).toBe(404)
    // Só o ID de A, sem token → 401. Token inventado → 401.
    expect((await raw({ [HEADER_TERMINAL]: ids.a })).status).toBe(401)
    expect((await raw({ [HEADER_TERMINAL]: ids.a, [HEADER_TOKEN]: 'x'.repeat(64) })).status).toBe(401)
    // O token de A, sem cabeçalho de terminal nenhum → é A: 200.
    expect((await raw({ [HEADER_TOKEN]: tok(ids.a) })).status).toBe(200)
  })

  it('sem cabeçalho ou com terminal desconhecido → 401', async () => {
    expect((await call(socket, 'GET', '/list')).status).toBe(401)
    expect((await call(socket, 'GET', '/list', 'nao-existe')).status).toBe(401)
    expect((await call(socket, 'GET', '/list', ids.n)).status).toBe(401)
  })

  it('/list mostra só o alcançável', async () => {
    const res = await call(socket, 'GET', '/list', ids.a)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.self).toEqual({ name: 'Alfa', floor: 'ground' })
    expect(body.agents).toEqual([{ name: 'Beta', agent: 'shell', running: true, floor: 'ground' }])
    expect(body.notes).toEqual([{ name: 'Plano', locked: false }])
  })

  it('/check devolve a tela do alvo conectado', async () => {
    const res = await call(socket, 'GET', `/check?name=${encodeURIComponent('beta')}`, ids.a)
    expect(res).toEqual({ status: 200, body: `tela-de-${ids.b}` })
    expect((await call(socket, 'GET', '/check?name=Gama', ids.a)).status).toBe(404)
  })

  it('ask para nó não conectado → 404 e inexistente → 404', async () => {
    expect((await call(socket, 'POST', '/ask', ids.a, { to: 'Gama', prompt: 'oi' })).status).toBe(404)
    expect((await call(socket, 'POST', '/ask', ids.a, { to: 'Zeta', prompt: 'oi' })).status).toBe(404)
    expect((await call(socket, 'POST', '/ask', ids.a, { prompt: 'oi' })).status).toBe(400)
    expect(delivered).toEqual([])
  })

  it('ask resolvido pelo /turn-ended do alvo', async () => {
    const pending = call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'diga oi' })
    await waitFor(() => delivered.length === 1)
    expect(delivered[0]).toEqual([ids.b, 'diga oi'])
    expect((await call(socket, 'POST', '/turn-ended', ids.b, { lastMessage: 'oi!' })).status).toBe(200)
    expect(await pending).toEqual({ status: 200, body: 'oi!' })
  })

  it('ask back resolve o ask pendente do outro lado', async () => {
    const pending = call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'qual a cor?' })
    await waitFor(() => delivered.length === 1)
    const back = await call(socket, 'POST', '/ask', ids.b, { to: 'Alfa', prompt: 'azul' })
    expect(back.status).toBe(200)
    expect(back.body).toBe('OK: entregue como resposta ao ask pendente de Alfa')
    expect(await pending).toEqual({ status: 200, body: 'azul' })
    expect(delivered).toHaveLength(1)
  })

  it('ask com alvo que sai → 410', async () => {
    const pending = call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'x' })
    await waitFor(() => delivered.length === 1)
    broker.onExit(ids.b)
    const res = await pending
    expect(res.status).toBe(410)
    expect(res.body).toContain('exited')
  })

  it('notas: read, write, edit e create', async () => {
    const read = await call(socket, 'GET', '/note/read?name=Plano', ids.a)
    expect(read).toEqual({ status: 200, body: '1\tum\n2\tdois\n3\ttres' })
    expect((await call(socket, 'GET', '/note/read?name=Plano&offset=2&limit=1', ids.a)).body).toBe('2\tdois')

    // A primeira linha continua "Plano": o nome não muda (nota sem nome fixo segue a 1ª linha).
    expect((await call(socket, 'POST', '/note/write', ids.a, { name: 'Plano', content: 'Plano\nb' })).body).toBe('OK')
    expect((await call(socket, 'POST', '/note/edit', ids.a, { name: 'Plano', old: 'b', new: 'c' })).status).toBe(200)
    expect((await call(socket, 'GET', '/note/read?name=Plano', ids.a)).body).toBe('1\tPlano\n2\tc')
    expect((await call(socket, 'POST', '/note/edit', ids.a, { name: 'Plano', old: 'zzz', new: 'x' })).status).toBe(404)
    expect((await call(socket, 'GET', '/note/read?name=Plano', ids.b)).status).toBe(404)

    const created = await call(socket, 'POST', '/note/create', ids.a, { content: 'Ideias soltas\nlinha 2' })
    expect(created.status).toBe(200)
    expect(created.body).toContain('Ideias soltas')
    const ws = store.get()
    const note = Object.values(ws.nodes).find((x) => x.name === 'Ideias soltas')
    expect(note?.kind).toBe('note')
    expect(note?.pos).toEqual({ x: 500 - 360, y: 0 })
    expect(ws.connections.some((c) => [c.a, c.b].includes(note!.id) && [c.a, c.b].includes(ids.a))).toBe(true)

    const named = await call(socket, 'POST', '/note/create', ids.a, { content: 'x', name: 'Fixa' })
    expect(named.status).toBe(200)
    expect((await call(socket, 'GET', '/note/read?name=Fixa', ids.a)).body).toBe('1\tx')
  })

  it('rota inexistente → 404', async () => {
    expect((await call(socket, 'GET', '/nada', ids.a)).status).toBe(404)
  })
})

function cli(args: string[], env: Record<string, string>, input?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = execFile('node', [cliPath, ...args], { env: { PATH: process.env.PATH ?? '', ...env } }, (error, out, err) => {
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out, err })
    })
    child.stdin?.end(input ?? '')
  })
}

describe('CLI palco', () => {
  it('list imprime texto e --json preserva a resposta estruturada; sai com 0', async () => {
    const r = await cli(['list'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.a) })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^You:\n  - name: "Alfa"/)
    expect(r.out).toContain('Connected agents:\n  - name: "Beta"')
    const j = await cli(['list', '--json'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.a) })
    expect(JSON.parse(j.out).agents[0].name).toBe('Beta')
  })

  it('ask converte \\n e devolve a resposta do hook', async () => {
    const run = cli(['ask', 'Beta', 'a\\nb'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.a) })
    await waitFor(() => delivered.length === 1)
    expect(delivered[0]![1]).toBe('a\nb')
    await call(socket, 'POST', '/turn-ended', ids.b, { lastMessage: 'pronto' })
    const r = await run
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe('pronto')
  })

  it('erro vai ao stderr com prefixo e exit 1', async () => {
    const r = await cli(['ask', 'Gama', 'x'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.a) })
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/^palco: erro: alvo não encontrado/)
  })

  it('fora de um terminal do palco', async () => {
    const r = await cli(['list'], {})
    expect(r.code).toBe(1)
    expect(r.err.trim()).toBe('palco: erro: fora de um terminal do palco')
  })

  it('uso inválido → exit 1; help → exit 0', async () => {
    expect((await cli(['ask', 'so-um'], {})).code).toBe(1)
    expect((await cli(['help'], {})).code).toBe(0)
  })

  it('hook claude-stop envia o fim de turno e nunca falha alto', async () => {
    const run = cli(['ask', 'Beta', 'oi'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.a) })
    await waitFor(() => delivered.length === 1)
    const hook = await cli(['hook', 'claude-stop'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.b) }, JSON.stringify({ last_assistant_message: 'feito' }))
    expect(hook.code).toBe(0)
    expect((await run).out.trim()).toBe('feito')
    expect((await cli(['hook', 'claude-stop'], {}, '{}')).code).toBe(0)
  })

  it('hook codex-notify envia o fim de turno', async () => {
    const run = cli(['ask', 'Beta', 'oi'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.a) })
    await waitFor(() => delivered.length === 1)
    const payload = JSON.stringify({ type: 'agent-turn-complete', 'last-assistant-message': 'ok codex' })
    expect((await cli(['hook', 'codex-notify', payload], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.b) })).code).toBe(0)
    expect((await run).out.trim()).toBe('ok codex')
  })
})

describe('robustez HTTP', () => {
  const rawSocket = (path: string, request: string, waitMs = 1500): Promise<string> =>
    new Promise((resolve) => {
      const sock = net.connect(path)
      let data = ''
      sock.on('data', (c) => (data += c))
      sock.on('close', () => resolve(data))
      sock.on('error', () => resolve(data))
      sock.write(request)
      setTimeout(() => {
        sock.destroy()
        resolve(data)
      }, waitMs)
    })

  it('resposta por silêncio de um AGENTE vem marcada (não é a resposta dele); de um shell, não', async () => {
    const socket2 = join(dir, 'idle.sock')
    const cod = store.addNode({ kind: 'terminal', floorId: null, name: 'Cod', agent: 'codex', command: '', cwd: '/tmp', pos: { x: 0, y: 900 }, size: { w: 400, h: 300 } })
    store.connect(ids.a, cod)
    const fast = new AskBroker(
      { deliver: (id, t) => delivered.push([id, t]), screenText: (id) => `tela-${id}`, agentOf: (id) => (id === cod ? 'codex' : 'shell'), setTimeout, clearTimeout },
      { shellIdleMs: 50, agentIdleMs: 50, settleMs: 0 }
    )
    const srv = await startServer(socket2, { store, broker: fast, terminals: terminalsFake() })
    try {
      const agent = await call(socket2, 'POST', '/ask', ids.a, { to: 'Cod', prompt: 'x' })
      expect(agent.status).toBe(200)
      expect(agent.body.startsWith('[palco: o agente não sinalizou fim de turno')).toBe(true)
      expect(agent.body).toContain(`tela-${cod}`)
      const shell = await call(socket2, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'y' })
      expect(shell.body).toBe(`tela-${ids.b}`)
    } finally {
      await srv.close()
    }
  })

  it('busy e turn-ended confirmam a entrega do prompt; rejected vira 409 com dica', async () => {
    expect((await call(socket, 'POST', '/busy', ids.b)).status).toBe(200)
    expect((await call(socket, 'POST', '/turn-ended', ids.b, {})).status).toBe(200)
    expect(hooked).toEqual([ids.b, ids.b])
    const pending = call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'x' })
    await waitFor(() => delivered.length === 1)
    broker.onRejected(ids.b)
    const res = await pending
    expect(res.status).toBe(409)
    expect(res.body).toContain('não aceitou o prompt')
    expect(res.body).toContain('palco check "Beta"')
  })

  it('/busy cancela o settle do ask ativo', async () => {
    const socket2 = join(dir, 'busy.sock')
    const slow = new AskBroker(
      { deliver: (id, t) => delivered.push([id, t]), screenText: () => 'tela', agentOf: () => 'shell', setTimeout, clearTimeout },
      { shellIdleMs: 60000, settleMs: 150 }
    )
    const srv = await startServer(socket2, { store, broker: slow, terminals: terminalsFake() })
    try {
      let done = false
      const pending = call(socket2, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'x' }).then((r) => ((done = true), r))
      await waitFor(() => delivered.length === 1)
      await call(socket2, 'POST', '/turn-ended', ids.b, { lastMessage: 'parcial' })
      expect((await call(socket2, 'POST', '/busy', ids.b)).status).toBe(200)
      await new Promise((r) => setTimeout(r, 400))
      expect(done).toBe(false)
      await call(socket2, 'POST', '/turn-ended', ids.b, { lastMessage: 'final' })
      expect(await pending).toEqual({ status: 200, body: 'final' })
    } finally {
      slow.onExit(ids.b)
      await srv.close()
    }
  })

  it('corpo que nunca termina é encerrado com 408 pelo prazo de recebimento', async () => {
    const socket2 = join(dir, 'slow.sock')
    const srv = await startServer(socket2, { store, broker, terminals: terminalsFake() }, { bodyTimeoutMs: 200 })
    try {
      const out = await rawSocket(
        socket2,
        `POST /note/write HTTP/1.1\r\nhost: palco\r\n${HEADER_TOKEN}: ${tok(ids.a)}\r\ncontent-length: 100\r\ncontent-type: application/json\r\n\r\n{"na`
      )
      expect(out).toMatch(/^HTTP\/1\.1 408/)
    } finally {
      await srv.close()
    }
  })

  it('corpo acima do limite recebe 413 legível pelo cliente', async () => {
    const out = await rawSocket(
      socket,
      `POST /note/write HTTP/1.1\r\nhost: palco\r\n${HEADER_TOKEN}: ${tok(ids.a)}\r\ncontent-length: ${2 * 1024 * 1024}\r\ncontent-type: application/json\r\n\r\n{`
    )
    expect(out).toMatch(/^HTTP\/1\.1 413/)
    expect(out).toContain('corpo grande demais')
  })

  it('chunked acima do limite também recebe 413', async () => {
    const big = JSON.stringify({ name: 'Plano', content: 'x'.repeat(1024 * 1024 + 10) })
    const res = await new Promise<Res>((resolve) => {
      const req = http.request(
        { socketPath: socket, method: 'POST', path: '/note/write', headers: { [HEADER_TOKEN]: tok(ids.a), 'transfer-encoding': 'chunked', 'content-type': 'application/json' } },
        (r) => {
          let d = ''
          r.on('data', (c) => (d += c))
          r.on('end', () => resolve({ status: r.statusCode ?? 0, body: d }))
        }
      )
      req.on('error', () => resolve({ status: -1, body: '' }))
      req.end(big)
    })
    expect(res.status).toBe(413)
  })

  const brokenServer = (mode: 'abort' | 'silent'): Promise<{ path: string; close(): void }> =>
    new Promise((resolve) => {
      const path = join(dir, `broken-${mode}.sock`)
      const srv = net.createServer((sock) => {
        sock.once('data', () => {
          if (mode === 'abort') {
            sock.write('HTTP/1.1 200 OK\r\ncontent-length: 100\r\n\r\npartial')
            setTimeout(() => sock.destroy(), 30)
          }
        })
        sock.on('error', () => {})
      })
      srv.listen(path, () => resolve({ path, close: () => srv.close() }))
    })

  it('resposta que cai no meio vira erro com prefixo (exit 1) e não derruba o hook', async () => {
    const broken = await brokenServer('abort')
    try {
      const env = { PALCO_SOCKET: broken.path, PALCO_TOKEN: 'qualquer' }
      const r = await cli(['list'], env)
      expect(r.code).toBe(1)
      expect(r.err).toMatch(/^palco: /)
      const hook = await cli(['hook', 'claude-stop'], env, '{}')
      expect(hook.code).toBe(0)
      expect(hook.err).toBe('')
      expect((await cli(['hook', 'claude-busy'], env)).code).toBe(0)
    } finally {
      broken.close()
    }
  })

  it('servidor que aceita e não responde não prende o hook além do prazo curto', async () => {
    const silent = await brokenServer('silent')
    try {
      const started = Date.now()
      const r = await cli(['hook', 'claude-busy'], { PALCO_SOCKET: silent.path, PALCO_TOKEN: 'qualquer', PALCO_HOOK_TIMEOUT_MS: '300' })
      expect(r.code).toBe(0)
      expect(Date.now() - started).toBeLessThan(3000)
    } finally {
      silent.close()
    }
  })

  it('hook claude-busy chega ao broker via /busy', async () => {
    const run = cli(['ask', 'Beta', 'oi'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.a) })
    await waitFor(() => delivered.length === 1)
    expect((await cli(['hook', 'claude-busy'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.b) })).code).toBe(0)
    await call(socket, 'POST', '/turn-ended', ids.b, { lastMessage: 'fim' })
    expect((await run).out.trim()).toBe('fim')
  })
})

describe('prontidão e cancelamento', () => {
  it('/ready, /busy e /turn-ended marcam o próprio terminal como pronto', async () => {
    expect((await call(socket, 'POST', '/ready', ids.b)).status).toBe(200)
    expect(readied).toEqual([ids.b])
    await call(socket, 'POST', '/busy', ids.c)
    await call(socket, 'POST', '/turn-ended', ids.a, {})
    expect(readied).toEqual([ids.b, ids.c, ids.a])
    expect((await call(socket, 'POST', '/ready', 'sem-token')).status).toBe(401)
    expect(readied).toHaveLength(3)
  })

  it('hook claude-ready do CLI chega em /ready', async () => {
    const r = await cli(['hook', 'claude-ready'], { PALCO_SOCKET: socket, PALCO_TOKEN: tok(ids.b) })
    expect(r.code).toBe(0)
    expect(readied).toEqual([ids.b])
  })

  it('cliente que desconecta cancela o ask mas mantém o alvo drenando até turn-ended', async () => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/ask', headers: { [HEADER_TOKEN]: tok(ids.a), 'content-type': 'application/json' } })
    req.on('error', () => {})
    req.end(JSON.stringify({ to: 'Beta', prompt: 'primeiro' }))
    await waitFor(() => delivered.length === 1)
    expect(broker.pending()).toEqual([{ from: ids.a, to: ids.b }])
    // Enfileira outro ask (do mesmo alvo) e então derruba a conexão do primeiro.
    const second = call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'segundo' })
    await new Promise((r) => setTimeout(r, 50))
    req.destroy()
    await waitFor(() => broker.pending().length === 1)
    expect(delivered).toEqual([[ids.b, 'primeiro']])
    await call(socket, 'POST', '/turn-ended', ids.b, { lastMessage: 'resposta descartada' })
    await waitFor(() => delivered.length === 2)
    expect(delivered[1]).toEqual([ids.b, 'segundo'])
    expect(broker.pending()).toEqual([{ from: ids.a, to: ids.b }])
    await call(socket, 'POST', '/turn-ended', ids.b, { lastMessage: 'resp' })
    expect(await second).toEqual({ status: 200, body: 'resp' })
  })
})

describe('geração e prontidão explícita', () => {
  it('hook autenticado numa geração que acabou antes do fim do corpo é recusado (401) e não marca nada', async () => {
    const out = await new Promise<string>((resolve) => {
      const sock = net.connect(socket)
      let data = ''
      sock.on('data', (c) => (data += c))
      sock.on('close', () => resolve(data))
      const body = '{"lastMessage":"velha"}'
      sock.write(`POST /turn-ended HTTP/1.1\r\nhost: palco\r\n${HEADER_TOKEN}: ${tok(ids.b)}\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n`)
      // Cabeçalhos autenticados na geração 1; o terminal reinicia (geração 2) antes de o corpo chegar.
      setTimeout(() => {
        gens.set(ids.b, 2)
        sock.write(body)
      }, 100)
      setTimeout(() => sock.destroy(), 1500)
    })
    expect(out).toMatch(/^HTTP\/1\.1 401/)
    expect(readied).toEqual([])
  })

  it('o mesmo vale para /ready e /busy', async () => {
    for (const path of ['/ready', '/busy']) {
      const out = await new Promise<string>((resolve) => {
        const sock = net.connect(socket)
        let data = ''
        sock.on('data', (c) => (data += c))
        sock.on('close', () => resolve(data))
        gens.set(ids.b, 1)
        sock.write(`POST ${path} HTTP/1.1\r\nhost: palco\r\n${HEADER_TOKEN}: ${tok(ids.b)}\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\r\n{`)
        setTimeout(() => {
          gens.set(ids.b, gens.get(ids.b)! + 1)
          sock.write('}')
        }, 100)
        setTimeout(() => sock.destroy(), 1200)
      })
      expect(out, path).toMatch(/^HTTP\/1\.1 401/)
    }
    expect(readied).toEqual([])
  })

  it('ask para agente que não ficou pronto responde 503 com erro claro, sem enfileirar nada', async () => {
    states.set(ids.b, 'failed')
    const res = await call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'oi' })
    expect(res.status).toBe(503)
    expect(res.body).toBe("agente não ficou pronto: 'Beta' ainda não sinalizou prontidão")
    expect(delivered).toEqual([])
    expect(broker.pending()).toEqual([])
  })

  it('ask pendente que falha por prontidão (broker resolve exited) vira o mesmo 503', async () => {
    const pending = call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'oi' })
    await waitFor(() => delivered.length === 1)
    states.set(ids.b, 'failed')
    broker.onExit(ids.b) // é o que o main faz quando o manager avisa onDeliveryFailed
    const res = await pending
    expect(res.status).toBe(503)
    expect(res.body).toMatch(/^agente não ficou pronto/)
  })

  it('depois que o agente fica pronto, o ask volta a funcionar', async () => {
    states.set(ids.b, 'failed')
    expect((await call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'x' })).status).toBe(503)
    states.set(ids.b, 'ready')
    const pending = call(socket, 'POST', '/ask', ids.a, { to: 'Beta', prompt: 'x' })
    await waitFor(() => delivered.length === 1)
    await call(socket, 'POST', '/turn-ended', ids.b, { lastMessage: 'ok' })
    expect(await pending).toEqual({ status: 200, body: 'ok' })
  })
})
