import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { FloorService } from '../../src/main/floors/floor-service'
import { PortalClosedError } from '../../src/main/portal/portal-manager'
import { startServer } from '../../src/main/server/http-server'
import { HEADER_TOKEN } from '../../src/shared/auth'
import type { BandAskItem, TerminalNode } from '../../src/shared/model'

interface Res { status: number; body: string }

const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null'
}
const saved: Record<string, string | undefined> = {}
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim()
const commitFile = (cwd: string, file: string, content: string, message: string): void => {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-m', message)
}

let sandbox: string
let repo: string
let socket: string
let store: WorkspaceStore
let broker: AskBroker
let server: { close(): Promise<void> }
let delivered: Array<[string, string]>
let running: Set<string>
let spawned: TerminalNode[]
let disposed: string[]
let tokens: Map<string, string>
let portals: Record<'navigate' | 'snapshot' | 'click' | 'fill' | 'text' | 'screenshot' | 'back' | 'reload' | 'waitForLoad', ReturnType<typeof vi.fn>>
let ids: { maestro: string; a: string; b: string; note: string; portal: string; far: string }

function call(method: string, path: string, who: string | undefined, body?: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const headers: Record<string, string> = {}
    if (who !== undefined) headers[HEADER_TOKEN] = tokens.get(who) ?? who
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
const post = (path: string, who: string, body: unknown): Promise<Res> => call('POST', path, who, body)

const waitFor = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout esperando condição')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const term = (name: string, x: number, over: Partial<TerminalNode> = {}): TerminalNode & { id?: never } =>
  ({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: repo, pos: { x, y: 50 }, size: { w: 400, h: 300 }, ...over }) as never

beforeEach(async () => {
  for (const [k, v] of Object.entries(IDENTITY)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'palco-coordination-')))
  repo = join(sandbox, 'projeto')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  commitFile(repo, 'base.txt', 'base\n', 'inicial')

  socket = join(sandbox, 'palco.sock')
  store = new WorkspaceStore(join(sandbox, 'ws.json'))
  const add = (n: ReturnType<typeof term>): string => store.addNode(n as never)
  ids = {
    maestro: add(term('Maestro', 100, { agent: 'claude', command: 'claude', maestro: true })),
    a: add(term('Alfa', 700)),
    b: add(term('Beta', 1200)),
    note: store.addNode({ kind: 'note', floorId: null, name: 'Plano', content: 'x', pos: { x: 0, y: 500 }, size: { w: 300, h: 200 } }),
    portal: store.addNode({ kind: 'portal', floorId: null, name: 'Web', url: 'about:blank', pos: { x: 0, y: 800 }, size: { w: 400, h: 300 } }),
    far: add(term('Longe', 3000))
  }
  store.connect(ids.maestro, ids.a)
  store.connect(ids.maestro, ids.b)
  store.connect(ids.maestro, ids.note)
  store.connect(ids.maestro, ids.portal)

  delivered = []
  running = new Set([ids.maestro, ids.a, ids.b, ids.far])
  spawned = []
  disposed = []
  tokens = new Map([ids.maestro, ids.a, ids.b, ids.far].map((id) => [id, `tok-${id}`]))
  broker = new AskBroker(
    { deliver: (id, t) => delivered.push([id, t]), screenText: () => 'tela', agentOf: () => 'shell', setTimeout, clearTimeout },
    { shellIdleMs: 60000, settleMs: 0 }
  )
  portals = {
    navigate: vi.fn(async () => 'https://x.example/'),
    snapshot: vi.fn(async () => '[e1] botão "ok"'),
    click: vi.fn(async () => 'ok'),
    fill: vi.fn(async () => 'ok'),
    text: vi.fn(async () => 'texto'),
    screenshot: vi.fn(async () => '/tmp/x.png'),
    back: vi.fn(async () => 'https://a/'),
    reload: vi.fn(async () => 'https://a/'),
    waitForLoad: vi.fn(async () => 'loaded')
  }
  const terminals = {
    screenText: () => 'tela',
    isRunning: (id: string) => running.has(id),
    agentState: () => 'ready' as const,
    markReady: () => {},
    notePromptHook: () => {},
    identify: (t: string) => {
      const id = [...tokens].find(([, v]) => v === t)?.[0]
      return id === undefined ? undefined : { id, gen: 1 }
    },
    spawn: (node: TerminalNode) => {
      spawned.push(node)
      running.add(node.id)
    },
    dispose: (id: string) => {
      disposed.push(id)
      running.delete(id)
      broker.onExit(id)
    }
  }
  const floors = new FloorService({ store, terminals, portals: { unregister: () => {} } })
  server = await startServer(socket, { store, broker, terminals, portals: portals as never, floors })
})

