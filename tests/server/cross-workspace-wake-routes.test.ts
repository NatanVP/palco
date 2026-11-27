// Nome @ Workspace, banda com visual, status do térreo, notas e list (rotas reais pelo socket).
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentCatalog, PresetStore } from '../../src/main/agents/presets'
import { RoleStore } from '../../src/main/agents/roles'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { CrossLinkStore } from '../../src/main/domain/cross-links'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { PartituraStore } from '../../src/main/partituras/partitura-store'
import { startServer } from '../../src/main/server/http-server'
import { formatList, type ListReply } from '../../src/cli/list-format'
import { HEADER_TOKEN } from '../../src/shared/auth'
import type { TerminalNode } from '../../src/shared/model'

let root: string, socket: string
let registry: WorkspaceRegistry
let server: { close(): Promise<void> }
let tokens: Map<string, string>
let delivered: Array<[string, string]>
let links: CrossLinkStore
let partituras: PartituraStore
let w1: string, w2: string, me: string, alfa: string
let sessions: Set<string>, running: Set<string>, slow: Set<string>

const call = (method: string, path: string, who: string, body?: unknown): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const req = http.request({ socketPath: socket, method, path, headers: { [HEADER_TOKEN]: tokens.get(who)!, ...(payload ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (c) => (data += c))
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
  })
  req.on('error', reject)
  req.end(payload)
})
const post = (path: string, who: string, body: unknown) => call('POST', path, who, body)
const list = async (who: string): Promise<ListReply> => JSON.parse((await call('GET', '/list', who)).body) as ListReply
const term = (ws: string, name: string, over: Partial<TerminalNode> = {}): string => {
  const id = registry.get(ws).addNode({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: root, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }, ...over } as never)
  tokens.set(id, `tok-${id}`)
  sessions.add(id)
  running.add(id)
  return id
}
const byName = (ws: string, name: string) => Object.values(registry.get(ws).get().nodes).find((n) => n.name === name)

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'palco-workspace-wake-'))
  socket = join(root, 's.sock')
  registry = new WorkspaceRegistry(join(root, 'workspaces'))
  w1 = registry.activeId()
  registry.rename(w1, 'Projeto')
  w2 = registry.create('Frontend')
  tokens = new Map()
  sessions = new Set(); running = new Set(); slow = new Set()
  delivered = []
  me = term(w1, 'Eu', { agent: 'claude', command: 'claude', maestro: true })
  alfa = term(w1, 'Alfa')
  registry.get(w1).connect(me, alfa)
  links = new CrossLinkStore(join(root, 'links.json'))
  const roles = new RoleStore(join(root, 'roles'))
  partituras = new PartituraStore(join(root, 'partituras'))
  const broker = new AskBroker({ deliver: (id, t) => void delivered.push([id, t]), screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout }, { shellIdleMs: 60000, settleMs: 0 })
  server = await startServer(socket, {
    registry, broker, links, partituras, agents: new AgentCatalog(new PresetStore(join(root, 'presets.json'), roles), roles),
    terminals: {
      screenText: (id: string) => `tela-de-${id}`, markReady: () => {}, notePromptHook: () => {},
      // Terminais criados direto no store já rodam; os recrutas sobem pelo spawn.
      isRunning: (id: string) => running.has(id),
      hasSession: (id: string) => sessions.has(id),
      agentState: (id: string) => (slow.has(id) ? 'booting' : 'ready'),
      identify: (t: string) => { const id = [...tokens].find(([, v]) => v === t)?.[0]; return id === undefined ? undefined : { id, gen: 1 } },
      spawn: (n: TerminalNode) => { tokens.set(n.id, `tok-${n.id}`); sessions.add(n.id); running.add(n.id) }, dispose: () => {}
    }
  }, { wakeTimeoutMs: 300 })
})
afterEach(async () => {
  await server.close()
  registry.flushAll()
  rmSync(root, { recursive: true, force: true })
})

