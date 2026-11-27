// `recruit --space` (recruta num workspace de outro espaço da barra) e `local:Nome` em todo comando que cita um nó.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../src/cli/args'
import { helpFor } from '../src/cli/help'
import { AgentCatalog, PresetStore } from '../src/main/agents/presets'
import { RoleStore } from '../src/main/agents/roles'
import { AskBroker } from '../src/main/ask/ask-broker'
import { CrossLinkStore } from '../src/main/domain/cross-links'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { PartituraStore } from '../src/main/partituras/partitura-store'
import { startServer } from '../src/main/server/http-server'
import { HEADER_TOKEN } from '../src/shared/auth'
import type { BandNode, CanvasNode, TerminalNode } from '../src/shared/model'

describe('CLI', () => {
  it('recruit aceita --space com --workspace, e --replace não', () => {
    expect(parseArgs(['recruit', 'Lince', '--space', 'Clientes', '--workspace', 'Site'])).toMatchObject({ cmd: 'recruit', name: 'Lince', space: 'Clientes', workspace: 'Site' })
    expect(() => parseArgs(['recruit', '--replace', 'A', '--preset', 'P', '--space', 'S'])).toThrow(/--space/)
  })
  it('a ajuda do recruit explica --space', () => {
    expect(helpFor(['recruit', '--help'])).toContain('--space')
  })
  it('as skills ensinam --space e local:Nome', () => {
    const read = (name: string) => readFileSync(`resources/skills/${name}/SKILL.md`, 'utf8')
    expect(read('palco-manager')).toMatch(/--space "[^"]+"/)
    expect(read('palco')).toContain('local:')
    expect(read('palco-manager')).toContain('local:')
  })
})

let root: string, socket: string, registry: WorkspaceRegistry, server: { close(): Promise<void> }, links: CrossLinkStore
let tokens: Map<string, string>, disposed: string[], partituras: PartituraStore
let own: string, me: string

const post = (path: string, body: unknown, who = me): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const payload = JSON.stringify(body)
  const req = http.request({ socketPath: socket, method: 'POST', path, headers: { [HEADER_TOKEN]: tokens.get(who)!, 'content-type': 'application/json' } }, (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (c) => (data += c))
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
  })
  req.on('error', reject)
  req.end(payload)
})
const term = (name: string, over: Partial<TerminalNode> = {}): string => {
  const id = registry.get(own).addNode({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: root, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }, ...over } as never)
  tokens.set(id, `tok-${id}`)
  return id
}
const nodes = (ws = own): CanvasNode[] => Object.values(registry.get(ws).get().nodes)
const named = (name: string, ws = own) => nodes(ws).find((n) => n.name === name)
const workspaceIn = (page: string, name: string): string => {
  const id = registry.create(name)
  registry.move(id, null, 0, page)
  return id
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'palco-local-address-'))
  socket = join(root, 's.sock')
  registry = new WorkspaceRegistry(join(root, 'workspaces'))
  own = registry.activeId()
  registry.rename(own, 'Projeto')
  tokens = new Map(); disposed = []
  me = term('Eu', { agent: 'claude', command: 'claude', maestro: true })
  links = new CrossLinkStore(join(root, 'links.json'))
  const roles = new RoleStore(join(root, 'roles'))
  const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout }, { shellIdleMs: 60000, settleMs: 0 })
  partituras = new PartituraStore(join(root, 'partituras'))
  server = await startServer(socket, {
    registry, broker, links, partituras, agents: new AgentCatalog(new PresetStore(join(root, 'presets.json'), roles), roles),
    terminals: {
      screenText: (id: string) => `tela-de-${id}`, write: () => {}, markReady: () => {}, notePromptHook: () => {}, isRunning: () => true, hasSession: () => true, agentState: () => 'ready',
      identify: (t: string) => { const id = [...tokens].find(([, v]) => v === t)?.[0]; return id === undefined ? undefined : { id, gen: 1 } },
      spawn: (n: TerminalNode) => { tokens.set(n.id, `tok-${n.id}`) }, dispose: (id: string) => { disposed.push(id) }
    }
  })
})
afterEach(async () => {
  await server.close()
  registry.flushAll()
  rmSync(root, { recursive: true, force: true })
})

