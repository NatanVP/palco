// Contrato entre as rotas e as skills de coordenação e workspace, verificado pelo socket real.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../../src/main/accounts/account-store'
import { AgentCatalog, PresetStore } from '../../src/main/agents/presets'
import { RoleStore } from '../../src/main/agents/roles'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { FloorService } from '../../src/main/floors/floor-service'
import { PartituraStore } from '../../src/main/partituras/partitura-store'
import { startServer } from '../../src/main/server/http-server'
import { HEADER_TOKEN } from '../../src/shared/auth'
import type { TerminalNode } from '../../src/shared/model'

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim()

let dir: string, repo: string, socket: string
let store: WorkspaceStore
let server: { close(): Promise<void> }
let tokens: Map<string, string>
let spawned: TerminalNode[], disposed: string[], notified: Array<[string, string]>
let catalog: AgentCatalog, accounts: AccountStore, partituras: PartituraStore
let me: string, alfa: string, beta: string

const post = (path: string, who: string, body?: unknown): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const req = http.request({ socketPath: socket, method: path.startsWith('GET ') ? 'GET' : 'POST', path: path.replace(/^GET /, ''), headers: { [HEADER_TOKEN]: tokens.get(who)!, ...(payload ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (c) => (data += c))
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
  })
  req.on('error', reject)
  req.end(payload)
})
const node = (name: string) => Object.values(store.get().nodes).find((n) => n.name === name)
const term = (name: string, x: number, over: Partial<TerminalNode> = {}): string => {
  const id = store.addNode({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: repo, pos: { x, y: 0 }, size: { w: 400, h: 300 }, ...over } as never)
  tokens.set(id, `tok-${id}`)
  return id
}

beforeEach(async () => {
  Object.assign(process.env, IDENTITY)
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'palco-manager-routes-')))
  repo = join(dir, 'projeto')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'inicial')
  socket = join(dir, 's.sock')
  store = new WorkspaceStore(join(dir, 'ws.json'))
  tokens = new Map()
  spawned = []; disposed = []; notified = []
  me = term('Eu', 0, { agent: 'claude', command: 'claude', maestro: true })
  alfa = term('Alfa', 500)
  beta = term('Beta', 1000)
  store.connect(me, alfa)
  store.connect(me, beta)
  const roles = new RoleStore(join(dir, 'roles'))
  catalog = new AgentCatalog(new PresetStore(join(dir, 'presets.json'), roles), roles)
  accounts = new AccountStore(join(dir, 'accounts.json'))
  partituras = new PartituraStore(join(dir, 'partituras'))
  const terminals = {
    screenText: () => '', isRunning: () => true, agentState: () => 'ready' as const, markReady: () => {}, notePromptHook: () => {},
    identify: (t: string) => { const id = [...tokens].find(([, v]) => v === t)?.[0]; return id === undefined ? undefined : { id, gen: 1 } },
    spawn: (n: TerminalNode) => { spawned.push(n) },
    dispose: (id: string) => { disposed.push(id) }
  }
  const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout })
  const floors = new FloorService({ store, terminals })
  server = await startServer(socket, { store, broker, terminals, floors, agents: catalog, accounts, partituras, notifyUser: (t, b) => void notified.push([t, b]) })
})

afterEach(async () => {
  await server.close()
  store.flush()
  rmSync(dir, { recursive: true, force: true })
  rmSync(`${repo}.floors`, { recursive: true, force: true })
})