describe('Nome @ Workspace', () => {
  it('recruit --workspace liga você ao recruta; list mostra o endereço; ask, check e note funcionam pelo nome', async () => {
    const r = await post('/recruit', me, { name: 'Lince', workspace: 'Frontend' })
    expect(r.body).toContain('Lince @ Frontend')
    const lince = byName(w2, 'Lince')!
    const mine = await list(me)
    expect(mine.self.address).toBe('Eu @ Projeto')
    expect(mine.agents.map((a) => a.name)).toEqual(['Alfa', 'Lince @ Frontend'])
    // O recruta te vê como `Eu @ Projeto`.
    expect((await list(lince.id)).agents.map((a) => a.name)).toEqual(['Eu @ Projeto'])
    expect((await call('GET', `/check?name=${encodeURIComponent('Lince @ Frontend')}`, me)).body).toBe(`tela-de-${lince.id}`)
    void post('/ask', me, { to: 'Lince @ Frontend', prompt: 'oi' }).catch(() => undefined)
    const end = Date.now() + 2000
    while (delivered.length === 0 && Date.now() < end) await new Promise((res) => setTimeout(res, 10))
    expect(delivered.map(([id]) => id)).toEqual([lince.id])
    // Nota do recruta, lá no outro workspace.
    const note = registry.get(w2).addNode({ kind: 'note', floorId: null, name: 'Spec', content: 'Spec\nx', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } })
    registry.get(w2).connect(lince.id, note)
    expect((await post('/note/edit', me, { name: 'Spec @ Frontend', old: 'x', new: 'y' })).status).toBe(200)
    expect((registry.get(w2).get().nodes[note] as { content: string }).content).toBe('Spec\ny')
    expect((await call('GET', `/check?name=${encodeURIComponent('Lince @ Outro')}`, me)).status).toBe(404)
  })

  it('band create --workspace junta seus recrutas de lá; partitura insert --workspace liga você aos agentes', async () => {
    await post('/recruit', me, { name: 'A', workspace: 'Frontend' })
    await post('/recruit', me, { name: 'B', workspace: 'Frontend' })
    const res = await post('/band/create', me, { name: 'Time', workspace: 'Frontend', color: 'green', icon: 'users' })
    expect(res.status).toBe(200)
    expect(byName(w2, 'Time')).toMatchObject({ kind: 'band', color: '#34C759', icon: 'users' })
    // Liga você de verdade: a corda entre workspaces vai até a banda.
    expect(links.peers(me)).toContain(byName(w2, 'Time')!.id)
    expect((await list(me)).bands.map((b) => b.name)).toContain('Time @ Frontend')
    await post('/partitura/create', me, { name: 'Par', agents: ['Alfa'], withoutMe: true, noteText: true })
    expect((await post('/partitura/insert', me, { name: 'Par', workspace: 'Frontend', commands: false })).status).toBe(200)
    expect((await list(me)).agents.map((a) => a.name)).toContain('Alfa @ Frontend')
    expect(links.peers(me)).toContain(byName(w2, 'Alfa')!.id)
  })
})

describe('banda com ícone e cor, status do térreo', () => {
  it('band create --icon/--color e arrange da banda', async () => {
    await post('/band/create', me, { name: 'Esquadrão', icon: 'shield', color: '#FF3B30' })
    expect(byName(w1, 'Esquadrão')).toMatchObject({ icon: 'shield', color: '#FF3B30' })
    expect((await post('/arrange', me, { target: 'Esquadrão', color: '#007AFF', icon: 'star' })).status).toBe(200)
    expect(byName(w1, 'Esquadrão')).toMatchObject({ icon: 'star', color: '#007AFF' })
    expect((await list(me)).bands.find((b) => b.name === 'Esquadrão')).toMatchObject({ icon: 'star', color: '#007AFF' })
    expect(formatList(await list(me))).toContain('    look: star #007AFF')
  })

  it('floor status --floor "Ground" grava a linha do térreo (outro andar nomeado: só o Maestro)', async () => {
    expect((await post('/floor/status', me, { floor: 'Ground', text: '2 de 3 andares em revisão', state: 'review' })).status).toBe(200)
    expect(registry.get(w1).get().groundStatus).toEqual({ state: 'review', text: '2 de 3 andares em revisão' })
    expect((await post('/floor/status', me, { floor: 'Ground' })).body).toContain('2 de 3 andares')
    // Alfa está no térreo: o térreo é o andar dele, então pode publicar (só nomear OUTRO andar exige o Maestro).
    expect((await post('/floor/status', alfa, { floor: 'Ground', text: 'do Alfa' })).status).toBe(200)
    // No térreo, sem --floor: o andar do chamador é o térreo (imprime e publica).
    expect((await post('/floor/status', me, {})).body).toContain('Ground: working — do Alfa')
    expect((await post('/floor/status', me, { floor: 'Ground', clear: true })).status).toBe(200)
    expect(registry.get(w1).get().groundStatus).toBeUndefined()
  })
})