describe('recruit --space', () => {
  let solo: string, loja: string, site: string
  beforeEach(() => {
    const clientes = registry.createPage({ name: 'Clientes' }), unico = registry.createPage({ name: 'Solo' })
    registry.createPage({ name: 'Vazio' })
    loja = workspaceIn(clientes, 'Loja'); site = workspaceIn(clientes, 'Site'); solo = workspaceIn(unico, 'Único')
  })

  it('num espaço com um só workspace o recruta nasce nele, ligado a você', async () => {
    const r = await post('/recruit', { name: 'Lince', space: 'solo' })
    expect(r.status).toBe(200)
    expect(r.body).toContain('Lince @ Único')
    const lince = named('Lince', solo)!
    expect(links.peers(me)).toContain(lince.id)
    expect((await post('/ask/raw', { to: 'Lince @ Único', data: '' })).status).toBe(200)
  })

  it('com vários, --workspace escolhe um daquele espaço; sem ele, o erro lista as opções', async () => {
    const ambiguous = await post('/recruit', { name: 'A', space: 'Clientes' })
    expect(ambiguous.status).toBe(400)
    expect(ambiguous.body).toContain('--workspace')
    expect(ambiguous.body).toContain('Loja')
    expect(ambiguous.body).toContain('Site')
    expect((await post('/recruit', { name: 'B', space: 'Clientes', workspace: 'site' })).status).toBe(200)
    expect(named('B', site)).toBeDefined()
    expect(nodes(loja).filter((n) => n.kind === 'terminal')).toEqual([])
  })

  it('recusa espaço inexistente, vazio, workspace de outro espaço e --replace, sem criar nada', async () => {
    term('Velho')
    registry.get(own).connect(me, named('Velho')!.id)
    const before = registry.list().reduce((sum, w) => sum + nodes(w.id).length, 0)
    for (const [body, status, text] of [
      [{ name: 'X', space: 'Nada' }, 404, 'Nada'],
      [{ name: 'X', space: 'Vazio' }, 404, 'não tem workspace'],
      [{ name: 'X', space: 'Clientes', workspace: 'Único' }, 404, 'Clientes'],
      [{ replace: 'Velho', preset: 'Shell', space: 'Solo' }, 400, '--space']
    ] as const) {
      const r = await post('/recruit', body)
      expect([r.status, r.body.includes(text)], r.body).toEqual([status, true])
    }
    expect(registry.list().reduce((sum, w) => sum + nodes(w.id).length, 0)).toBe(before)
  })

  it('o seu próprio workspace, apontado pelo espaço, é um recruta comum', async () => {
    const home = registry.sidebar().pages[0]!.name
    expect((await post('/recruit', { name: 'Perto', space: home, workspace: 'Projeto' })).status).toBe(200)
    expect(registry.get(own).get().connections.some((c) => [c.a, c.b].includes(named('Perto')!.id))).toBe(true)
    expect(links.peers(me)).toEqual([])
  })
})

describe('local:Nome', () => {
  /** Um colega local cujo nome parece um endereço de outro workspace. */
  const odd = 'Ana @ Casa'
  let ana: string, note: string
  beforeEach(() => {
    ana = term(odd, { recruitedBy: me, agent: 'claude', command: 'claude' })
    note = registry.get(own).addNode({ kind: 'note', floorId: null, name: 'Plano @ Q3', content: 'x', pos: { x: 0, y: 0 }, size: { w: 200, h: 100 } })
    registry.get(own).connect(me, ana); registry.get(own).connect(me, note)
  })
  const ok = async (path: string, body: unknown) => { const r = await post(path, body); expect(r.status, `${path}: ${r.body}`).toBe(200); return r.body }

  it('vale em arrange, connect e fichário', async () => {
    await ok('/connect', { from: `local:${odd}`, to: 'local:Plano @ Q3' })
    expect(registry.get(own).get().connections.some((c) => [c.a, c.b].includes(ana) && [c.a, c.b].includes(note))).toBe(true)
    await ok('/note/stack', { name: 'local:Plano @ Q3', stack: 'Ideias' })
    await ok('/arrange', { target: 'local:Plano @ Q3', color: '#ff0000' })
    expect(named('Plano @ Q3')).toMatchObject({ color: '#ff0000' })
    await ok('/note/delete', { name: 'local:Plano @ Q3' })
    expect(named('Plano @ Q3')).toBeUndefined()
  })

  it('vale em banda (criar, tirar membro, recrutar para ela) e em dismiss', async () => {
    term('Beto')
    registry.get(own).connect(me, named('Beto')!.id)
    await ok('/band/create', { name: 'Time @ A', members: [`local:${odd}`, 'Beto'] })
    const band = () => nodes().find((n): n is BandNode => n.kind === 'band')!
    await ok('/recruit', { name: 'Novo', band: 'local:Time @ A' })
    expect(band().members).toHaveLength(4)
    await ok('/band/remove', { band: 'local:Time @ A', member: `local:${odd}` })
    expect(band().members).not.toContain(ana)
    await ok('/band/dissolve', { band: 'local:Time @ A' })
    registry.get(own).connect(me, ana)
    await ok('/dismiss', { name: `local:${odd}` })
    expect(disposed).toEqual([ana])
  })

  it('vale em role assign e partitura create', async () => {
    await ok('/role/create', { name: 'Revisor', text: 'revise', scope: 'global' })
    await ok('/role/assign', { name: `local:${odd}`, role: 'Revisor' })
    await ok('/role/assign', { name: 'local:Eu', role: 'Revisor' })
    expect([(named(odd) as TerminalNode).role, (named('Eu') as TerminalNode).role]).toEqual(['revisor', 'revisor'])
    await ok('/partitura/create', { name: 'Dupla', agents: [`local:${odd}`, 'local:Eu'], withoutMe: true })
    expect(partituras.get('Dupla').nodes.filter((n) => n.kind === 'terminal')).toHaveLength(2)
  })

  it('o seu próprio nome com o prefixo continua sendo você', async () => {
    term('Beto')
    registry.get(own).connect(me, named('Beto')!.id)
    await ok('/band/create', { name: 'Dupla', members: ['local:Eu', 'local:Beto'] })
    expect(nodes().find((n): n is BandNode => n.kind === 'band')!.members).toContain(me)
  })
})