describe('recruit (skill palco-manager)', () => {
  it('sem preset nem comando: cópia de você (agente, comando e conta); --icon e --color', async () => {
    const work = accounts.add({ name: 'Trabalho', agent: 'claude', configDir: join(dir, 'cc') })
    store.setTerminalAccount(me, work.id)
    expect((await post('/recruit', me, { name: 'Lince', icon: 'brain', color: 'blue' })).status).toBe(200)
    expect(node('Lince')).toMatchObject({ agent: 'claude', command: 'claude', accountId: work.id, icon: 'brain', color: '#007AFF', recruitedBy: me })
    // `palco list` mostra em que conta cada colega roda.
    const listed = JSON.parse((await post('GET /list', me)).body) as { agents: Array<{ name: string; account?: string }> }
    expect(listed.agents.find((a) => a.name === 'Lince')).toMatchObject({ account: 'Trabalho' })
    expect((await post('/recruit', me, { name: 'X', color: 'cor-nenhuma' })).status).toBe(400)
  })

  it('--preset com --role (o role vence) e --account; conta de outro CLI é recusada', async () => {
    catalog.roles.create('Escritor de Testes', 'Escreva testes.')
    catalog.presets.create({ name: 'Codex', command: 'codex' })
    accounts.add({ name: 'Trabalho', agent: 'codex', configDir: join(dir, 'cx') })
    expect((await post('/recruit', me, { name: 'Gavião', preset: 'Codex', role: 'Escritor de Testes', account: 'Trabalho' })).status).toBe(200)
    expect(node('Gavião')).toMatchObject({ agent: 'codex', role: 'escritor-de-testes', accountId: accounts.byName('Trabalho')!.id })
    accounts.add({ name: 'Pessoal', agent: 'claude', configDir: join(dir, 'pp') })
    expect((await post('/recruit', me, { name: 'Y', preset: 'Codex', account: 'Pessoal' })).status).toBe(404)
  })

  it('você numa banda: o recruta no seu andar entra nela em vez de ganhar corda', async () => {
    expect((await post('/band/create', me, { name: 'Time' })).status).toBe(200)
    const band = node('Time') as { id: string; members: string[] }
    expect(band.members.sort()).toEqual([me, alfa, beta].sort())
    await post('/recruit', me, { name: 'Novo' })
    const novo = node('Novo')!
    expect((store.get().nodes[band.id] as { members: string[] }).members).toContain(novo.id)
    expect(store.get().connections.some((c) => [c.a, c.b].includes(novo.id) && [c.a, c.b].includes(me))).toBe(false)
  })

  it('--replace troca o agente no mesmo nó: cordas e posição ficam; nome novo renomeia', async () => {
    catalog.presets.create({ name: 'Codex', command: 'codex' })
    const before = store.get().nodes[alfa]!
    const r = await post('/recruit', me, { name: 'Codex', preset: 'Codex', replace: 'Alfa' })
    expect(r.status).toBe(200)
    expect(store.get().nodes[alfa]).toMatchObject({ name: 'Codex', agent: 'codex', command: 'codex', pos: before.pos })
    expect(disposed).toEqual([alfa])
    expect(spawned.map((n) => n.id)).toEqual([alfa])
    expect(store.get().connections.some((c) => [c.a, c.b].includes(alfa) && [c.a, c.b].includes(me))).toBe(true)
    expect((await post('/recruit', me, { replace: 'Beta' })).status).toBe(400)
    expect((await post('/recruit', me, { preset: 'Codex', replace: 'Beta', floor: 'x' })).status).toBe(400)
  })
})