describe('notas, fichário e list em texto', () => {
  it('sem --name a nota segue a primeira linha (resposta diz o nome novo); com --name ou renomeada pelo usuário, fica', async () => {
    expect((await post('/note/create', me, { content: 'Rascunho' })).body).toContain('"Rascunho"')
    const w = await post('/note/write', me, { name: 'Rascunho', content: 'Plano final\ncorpo' })
    expect(w.body).toBe('OK: a nota agora se chama "Plano final"')
    expect((await post('/note/edit', me, { name: 'Plano final', old: 'final', new: 'B' })).body).toBe('OK: a nota agora se chama "Plano B"')
    await post('/note/create', me, { content: 'x', name: 'Fixa' })
    expect((await post('/note/write', me, { name: 'Fixa', content: 'Outra coisa' })).body).toBe('OK')
    const id = byName(w1, 'Plano B')!.id
    registry.get(w1).patchNode(id, { name: 'Do Usuário' })
    expect((await post('/note/write', me, { name: 'Do Usuário', content: 'Mudou tudo' })).body).toBe('OK')
  })

  it('fichário com nome próprio (acentos valem); list mostra árvore de notas, fichários, bandas e o que cada colega tem ligado', async () => {
    expect((await post('/note/create', me, { content: 'A', name: 'Nota A', stack: 'Fichário' })).status).toBe(200)
    await post('/note/create', me, { content: 'B', name: 'Nota B', stack: 'fichário' })
    const ws = registry.get(w1)
    const a = byName(w1, 'Nota A') as { stackId: string }, b = byName(w1, 'Nota B') as { stackId: string }
    expect(a.stackId).toBe(b.stackId)
    expect(ws.get().stackNames?.[a.stackId]).toBe('Fichário')
    const mae = ws.addNode({ kind: 'note', floorId: null, name: 'Mãe', content: 'm', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } })
    const filha = ws.addNode({ kind: 'note', floorId: null, name: 'Filha', content: 'f', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } })
    ws.connect(me, mae)
    ws.connect(mae, filha)
    const port = ws.addNode({ kind: 'portal', floorId: null, name: 'Web', url: 'https://example.com', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } })
    ws.connect(alfa, port)
    const reply = await list(me)
    expect(reply.notes.find((n) => n.name === 'Filha')).toMatchObject({ parent: 'Mãe' })
    expect(reply.agents.find((x) => x.name === 'Alfa')!.connections).toEqual([{ name: 'Web', kind: 'portal' }])
    const out = formatList(reply)
    expect(out).toContain('You:\n  - name: "Eu"\n    address: "Eu @ Projeto"')
    expect(out).toContain('  - name: "Mãe"\n      - name: "Filha"')
    expect(out).toContain('  - stack: "Fichário"\n      - name: "Nota A"\n      - name: "Nota B"')
    expect(out).toContain('    connections:\n      - portal: "Web"')
    expect((await post('/note/delete', me, { name: 'Fichário', stack: true })).status).toBe(200)
    expect(byName(w1, 'Nota A')).toBeUndefined()
  })
})

describe("wake sob demanda", () => {
  it('ask e check acordam o terminal de outro workspace que ainda não subiu', async () => {
    await post('/recruit', me, { name: 'Dorminhoco', workspace: 'Frontend' })
    // Simula o palco recém-aberto: o recruta de lá nunca subiu nesta sessão.
    const id = byName(w2, 'Dorminhoco')!.id
    sessions.delete(id)
    running.delete(id)
    const before = (await list(me)).agents.find((a) => a.name === 'Dorminhoco @ Frontend')
    expect(before).toMatchObject({ dormant: true })
    expect(formatList(await list(me))).toContain('status: dormindo')
    expect((await call('GET', `/check?name=${encodeURIComponent('Dorminhoco @ Frontend')}`, me)).body).toBe(`tela-de-${id}`)
    expect((await list(me)).agents.find((a) => a.name === 'Dorminhoco @ Frontend')!.dormant).toBeUndefined()
    expect(sessions.has(id)).toBe(true)
  })
  it('passou do prazo: "ainda iniciando" (503)', async () => {
    await post('/recruit', me, { name: 'Lento', workspace: 'Frontend' })
    const id = byName(w2, 'Lento')!.id
    sessions.delete(id)
    running.delete(id)
    slow.add(id)
    const r = await post('/ask', me, { to: 'Lento @ Frontend', prompt: 'oi' })
    expect(r.status).toBe(503)
    expect(r.body).toMatch(/^ainda iniciando/)
  })
})
