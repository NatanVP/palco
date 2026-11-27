// Autoridade das bandas e resolução de endereços qualificados pelas rotas reais do socket.
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { CrossLinkStore } from '../../src/main/domain/cross-links'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { startServer } from '../../src/main/server/http-server'
import { HEADER_TOKEN } from '../../src/shared/auth'
import type { TerminalNode } from '../../src/shared/model'

let root: string, socket: string, registry: WorkspaceRegistry, server: { close(): Promise<void> }
let tokens: Map<string, string>, delivered: Array<[string, string]>, links: CrossLinkStore
let w1: string, w2: string, me: string, b: string, c: string

const call = (method: string, path: string, who: string, body?: unknown): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const req = http.request({ socketPath: socket, method, path, headers: { [HEADER_TOKEN]: tokens.get(who)!, ...(payload ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (x) => (data += x))
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
  })
  req.on('error', reject)
  req.end(payload)
})
const term = (ws: string, name: string): string => {
  const id = registry.get(ws).addNode({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: root, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } })
  tokens.set(id, `tok-${id}`)
  return id
}
const askReached = async (to: string): Promise<{ status: number; ids: string[] }> => {
  delivered = []
  const pending = call('POST', '/ask', me, { to, prompt: 'segredo' })
  const r = await Promise.race([pending, new Promise<null>((res) => setTimeout(() => res(null), 300))])
  return { status: r?.status ?? 0, ids: delivered.map(([id]) => id) }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'palco-rev-'))
  socket = join(root, 's.sock')
  registry = new WorkspaceRegistry(join(root, 'workspaces'))
  w1 = registry.activeId()
  registry.rename(w1, 'Projeto')
  w2 = registry.create('Frontend')
  tokens = new Map()
  delivered = []
  me = term(w1, 'Eu')
  b = term(w2, 'B')
  c = term(w2, 'C')
  links = new CrossLinkStore(join(root, 'links.json'))
  // A corda vai só até B (B não é recruta de "Eu").
  links.connect(me, b)
  const broker = new AskBroker({ deliver: (id, t) => void delivered.push([id, t]), screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout }, { shellIdleMs: 60000, settleMs: 0 })
  server = await startServer(socket, {
    registry, broker, links,
    terminals: {
      screenText: (id: string) => `tela-de-${id}`, isRunning: () => true, agentState: () => 'ready', markReady: () => {}, notePromptHook: () => {},
      identify: (t: string) => { const id = [...tokens].find(([, v]) => v === t)?.[0]; return id === undefined ? undefined : { id, gen: 1 } }
    }
  })
})
afterEach(async () => {
  for (const id of [me, b, c]) void id
  await server.close()
  registry.flushAll()
  rmSync(root, { recursive: true, force: true })
})

describe("corda até um membro não dá alcance à banda privada nem aos outros membros", () => {
  it('banda de B e C sem corda até ela: nem lista, nem ask, nem C', async () => {
    registry.get(w2).createBand('Privada', [b, c], null)
    const list = JSON.parse((await call('GET', '/list', me)).body) as { agents: Array<{ name: string }>; bands: Array<{ name: string }> }
    expect(list.bands.map((x) => x.name)).not.toContain('Privada @ Frontend')
    expect(list.agents.map((x) => x.name)).toEqual(['B @ Frontend'])
    const r = await askReached('Privada @ Frontend')
    expect(r.status).toBe(404)
    expect(r.ids).toEqual([])
    expect((await askReached('C @ Frontend')).status).toBe(404)
  })
  it('com corda explícita até a banda, o ask alcança os membros (como uma corda local até a banda)', async () => {
    const band = registry.get(w2).createBand('Time', [b, c], null)
    links.connect(me, band)
    const r = await askReached('Time @ Frontend')
    expect(r.ids.sort()).toEqual([b, c].sort())
  })
})

describe("endereço qualificado não cai num impostor local", () => {
  it('nome local "Revisor @ Privado" não recebe o ask de "Revisor @ Privado"; local: é o escape', async () => {
    const impostor = term(w1, 'Revisor @ Privado')
    registry.get(w1).connect(me, impostor)
    const r = await askReached('Revisor @ Privado')
    expect(r.status).toBe(404)
    expect(r.ids).toEqual([])
    expect((await call('GET', `/check?name=${encodeURIComponent('Revisor @ Privado')}`, me)).status).toBe(404)
    expect((await call('GET', `/check?name=${encodeURIComponent('local:Revisor @ Privado')}`, me)).body).toBe(`tela-de-${impostor}`)
    // Workspace inexistente também é 404.
    expect((await call('GET', `/check?name=${encodeURIComponent('B @ Nenhum')}`, me)).status).toBe(404)
    expect((await call('GET', `/check?name=${encodeURIComponent('B @ Frontend')}`, me)).body).toBe(`tela-de-${b}`)
  })
})

describe('status do térreo e alcance dos comandos de andar', () => {
  it('no térreo, qualquer terminal publica o próprio andar; de outro andar, nomear o térreo exige o Maestro', async () => {
    const ws = registry.get(w1)
    const floor = ws.addFloor({ name: 'Andar', repoRoot: root, dir: root, branch: '', baseRef: '', plain: true })
    const add = (name: string, maestro: boolean): string => {
      const id = ws.addNode({ kind: 'terminal', floorId: floor, name, agent: 'shell', command: '', cwd: root, ...(maestro ? { maestro: true } : {}), pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } })
      tokens.set(id, `tok-${id}`)
      return id
    }
    expect((await call('POST', '/floor/status', me, { text: 'do térreo' })).status).toBe(200)
    expect(ws.get().groundStatus).toEqual({ state: 'working', text: 'do térreo' })
    expect((await call('POST', '/floor/status', add('NoAndar', false), { floor: 'Ground', text: 'x' })).status).toBe(403)
    expect((await call('POST', '/floor/status', add('MaestroNoAndar', true), { floor: 'Ground', text: 'resumo' })).status).toBe(200)
    expect(ws.get().groundStatus).toMatchObject({ text: 'resumo' })
  })
})