afterEach(async () => {
  try {
    store?.flush()
    for (const id of Object.values(ids ?? {})) broker?.onExit(id)
    await server?.close()
  } finally {
    for (const k of Object.keys(IDENTITY)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    rmSync(sandbox, { recursive: true, force: true })
    rmSync(`${repo}.floors`, { recursive: true, force: true })
  }
})

const nodeNamed = (name: string) => Object.values(store.get().nodes).find((n) => n.name === name)

describe('POST /recruit', () => {
  it('cria o terminal à direita do chamador, conectado a ele, e o sobe', async () => {
    const res = await post('/recruit', ids.maestro, { name: 'Rev' })
    expect(res).toEqual({ status: 200, body: 'OK: Rev recrutado (o ask espera ele ficar pronto)' })
    const rev = nodeNamed('Rev') as TerminalNode
    expect(rev.kind).toBe('terminal')
    expect(rev.agent).toBe('claude')
    expect(rev.command).toBe('claude')
    expect(rev.cwd).toBe(repo)
    expect(rev.floorId).toBeNull()
    expect(rev.pos.y).toBe(50)
    expect(rev.pos.x).toBeGreaterThanOrEqual(100 + 400 + 40)
    expect(spawned.map((n) => n.id)).toEqual([rev.id])
    expect(store.get().connections.some((c) => [c.a, c.b].includes(rev.id) && [c.a, c.b].includes(ids.maestro))).toBe(true)
  })

  it('não promete prontidão para other e explica o tipo desconhecido no ask', async () => {
    const created = await post('/recruit', ids.maestro, { name: 'Gen', agent: 'other', command: 'opencode' })
    expect(created).toEqual({ status: 200, body: 'OK: Gen recrutado (o palco não sabe quando esse tipo fica pronto; selecione o tipo de agente)' })
    expect((await post('/ask', ids.maestro, { to: 'Gen', prompt: 'oi' })).body).toContain('tipo desconhecido')
    const listed = JSON.parse((await call('GET', '/list', ids.maestro)).body) as { agents: Array<{ name: string; agent: string }> }
    expect(listed.agents.find(agent => agent.name === 'Gen')?.agent).toBe('other')
  })

  it('recruit resolve alias do shell e grava o agente efetivo', async () => {
    const previousHome = process.env.HOME, previousShell = process.env.SHELL
    try {
      writeFileSync(join(sandbox, '.bashrc'), `alias clauded='claude --dangerously-skip-permissions "$@"'\n`)
      process.env.HOME = sandbox; process.env.SHELL = '/bin/bash'
      const result = await post('/recruit', ids.maestro, { name: 'Wrapper', command: 'clauded' })
      expect(result.status).toBe(200)
      expect(nodeNamed('Wrapper')).toMatchObject({ agent: 'claude', command: 'clauded' })
      expect(result.body).toContain('o ask espera ele ficar pronto')
    } finally {
      if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome
      if (previousShell === undefined) delete process.env.SHELL; else process.env.SHELL = previousShell
    }
  })

  it('fica em x = chamador + largura + 40 quando livre; senão no próximo espaço livre à direita', async () => {
    store.removeNode(ids.a) // libera o espaço ao redor
    store.removeNode(ids.b)
    await post('/recruit', ids.maestro, { name: 'Um' })
    expect(nodeNamed('Um')!.pos.x).toBe(100 + 400 + 40)
    await post('/recruit', ids.maestro, { name: 'Dois' })
    const um = nodeNamed('Um')!, dois = nodeNamed('Dois')!
    expect(dois.pos.x).toBeGreaterThanOrEqual(um.pos.x + um.size.w + 40 - 1)
    expect(dois.pos.y).toBe(50)
  })

  it('agente codex, comando próprio de um token e comando inválido', async () => {
    expect((await post('/recruit', ids.maestro, { name: 'Cx', agent: 'codex' })).status).toBe(200)
    expect((nodeNamed('Cx') as TerminalNode).command).toBe('codex')
    expect((await post('/recruit', ids.maestro, { name: 'Meu', agent: 'codex', command: 'meu-codex' })).status).toBe(200)
    expect((nodeNamed('Meu') as TerminalNode).command).toBe('meu-codex')
    const bad = await post('/recruit', ids.maestro, { name: 'Ruim', command: 'claude; rm -rf /' })
    expect(bad.status).toBe(400)
    expect(nodeNamed('Ruim')).toBeUndefined()
    expect((await post('/recruit', ids.maestro, { name: 'Ruim', agent: 'perl' })).status).toBe(400)
  })

  it('agente shell com command → 400 (o comando seria ignorado) e nada é criado', async () => {
    const res = await post('/recruit', ids.maestro, { name: 'Sh', agent: 'shell', command: 'vim' })
    expect(res.status).toBe(400)
    expect(res.body).toMatch(/shell não aceita command/)
    expect(nodeNamed('Sh')).toBeUndefined()
    expect(spawned).toEqual([])
    expect((await post('/recruit', ids.maestro, { name: 'Sh2', agent: 'shell' })).status).toBe(200)
  })

  it('nome repetido (sem diferenciar caixa) ganha (2) (skill palco-manager); nome ausente → 400', async () => {
    expect((await post('/recruit', ids.maestro, {})).status).toBe(400)
    expect((await post('/recruit', ids.maestro, { name: '   ' })).status).toBe(400)
    expect(spawned).toEqual([])
    const res = await post('/recruit', ids.maestro, { name: 'alfa' })
    expect(res.body).toContain('alfa (2)')
    expect(nodeNamed('alfa (2)')).toBeDefined()
  })

  it('dir próprio: existente vale, inexistente → 400', async () => {
    const dir = join(sandbox, 'outro')
    mkdirSync(dir)
    expect((await post('/recruit', ids.maestro, { name: 'D', dir })).status).toBe(200)
    expect((nodeNamed('D') as TerminalNode).cwd).toBe(dir)
    expect((await post('/recruit', ids.maestro, { name: 'E', dir: join(sandbox, 'nao-existe') })).status).toBe(400)
  })

  it('--floor: o nó nasce no floor, com cwd na worktree, e conectado ao chamador (conexão entre floors)', async () => {
    const created = await post('/floor/create', ids.maestro, { name: 'ui' })
    expect(created.status).toBe(200)
    const res = await post('/recruit', ids.maestro, { name: 'Rev', agent: 'codex', floor: 'ui' })
    expect(res.status).toBe(200)
    expect(res.body).toContain('Rev')
    const floor = Object.values(store.get().floors)[0]!
    const rev = nodeNamed('Rev') as TerminalNode
    expect(rev.floorId).toBe(floor.id)
    expect(rev.cwd).toBe(floor.dir)
    expect(store.get().connections.some((c) => [c.a, c.b].includes(rev.id) && [c.a, c.b].includes(ids.maestro))).toBe(true)
    expect((await post('/recruit', ids.maestro, { name: 'X', floor: 'nao-existe' })).status).toBe(404)
  })

  it('--band: entra na banda do floor; banda inexistente → 404', async () => {
    const band = store.createBand('time', [ids.a], null)
    store.connect(ids.maestro, band)
    expect((await post('/recruit', ids.maestro, { name: 'Novo', band: 'time' })).status).toBe(200)
    const members = (store.get().nodes[band] as { members: string[] }).members
    expect(members).toContain(nodeNamed('Novo')!.id)
    expect((await post('/recruit', ids.maestro, { name: 'Outro', band: 'fantasma' })).status).toBe(404)
    expect(nodeNamed('Outro')).toBeUndefined()
  })

  it('banda do mesmo floor que o chamador não alcança → 404', async () => {
    store.createBand('secreta', [ids.far], null)
    expect((await post('/recruit', ids.maestro, { name: 'Intruso', band: 'secreta' })).status).toBe(404)
  })

  it('sem token → 401', async () => {
    expect((await call('POST', '/recruit', undefined, { name: 'X' })).status).toBe(401)
  })
})

describe('POST /dismiss', () => {
  it('encerra e remove um terminal que o próprio chamador recrutou', async () => {
    await post('/recruit', ids.maestro, { name: 'Rev' })
    const rev = nodeNamed('Rev') as TerminalNode
    expect(rev.recruitedBy).toBe(ids.maestro)
    const res = await post('/dismiss', ids.maestro, { name: 'Rev' })
    expect(res.status).toBe(200)
    expect(disposed).toEqual([rev.id])
    expect(store.get().nodes[rev.id]).toBeUndefined()
  })

  it('terminal criado pela interface (ou por outro agente) → 403, nada é morto', async () => {
    // Sem o Modo Maestro (o Maestro encerra qualquer terminal alcançável).
    const chefe = store.addNode(term('Chefe', 3) as never)
    store.connect(chefe, ids.a)
    running.add(chefe)
    tokens.set(chefe, `tok-${chefe}`)
    const res = await post('/dismiss', chefe, { name: 'Alfa' })
    expect(res.status).toBe(403)
    expect(res.body).toMatch(/recrutou/)
    // recrutado por outro agente
    await post('/recruit', ids.a, { name: 'DaAlfa' })
    store.connect(chefe, nodeNamed('DaAlfa')!.id)
    expect((await post('/dismiss', chefe, { name: 'DaAlfa' })).status).toBe(403)
    expect(disposed).toEqual([])
    expect(store.get().nodes[ids.a]).toBeDefined()
  })

  it('o recrutado não encerra quem o recrutou', async () => {
    await post('/recruit', ids.maestro, { name: 'Rev' })
    const rev = nodeNamed('Rev')!
    tokens.set(rev.id, 'tok-rev')
    const res = await post('/dismiss', rev.id, { name: 'Maestro' })
    expect(res.status).toBe(403)
    expect(disposed).toEqual([])
  })

  it('terminal fora do alcance → 404; nota → 400; ele mesmo → 404', async () => {
    expect((await post('/dismiss', ids.maestro, { name: 'Longe' })).status).toBe(404)
    expect((await post('/dismiss', ids.maestro, { name: 'Plano' })).status).toBe(400)
    expect((await post('/dismiss', ids.maestro, { name: 'Maestro' })).status).toBe(404)
    expect(disposed).toEqual([])
    expect(store.get().nodes[ids.far]).toBeDefined()
  })
})

describe('bandas', () => {
  it('create: membros alcançáveis (e o chamador, se citar o próprio nome); o chamador fica conectado à banda', async () => {
    const res = await post('/band/create', ids.maestro, { name: 'time', members: ['Alfa', 'Beta', 'Maestro'] })
    expect(res.status).toBe(200)
    const band = nodeNamed('time') as { id: string; members: string[]; kind: string }
    expect(band.kind).toBe('band')
    expect(band.members).toEqual([ids.a, ids.b, ids.maestro])
    expect(store.get().connections.some((c) => [c.a, c.b].includes(band.id) && [c.a, c.b].includes(ids.maestro))).toBe(true)
  })

  it('create recusa membro fora do alcance, nota, banda e nome repetido', async () => {
    expect((await post('/band/create', ids.maestro, { name: 'x', members: ['Longe'] })).status).toBe(404)
    expect((await post('/band/create', ids.maestro, { name: 'x', members: ['Plano'] })).status).toBe(400)
    expect(nodeNamed('x')).toBeUndefined()
    await post('/band/create', ids.maestro, { name: 'time', members: ['Alfa'] })
    expect((await post('/band/create', ids.maestro, { name: 'Time', members: ['Beta'] })).status).toBe(409)
    expect((await post('/band/create', ids.maestro, { name: 'meta', members: ['time'] })).status).toBe(400)
  })

  it('add, remove e dissolve', async () => {
    // Skill: você entra na banda (a menos que --without-me).
    await post('/band/create', ids.maestro, { name: 'time', members: ['Alfa'] })
    const band = nodeNamed('time') as { id: string; members: string[] }
    expect((await post('/band/add', ids.maestro, { band: 'time', member: 'Beta' })).status).toBe(200)
    expect((store.get().nodes[band.id] as { members: string[] }).members).toEqual([ids.a, ids.maestro, ids.b])
    expect((await post('/band/remove', ids.maestro, { band: 'time', member: 'Alfa' })).status).toBe(200)
    expect((store.get().nodes[band.id] as { members: string[] }).members).toEqual([ids.maestro, ids.b])
    expect((await post('/band/add', ids.maestro, { band: 'time', member: 'Longe' })).status).toBe(404)
    expect((await post('/band/dissolve', ids.maestro, { band: 'time' })).status).toBe(200)
    expect(store.get().nodes[band.id]).toBeUndefined()
    expect((await post('/band/dissolve', ids.maestro, { band: 'time' })).status).toBe(404)
  })

  it("ask do Ground para um agente recrutado em outro floor (validação real)", async () => {
    expect((await post('/floor/create', ids.maestro, { name: 'ui' })).status).toBe(200)
    expect((await post('/recruit', ids.maestro, { name: 'Rev', agent: 'codex', floor: 'ui' })).status).toBe(200)
    const rev = nodeNamed('Rev')!.id
    running.add(rev)
    tokens.set(rev, `tok-${rev}`)
    const pending = post('/ask', ids.maestro, { to: 'Rev', prompt: 'rode pwd' })
    await waitFor(() => delivered.some(([id]) => id === rev))
    await post('/turn-ended', rev, { lastMessage: '/repo.floors/ui' })
    const res = await pending
    expect(res.status).toBe(200)
    expect(res.body).toContain('/repo.floors/ui')
  })

  it('list diz em que floor cada agente está', async () => {
    expect((await post('/floor/create', ids.maestro, { name: 'ui' })).status).toBe(200)
    expect((await post('/recruit', ids.maestro, { name: 'Rev', agent: 'codex', floor: 'ui' })).status).toBe(200)
    const list = JSON.parse((await call('GET', '/list', ids.maestro)).body) as { agents: Array<{ name: string; floor: string }> }
    expect(list.agents.find((a) => a.name === 'Rev')?.floor).toBe('ui')
    expect(list.agents.find((a) => a.name === 'Alfa')?.floor).toBe('ground')
  })

  it('ask à banda pergunta a cada membro (menos o chamador) e devolve BandAskItem[] na ordem', async () => {
    await post('/band/create', ids.maestro, { name: 'time', members: ['Alfa', 'Beta', 'Maestro'] })
    const pending = post('/ask', ids.maestro, { to: 'time', prompt: 'diga seu nome' })
    await waitFor(() => delivered.length === 2)
    expect(delivered.map(([id]) => id).sort()).toEqual([ids.a, ids.b].sort())
    expect(delivered.every(([, text]) => text === 'diga seu nome')).toBe(true)
    await post('/turn-ended', ids.b, { lastMessage: 'sou o Beta' })
    await post('/turn-ended', ids.a, { lastMessage: 'sou o Alfa' })
    const res = await pending
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body) as BandAskItem[]).toEqual([
      { name: 'Alfa', output: 'sou o Alfa' },
      { name: 'Beta', output: 'sou o Beta' }
    ])
  })

  it('membro que fecha durante o ask volta como {name, error} sem travar os outros; membro parado também', async () => {
    await post('/band/create', ids.maestro, { name: 'time', members: ['Alfa', 'Beta'] })
    const pending = post('/ask', ids.maestro, { to: 'time', prompt: 'oi' })
    await waitFor(() => delivered.length === 2)
    broker.onExit(ids.a)
    await post('/turn-ended', ids.b, { lastMessage: 'ok' })
    expect(JSON.parse((await pending).body)).toEqual([{ name: 'Alfa', error: 'exited' }, { name: 'Beta', output: 'ok' }])

    running.delete(ids.a)
    running.delete(ids.b)
    const second = await post('/ask', ids.maestro, { to: 'time', prompt: 'de novo' })
    expect(JSON.parse(second.body)).toEqual([{ name: 'Alfa', error: 'exited' }, { name: 'Beta', error: 'exited' }])
  })

  it('banda vazia (ou só o chamador) devolve []', async () => {
    // A rota recusa banda de um só (skill: pelo menos dois); o store ainda aceita.
    expect((await post('/band/create', ids.maestro, { name: 'sozinho', members: ['Maestro'] })).status).toBe(400)
    const solo = store.createBand('sozinho', [ids.maestro], null)
    store.connect(ids.maestro, solo)
    const res = await post('/ask', ids.maestro, { to: 'sozinho', prompt: 'oi' })
    expect(res).toMatchObject({ status: 200 })
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('banda fora do alcance → 404', async () => {
    store.createBand('longe', [ids.far], null)
    expect((await post('/ask', ids.maestro, { to: 'longe', prompt: 'oi' })).status).toBe(404)
  })
})

describe('floors', () => {
  it('create → list → land (repositório limpo): integra, remove a worktree, o floor e mata os terminais dele', async () => {
    const created = await post('/floor/create', ids.maestro, { name: 'ui' })
    expect(created.status).toBe(200)
    const info = JSON.parse(created.body) as { name: string; dir: string; branch: string }
    expect(info).toEqual({ name: 'ui', dir: `${repo}.floors/ui`, branch: 'palco/ui', git: true })
    expect(existsSync(info.dir)).toBe(true)

    const list = JSON.parse((await call('GET', '/floor/list', ids.maestro)).body) as Array<{ name: string; branch: string }>
    expect(list.map((f) => f.name)).toEqual(['Ground', 'ui'])

    await post('/recruit', ids.maestro, { name: 'Rev', floor: 'ui' })
    const rev = nodeNamed('Rev')!
    commitFile(info.dir, 'ui.txt', 'tela\n', 'tela nova')

    const land = await post('/floor/land', ids.maestro, { name: 'ui' })
    expect(land.status).toBe(200)
    expect(readFileSync(join(repo, 'ui.txt'), 'utf8')).toBe('tela\n')
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('palco: land palco/ui')
    expect(existsSync(info.dir)).toBe(false)
    expect(Object.keys(store.get().floors)).toEqual([])
    expect(store.get().nodes[rev.id]).toBeUndefined()
    expect(disposed).toContain(rev.id)
    expect(git(repo, 'branch', '--list', 'palco/ui')).toContain('palco/ui')
  })

  it('land com --delete-branch apaga a branch; com --keep-floor mantém o floor', async () => {
    await post('/floor/create', ids.maestro, { name: 'ui' })
    const dir = `${repo}.floors/ui`
    commitFile(dir, 'a.txt', 'x', 'a')
    expect((await post('/floor/land', ids.maestro, { name: 'ui', keepFloor: true, deleteBranch: true })).status).toBe(200)
    expect(Object.keys(store.get().floors)).toHaveLength(1)
    expect(existsSync(dir)).toBe(true)
    expect(git(repo, 'branch', '--list', 'palco/ui')).toBe('')
  })

  it('land com conflito: 409 com os arquivos, repositório limpo e floor preservado', async () => {
    await post('/floor/create', ids.maestro, { name: 'ui' })
    const dir = `${repo}.floors/ui`
    commitFile(dir, 'base.txt', 'do floor\n', 'floor')
    commitFile(repo, 'base.txt', 'do main\n', 'main')
    const res = await post('/floor/land', ids.maestro, { name: 'ui' })
    expect(res.status).toBe(409)
    expect(res.body).toMatch(/conflito/)
    expect(res.body).toContain('base.txt')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(Object.keys(store.get().floors)).toHaveLength(1)
  })

  it('floor sujo: land recusa; delete recusa sem force e funciona com force', async () => {
    await post('/floor/create', ids.maestro, { name: 'ui' })
    const dir = `${repo}.floors/ui`
    writeFileSync(join(dir, 'rascunho.txt'), 'x')
    const land = await post('/floor/land', ids.maestro, { name: 'ui' })
    expect(land.status).toBe(409)
    expect(land.body).toMatch(/mudanças não commitadas/)
    const del = await post('/floor/delete', ids.maestro, { name: 'ui' })
    expect(del.status).toBe(409)
    expect(existsSync(dir)).toBe(true)
    expect(Object.keys(store.get().floors)).toHaveLength(1)
    await post('/recruit', ids.maestro, { name: 'Rev', floor: 'ui' })
    const rev = nodeNamed('Rev')!
    expect(disposed).toEqual([])
    const forced = await post('/floor/delete', ids.maestro, { name: 'ui', force: true })
    expect(forced.status).toBe(200)
    expect(existsSync(dir)).toBe(false)
    expect(Object.keys(store.get().floors)).toEqual([])
    expect(disposed).toEqual([rev.id])
  })

  it('delete com branch não integrada recusa; keepBranch preserva a branch', async () => {
    await post('/floor/create', ids.maestro, { name: 'ui' })
    commitFile(`${repo}.floors/ui`, 'a.txt', 'x', 'a')
    expect((await post('/floor/delete', ids.maestro, { name: 'ui' })).status).toBe(409)
    expect((await post('/floor/delete', ids.maestro, { name: 'ui', keepBranch: true })).status).toBe(200)
    expect(git(repo, 'branch', '--list', 'palco/ui')).toContain('palco/ui')
  })

  it('create duplicado → 409; fora de um repositório → andar simples; nome inválido → 400', async () => {
    expect((await post('/floor/create', ids.maestro, { name: 'ui' })).status).toBe(200)
    expect((await post('/floor/create', ids.maestro, { name: 'UI' })).status).toBe(409)
    expect((await post('/floor/create', ids.maestro, { name: '../..' })).status).toBe(400)
    store.patchNode(ids.a, {}) // sem efeito; o nó Alfa abaixo roda fora de um repositório
    const outside = store.addNode(term('Fora', 1, { cwd: sandbox, maestro: true }) as never)
    running.add(outside)
    tokens.set(outside, `tok-${outside}`)
    // Skill palco-workspace: fora de um repositório, cria um andar simples e a resposta diz isso.
    const res = await post('/floor/create', outside, { name: 'x' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ git: false, dir: sandbox })
    expect(res.body).toContain('não é um repositório git')
  })

  it('land e delete de um floor: só o Maestro, e só a partir do térreo', async () => {
    expect((await post('/floor/create', ids.maestro, { name: 'a' })).status).toBe(200)
    expect((await post('/floor/create', ids.maestro, { name: 'b' })).status).toBe(200)
    const floorA = Object.values(store.get().floors).find((f) => f.name === 'a')!
    const inA = store.addNode(term('NoA', 2, { floorId: floorA.id, cwd: floorA.dir }) as never)
    running.add(inA)
    tokens.set(inA, `tok-${inA}`)
    for (const path of ['/floor/land', '/floor/delete']) {
      const res = await post(path, inA, { name: 'a', force: true })
      expect(res.status).toBe(403)
      expect(res.body).toContain('Maestro')
    }
    const maestroInA = store.addNode(term('MaestroA', 3, { floorId: floorA.id, cwd: floorA.dir, maestro: true }) as never)
    running.add(maestroInA)
    tokens.set(maestroInA, `tok-${maestroInA}`)
    for (const path of ['/floor/land', '/floor/delete']) {
      const res = await post(path, maestroInA, { name: 'a', force: true })
      expect(res.status).toBe(403)
      expect(res.body).toContain('térreo')
    }
    expect(Object.values(store.get().floors).some((f) => f.name === 'a')).toBe(true)
    expect((await post('/floor/delete', ids.maestro, { name: 'b' })).status).toBe(200)
  })

  it('floor inexistente → 404 em land, delete e status', async () => {
    for (const path of ['/floor/land', '/floor/delete']) expect((await post(path, ids.maestro, { name: 'nao-existe' })).status).toBe(404)
    expect((await post('/floor/status', ids.maestro, { floor: 'nao-existe', state: 'done' })).status).toBe(404)
  })

  it('status: define, atualiza só o progresso, limpa; sem floor usa o do chamador; Ground sem floor → 400', async () => {
    await post('/floor/create', ids.maestro, { name: 'ui' })
    const floor = Object.values(store.get().floors)[0]!
    expect((await post('/floor/status', ids.maestro, { floor: 'ui', state: 'working', progress: '1/3' })).status).toBe(200)
    expect(store.get().floors[floor.id]!.status).toEqual({ state: 'working', progress: '1/3' })
    expect((await post('/floor/status', ids.maestro, { floor: 'ui', progress: '2/3' })).status).toBe(200)
    expect(store.get().floors[floor.id]!.status).toEqual({ state: 'working', progress: '2/3' })
    expect((await post('/floor/status', ids.maestro, { floor: 'ui', clear: true })).status).toBe(200)
    expect(store.get().floors[floor.id]!.status).toBeUndefined()
    // No térreo sem --floor, o andar do chamador é o térreo: publica a linha dele.
    expect((await post('/floor/status', ids.maestro, { state: 'done' })).status).toBe(200)
    expect(store.get().groundStatus).toEqual({ state: 'done' })
    // chamador dentro do floor: sem `floor`, usa o dele
    await post('/recruit', ids.maestro, { name: 'Rev', floor: 'ui' })
    const rev = nodeNamed('Rev')!
    tokens.set(rev.id, 'tok-rev')
    expect((await post('/floor/status', rev.id, { state: 'review' })).status).toBe(200)
    expect(store.get().floors[floor.id]!.status).toEqual({ state: 'review' })
    expect((await post('/floor/status', ids.maestro, { floor: 'ui', clear: true })).status).toBe(200)
    // Sem texto nem opções: imprime o status atual.
    expect((await post('/floor/status', ids.maestro, { floor: 'ui' })).body).toContain('sem status')
  })
})

describe("CLI palco", () => {
  let cliPath: string
  beforeAll(async () => {
    cliPath = join(mkdtempSync(join(tmpdir(), 'palco-cli2-')), 'palco.cjs')
    await build({ entryPoints: ['src/cli/palco.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: cliPath, logLevel: 'silent' })
  })
  afterAll(() => rmSync(join(cliPath, '..'), { recursive: true, force: true }))

  const cli = (who: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> =>
    new Promise((resolve) => {
      execFile('node', [cliPath, ...args], { env: { PATH: process.env.PATH ?? '', PALCO_SOCKET: socket, PALCO_TOKEN: tokens.get(who) ?? who } }, (error, out, err) => {
        resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out, err })
      })
    })

  it('recruit, band e dismiss de ponta a ponta', async () => {
    const r = await cli(ids.maestro, 'recruit', 'Rev', '--agent', 'codex')
    expect(r).toMatchObject({ code: 0, out: 'OK: Rev recrutado (o ask espera ele ficar pronto)\n' })
    expect((nodeNamed('Rev') as TerminalNode).agent).toBe('codex')
    expect((await cli(ids.maestro, 'band', 'create', 'time', 'Alfa', 'Beta')).code).toBe(0)
    expect((await cli(ids.maestro, 'band', 'add', 'time', 'Rev')).code).toBe(0)
    expect((await cli(ids.maestro, 'band', 'remove', 'time', 'Alfa')).code).toBe(0)
    expect((await cli(ids.maestro, 'dismiss', 'Rev')).out).toBe('OK: Rev encerrado\n')
    expect((await cli(ids.maestro, 'band', 'dissolve', 'time')).code).toBe(0)
    const bad = await cli(ids.maestro, 'dismiss', 'Longe')
    expect(bad.code).toBe(1)
    expect(bad.err).toMatch(/^palco: /)
  })

  it('ask a uma banda imprime o JSON de BandAskItem[]', async () => {
    await cli(ids.maestro, 'band', 'create', 'time', 'Alfa', 'Beta')
    const run = cli(ids.maestro, 'ask', 'time', 'oi')
    await waitFor(() => delivered.length === 2)
    await post('/turn-ended', ids.a, { lastMessage: 'A' })
    await post('/turn-ended', ids.b, { lastMessage: 'B' })
    const r = await run
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toEqual([{ name: 'Alfa', output: 'A' }, { name: 'Beta', output: 'B' }])
  })

  it('floor create / list / status / land e portal', async () => {
    const created = await cli(ids.maestro, 'floor', 'create', 'ui')
    expect(created.code).toBe(0)
    expect(JSON.parse(created.out)).toMatchObject({ name: 'ui', branch: 'palco/ui' })
    expect(JSON.parse((await cli(ids.maestro, 'floor', 'list', '--json')).out)).toHaveLength(2)
    expect((await cli(ids.maestro, 'floor', 'list')).out).toMatch(/^- name: "Ground"[\s\S]*- name: "ui"\n  branch: "palco\/ui" \(de main\)/)
    expect((await cli(ids.maestro, 'floor', 'status', 'meio caminho', '--floor', 'ui', '--state', 'working', '--progress', '1/2')).code).toBe(0)
    expect((await cli(ids.maestro, 'floor', 'land', 'ui')).out).toMatch(/^OK: palco\/ui integrado em main/)
    const portal = await cli(ids.maestro, 'portal', 'Web', 'click', 'e5')
    expect(portal).toMatchObject({ code: 0, out: 'ok\n' })
    expect(portals.click).toHaveBeenCalledWith(ids.portal, 'e5')
    const closed = (portals.text.mockRejectedValueOnce(new PortalClosedError()), await cli(ids.maestro, 'portal', 'Web', 'text'))
    expect(closed).toMatchObject({ code: 1, err: 'palco: erro: portal não está aberto\n' })
  })

  it("a ajuda e a mensagem de uso listam os comandos de coordenação", async () => {
    const help = await cli(ids.maestro, 'help')
    const usage = await cli(ids.maestro, 'floor', 'explodir')
    for (const text of [help.out, usage.err]) {
      for (const word of ['recruit', 'dismiss', 'band create', 'band add', 'band remove', 'band dissolve', 'floor create', 'floor list', 'floor land', 'floor delete', 'floor status', 'portal']) {
        expect(text, word).toContain(word)
      }
    }
    expect(usage.code).toBe(1)
  })
})

describe('POST /portal', () => {
  it('create aguarda o carregamento e avisa quando o prazo termina', async () => {
    portals.waitForLoad.mockResolvedValueOnce('timeout')
    const res = await post('/portal', ids.maestro, { name: 'Novo', action: 'create', args: ['https://example.test'] })
    expect(res).toEqual({ status: 200, body: 'Criado o portal "Novo"\na página ainda está carregando' })
    expect(portals.waitForLoad).toHaveBeenCalledWith(expect.any(String), 15000)
  })

  it('create retorna falha de carregamento como erro', async () => {
    portals.waitForLoad.mockRejectedValueOnce(new Error('falha ao carregar https://broken.test: ERR_NAME_NOT_RESOLVED'))
    const res = await post('/portal', ids.maestro, { name: 'Falhou', action: 'create', args: ['https://broken.test'] })
    expect(res).toEqual({ status: 400, body: 'falha ao carregar https://broken.test: ERR_NAME_NOT_RESOLVED' })
  })

  it('delega ao PortalManager com o id do nó', async () => {
    expect(await post('/portal', ids.maestro, { name: 'Web', action: 'navigate', args: ['https://x.example'] })).toEqual({ status: 200, body: 'https://x.example/' })
    expect(portals.navigate).toHaveBeenCalledWith(ids.portal, 'https://x.example')
    expect((await post('/portal', ids.maestro, { name: 'Web', action: 'snapshot', args: [] })).body).toBe('[e1] botão "ok"')
    await post('/portal', ids.maestro, { name: 'Web', action: 'click', args: ['e5'] })
    expect(portals.click).toHaveBeenCalledWith(ids.portal, 'e5')
    await post('/portal', ids.maestro, { name: 'Web', action: 'fill', args: ['#q', 'abc'] })
    expect(portals.fill).toHaveBeenCalledWith(ids.portal, '#q', 'abc')
    await post('/portal', ids.maestro, { name: 'Web', action: 'text', args: [] })
    await post('/portal', ids.maestro, { name: 'Web', action: 'back', args: [] })
    await post('/portal', ids.maestro, { name: 'Web', action: 'reload', args: [] })
    await post('/portal', ids.maestro, { name: 'Web', action: 'screenshot', args: ['/tmp/x.png'] })
    expect(portals.screenshot).toHaveBeenCalledWith(ids.portal, '/tmp/x.png')
    await post('/portal', ids.maestro, { name: 'Web', action: 'screenshot', args: [] })
    expect(portals.screenshot).toHaveBeenLastCalledWith(ids.portal, undefined)
    expect(portals.text).toHaveBeenCalledOnce()
  })

  it('portal fechado (nó fora da tela) → 409, sem travar', async () => {
    portals.snapshot.mockRejectedValueOnce(new PortalClosedError())
    const res = await post('/portal', ids.maestro, { name: 'Web', action: 'snapshot', args: [] })
    expect(res).toEqual({ status: 409, body: 'portal não está aberto' })
  })

  it('erro da página → 400 com a mensagem', async () => {
    portals.click.mockRejectedValueOnce(new Error('elemento não encontrado: e9'))
    const res = await post('/portal', ids.maestro, { name: 'Web', action: 'click', args: ['e9'] })
    expect(res).toEqual({ status: 400, body: 'elemento não encontrado: e9' })
  })

  it('fora do alcance → 404; não é portal → 400; ação ou argumentos inválidos → 400', async () => {
    const far = store.addNode({ kind: 'portal', floorId: null, name: 'Longe-Web', url: 'about:blank', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
    expect(far).toBeTruthy()
    expect((await post('/portal', ids.maestro, { name: 'Longe-Web', action: 'text', args: [] })).status).toBe(404)
    expect((await post('/portal', ids.maestro, { name: 'Alfa', action: 'text', args: [] })).status).toBe(400)
    expect((await post('/portal', ids.maestro, { name: 'Web', action: 'explodir', args: [] })).status).toBe(400)
    expect((await post('/portal', ids.maestro, { name: 'Web', action: 'click', args: [] })).status).toBe(400)
    expect((await post('/portal', ids.maestro, { name: 'Web', action: 'click', args: [1] })).status).toBe(400)
    expect(portals.click).not.toHaveBeenCalled()
  })
})