describe('band, preset, role e partitura', () => {
  it('band create --without-me: banda coordenada de fora (ligada a você)', async () => {
    expect((await post('/band/create', me, { name: 'Revisores', members: ['Alfa', 'Beta'], withoutMe: true })).status).toBe(200)
    const band = node('Revisores') as { id: string; members: string[] }
    expect(band.members).toEqual([alfa, beta])
    expect(store.get().connections.some((c) => [c.a, c.b].includes(band.id) && [c.a, c.b].includes(me))).toBe(true)
    expect((await post('/band/create', me, { name: 'Solo', members: ['Alfa'], withoutMe: true })).status).toBe(400)
  })

  it('preset create (agente sai do comando), set e conta; responde com o preset como ficou', async () => {
    accounts.add({ name: 'Trabalho', agent: 'claude', configDir: join(dir, 'cc') })
    const created = JSON.parse((await post('/preset/create', me, { name: 'Claude Opus', command: 'claude', account: 'Trabalho' })).body)
    expect(created).toMatchObject({ name: 'Claude Opus', agent: 'claude', command: 'claude', account: 'Trabalho', accounts: ['Default', 'Trabalho'] })
    const set = JSON.parse((await post('/preset/set', me, { name: 'Claude Opus', newName: 'Opus', maestro: true, quickStart: false, account: 'Default' })).body)
    expect(set).toMatchObject({ name: 'Opus', maestro: true, quickStart: false })
    expect(set.account).toBeUndefined()
    // Linha inteira com flags e variáveis; o agente sai do programa.
    expect(JSON.parse((await post('/preset/set', me, { name: 'Opus', command: 'ANTHROPIC_BASE_URL=x claude --model opus' })).body)).toMatchObject({ agent: 'claude', command: 'ANTHROPIC_BASE_URL=x claude --model opus' })
    expect((await post('/preset/set', me, { name: 'Opus', command: 'claude; rm -rf ~' })).status).toBe(400)
    await post('/recruit', me, { name: 'Fish', command: 'fish -c "codex --yolo"' })
    expect(node('Fish')).toMatchObject({ agent: 'codex', command: 'fish -c "codex --yolo"' })
    await post('/recruit', me, { name: 'Gamma', preset: 'Opus' })
    expect((await post('/recruit', me, { command: 'codex --yolo', replace: 'Gamma' })).status).toBe(200)
    expect(node('Gamma')).toMatchObject({ agent: 'codex', command: 'codex --yolo' })
    // Preset Maestro: o recruta nasce Maestro.
    await post('/recruit', me, { name: 'Chefe', preset: 'Opus' })
    expect(node('Chefe')).toMatchObject({ maestro: true })
  })

  it('role: escopo current por padrão, --scope global, edit de trecho, edit só do escopo e write', async () => {
    expect((await post('/role/create', me, { name: 'Especialista', text: 'Cuide da API. Rode palco list.' })).status).toBe(200)
    expect((await post('/role/create', me, { name: 'Revisor', text: 'Revise.', scope: 'global' })).status).toBe(200)
    let list = JSON.parse((await post('GET /role/list', me)).body)
    expect(list.current.map((r: { name: string }) => r.name)).toEqual(['especialista'])
    expect(list.global.map((r: { name: string }) => r.name)).toEqual(['revisor'])
    expect((await post('/role/edit', me, { name: 'Especialista', old: 'da API', new: 'dos pagamentos' })).status).toBe(200)
    expect(catalog.roles.get('Especialista').text).toBe('Cuide dos pagamentos. Rode palco list.')
    expect((await post('/role/edit', me, { name: 'Especialista', old: 'inexistente', new: 'x' })).status).toBe(404)
    expect((await post('/role/edit', me, { name: 'Especialista', scope: 'global' })).status).toBe(200)
    list = JSON.parse((await post('GET /role/list', me)).body)
    expect(list.current).toEqual([])
    expect((await post('/role/write', me, { name: 'Revisor', text: 'Novo prompt.' })).status).toBe(200)
    expect(catalog.roles.get('Revisor').text).toBe('Novo prompt.')
    // Role restrito a outro workspace não aparece.
    catalog.roles.create('Alheio', 'x')
    catalog.roles.setScope('Alheio', 'outro-workspace')
    expect((await post('GET /role/show?name=Alheio', me)).status).toBe(404)
  })

  it('partitura create com agentes (só eles e você), update e insert conectado a você', async () => {
    const solto = term('Solto', 2000)
    void solto
    expect((await post('/partitura/create', me, { name: 'Dupla', agents: ['Alfa'], noteText: true })).status).toBe(200)
    expect(partituras.get('Dupla').nodes.map((n) => n.name).sort()).toEqual(['Alfa', 'Eu'])
    expect((await post('/partitura/update', me, { name: 'Dupla', agents: ['Alfa', 'Beta'], withoutMe: true, newName: 'Par', description: 'd' })).status).toBe(200)
    expect(partituras.get('Par')).toMatchObject({ description: 'd' })
    expect(partituras.get('Par').nodes.map((n) => n.name).sort()).toEqual(['Alfa', 'Beta'])
    expect(() => partituras.get('Dupla')).toThrow()
    const inserted = await post('/partitura/insert', me, { name: 'Par', commands: false })
    expect(inserted.body).toMatch(/agentes: Alfa 2, Beta 2/)
    const a2 = node('Alfa 2')!
    expect(store.get().connections.some((c) => [c.a, c.b].includes(a2.id) && [c.a, c.b].includes(me))).toBe(true)
  })
})

describe('floor (skill palco-workspace)', () => {
  it('--no-git, --dir de pasta comum, recusas de --dir; delete nunca apaga a pasta do usuário', async () => {
    const plain = JSON.parse((await post('/floor/create', me, { name: 'Rascunho', noGit: true })).body)
    expect(plain).toMatchObject({ git: false, dir: repo, branch: null })
    const pasta = join(dir, 'pasta')
    mkdirSync(pasta)
    expect(JSON.parse((await post('/floor/create', me, { name: 'Pasta', dir: pasta })).body)).toMatchObject({ git: false, dir: pasta })
    expect((await post('/floor/create', me, { name: 'Repo', dir: repo })).status).toBe(400)
    expect((await post('/floor/create', me, { name: 'Casa', dir: homedir() })).status).toBe(400)
    expect((await post('/floor/create', me, { name: 'Outra', dir: pasta })).status).toBe(400)
    expect((await post('/floor/land', me, { name: 'Pasta' })).status).toBe(400)
    expect((await post('/floor/delete', me, { name: 'Pasta' })).status).toBe(200)
    expect(existsSync(pasta)).toBe(true)
  })

  it('--existing-branch, --dir de worktree do usuário (vira o checkout) e --keep-folder', async () => {
    git(repo, 'branch', 'feat/x')
    const made = JSON.parse((await post('/floor/create', me, { name: 'X', branch: 'feat/x', existingBranch: true })).body)
    expect(made).toMatchObject({ branch: 'feat/x', git: true })
    const wt = join(dir, 'wt-user')
    git(repo, 'worktree', 'add', '-b', 'feat/y', wt)
    expect(JSON.parse((await post('/floor/create', me, { name: 'Y', dir: wt })).body)).toMatchObject({ branch: 'feat/y', git: true, dir: wt })
    expect((await post('/floor/delete', me, { name: 'X', keepFolder: true })).status).toBe(200)
    expect(existsSync(made.dir)).toBe(true)
  })

  it('--copy-ground copia o layout do térreo; --partitura coloca e conecta a você', async () => {
    store.addNode({ kind: 'note', floorId: null, name: 'Plano', content: 'x', pos: { x: 0, y: 900 }, size: { w: 1, h: 1 } })
    await post('/partitura/create', me, { name: 'Time', agents: ['Alfa'], withoutMe: true, noteText: true })
    expect((await post('/floor/create', me, { name: 'Exp', copyGround: true, partitura: 'Time' })).status).toBe(200)
    const floor = Object.values(store.get().floors).find((f) => f.name === 'Exp')!
    const inFloor = Object.values(store.get().nodes).filter((n) => n.floorId === floor.id)
    expect(inFloor.some((n) => n.name === 'Plano')).toBe(true)
    const recruit = inFloor.find((n) => n.kind === 'terminal' && n.name.startsWith('Alfa') && spawned.some((s) => s.id === n.id))!
    expect(store.get().connections.some((c) => [c.a, c.b].includes(recruit.id) && [c.a, c.b].includes(me))).toBe(true)
  })

  it('status com texto: padrão working, corta em 120, notifica ao entrar em review; sem nada imprime', async () => {
    await post('/floor/create', me, { name: 'ui' })
    const floor = Object.values(store.get().floors)[0]!
    expect((await post('/floor/status', me, { floor: 'ui', text: 'Testes verdes', progress: '3/5' })).status).toBe(200)
    expect(store.get().floors[floor.id]!.status).toEqual({ state: 'working', progress: '3/5', text: 'Testes verdes' })
    expect(notified).toEqual([])
    await post('/floor/status', me, { floor: 'ui', text: 'x'.repeat(200), state: 'review' })
    expect(store.get().floors[floor.id]!.status!.text).toHaveLength(120)
    expect(notified).toHaveLength(1)
    await post('/floor/status', me, { floor: 'ui', text: 'outro texto', state: 'review' })
    expect(notified).toHaveLength(1)
    expect((await post('/floor/status', me, { floor: 'ui', progress: 'metade' })).status).toBe(400)
    expect((await post('/floor/status', me, { floor: 'ui' })).body).toContain('review')
    // Outro andar só com o Maestro.
    expect((await post('/floor/status', alfa, { floor: 'ui', text: 'x' })).status).toBe(403)
  })
})
