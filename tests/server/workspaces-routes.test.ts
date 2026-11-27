import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { startServer } from '../../src/main/server/http-server'
import { parseArgs } from '../../src/cli/args'
import { HEADER_TOKEN } from '../../src/shared/auth'

interface Res { status: number; body: string }

let root: string
let socket: string
let registry: WorkspaceRegistry
let server: { close(): Promise<void> }
let delivered: Array<[string, string]>
let tokens: Map<string, string>
let w1: string, w2: string
let ids: { a1: string; b1: string; a2: string; b2: string }

function call(method: string, path: string, caller: string, body?: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const headers: Record<string, string> = { [HEADER_TOKEN]: tokens.get(caller) ?? caller }
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

const term = (ws: string, name: string) =>
  registry.get(ws).addNode({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'palco-wsr-'))
  socket = join(root, 'palco.sock')
  registry = new WorkspaceRegistry(join(root, 'workspaces'))
  w1 = registry.activeId()
  registry.rename(w1, 'Primeiro')
  w2 = registry.create('Segundo')
  // Os dois workspaces têm "Alfa" ligado a "Beta".
  const a1 = term(w1, 'Alfa'), b1 = term(w1, 'Beta'), a2 = term(w2, 'Alfa'), b2 = term(w2, 'Beta')
  registry.get(w1).connect(a1, b1)
  registry.get(w2).connect(a2, b2)
  ids = { a1, b1, a2, b2 }
  tokens = new Map(Object.values(ids).map((id) => [id, `tok-${id}`]))
  delivered = []
  const broker = new AskBroker(
    { deliver: (id, text) => delivered.push([id, text]), screenText: () => 'tela', agentOf: () => 'shell', setTimeout, clearTimeout },
    { shellIdleMs: 60000, settleMs: 0 }
  )
  server = await startServer(socket, {
    registry,
    broker,
    terminals: {
      spawn: () => {},
      dispose: () => {},
      markReady: () => {},
      notePromptHook: () => {},
      screenText: (id: string) => `tela-de-${id}`,
      isRunning: () => true,
      agentState: () => 'ready',
      identify: (t: string) => {
        const id = [...tokens].find(([, v]) => v === t)?.[0]
        return id === undefined ? undefined : { id, gen: 1 }
      }
    }
  })
})

afterEach(async () => {
  await server.close()
  registry.flushAll()
  rmSync(root, { recursive: true, force: true })
})

describe('servidor: cada chamador vê o próprio workspace', () => {
  it('list mostra só os nós do workspace do chamador', async () => {
    const r1 = JSON.parse((await call('GET', '/list', ids.a1)).body)
    const r2 = JSON.parse((await call('GET', '/list', ids.a2)).body)
    expect(r1.agents.map((a: { name: string }) => a.name)).toEqual(['Beta'])
    expect(r2.agents.map((a: { name: string }) => a.name)).toEqual(['Beta'])
  })

  it('ask "Beta" chega ao Beta do workspace do chamador', async () => {
    // A resposta nunca vem (o fake não termina o turno); o close do servidor corta a conexão.
    void call('POST', '/ask', ids.a2, { to: 'Beta', prompt: 'oi' }).catch(() => undefined)
    const end = Date.now() + 2000
    while (delivered.length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 10))
    expect(delivered.map(([id]) => id)).toEqual([ids.b2])
  })

  it('check em terminal de outro workspace é 404 (não alcançável)', async () => {
    const r = await call('GET', '/check?name=Gama', ids.a1)
    expect(r.status).toBe(404)
  })

  it('recruit cria o terminal no workspace do chamador', async () => {
    const r = await call('POST', '/recruit', ids.a2, { name: 'Novo', agent: 'shell' })
    expect(r.status).toBe(200)
    expect(Object.values(registry.get(w2).get().nodes).some((n) => n.name === 'Novo')).toBe(true)
    expect(Object.values(registry.get(w1).get().nodes).some((n) => n.name === 'Novo')).toBe(false)
  })
})

describe('servidor: rotas de workspace e space (skill palco-workspace)', () => {
  const maestro = (): string => {
    const id = registry.get(w1).addNode({ kind: 'terminal', floorId: null, name: 'Maestro', agent: 'shell', command: '', cwd: root, maestro: true, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })
    tokens.set(id, `tok-${id}`)
    return id
  }

  it('sem o Maestro: 403', async () => {
    expect((await call('GET', '/workspace/list', ids.a1)).status).toBe(403)
    expect((await call('POST', '/space/create', ids.a1, { name: 'X' })).status).toBe(403)
  })

  it('workspace list: hierarquia por espaço, com pasta, andares e o do chamador', async () => {
    const m = maestro()
    const list = JSON.parse((await call('GET', '/workspace/list', m)).body)
    expect(list).toEqual([{ space: 'Espaços de Trabalho', onScreen: true, groups: [], workspaces: [
      { name: 'Primeiro', dir: null, floors: 0, current: true, active: true },
      { name: 'Segundo', dir: null, floors: 0 }
    ] }])
  })

  it('workspace create --dir (pasta precisa existir), --group cria o grupo, --space cria o espaço; --from clona o layout', async () => {
    const m = maestro()
    const proj = mkdtempSync(join(root, 'proj-'))
    expect((await call('POST', '/workspace/create', m, { name: 'Loja', dir: join(root, 'nao-existe') })).status).toBe(400)
    expect((await call('POST', '/workspace/create', m, { name: 'Loja', dir: proj, group: 'Dados', space: 'Clientes' })).status).toBe(200)
    expect((await call('POST', '/workspace/create', m, { name: 'loja', dir: proj })).status).toBe(409)
    const side = registry.sidebar()
    const loja = side.workspaces.find((w) => w.name === 'Loja')!
    const page = side.pages.find((p) => p.name === 'Clientes')!
    const group = side.spaces.find((g) => g.name === 'Dados')!
    expect(loja).toMatchObject({ dir: proj, spaceId: group.id, pageId: page.id })
    expect(group.pageId).toBe(page.id)
    // A tela do usuário não muda.
    expect(side.activePage).not.toBe(page.id)
    expect(side.active).toBe(w1)

    // --from: o layout vem junto, com caminhos dentro da origem redirecionados.
    const src = registry.get(loja.id)
    const t = src.addNode({ kind: 'terminal', floorId: null, name: 'Dev', agent: 'shell', command: '', cwd: join(proj, 'sub'), pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } })
    const n = src.addNode({ kind: 'note', floorId: null, name: 'Plano', content: 'x', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } })
    src.connect(t, n)
    const copy = mkdtempSync(join(root, 'copia-'))
    expect((await call('POST', '/workspace/create', m, { name: 'Copia', dir: copy, from: 'Loja' })).status).toBe(200)
    const cloned = registry.get(registry.workspaceByName('Copia')!.id).get()
    const dev = Object.values(cloned.nodes).find((x) => x.name === 'Dev')
    expect(dev).toMatchObject({ kind: 'terminal', cwd: join(copy, 'sub') })
    expect(dev!.id).not.toBe(t)
    expect(cloned.connections).toHaveLength(1)
  })

  it('workspace move --group | --root | --space; grupo repetido em dois espaços pede --space', async () => {
    const m = maestro()
    expect((await call('POST', '/workspace/move', m, { name: 'Segundo', group: 'Arquivo' })).status).toBe(200)
    let side = registry.sidebar()
    expect(side.workspaces.find((w) => w.id === w2)!.spaceId).toBe(side.spaces.find((g) => g.name === 'Arquivo')!.id)
    expect((await call('POST', '/workspace/move', m, { name: 'Segundo', root: true })).status).toBe(200)
    expect(registry.sidebar().workspaces.find((w) => w.id === w2)!.spaceId).toBeNull()
    expect((await call('POST', '/workspace/move', m, { name: 'Segundo', space: 'Clientes' })).status).toBe(200)
    side = registry.sidebar()
    expect(side.workspaces.find((w) => w.id === w2)!.pageId).toBe(side.pages.find((p) => p.name === 'Clientes')!.id)
    expect((await call('POST', '/workspace/move', m, { name: 'Primeiro', group: 'Arquivo', space: 'Clientes' })).status).toBe(200)
    const twice = await call('POST', '/workspace/move', m, { name: 'Segundo', group: 'Arquivo' })
    expect(twice.status).toBe(409)
    expect(twice.body).toContain('--space')
    expect((await call('POST', '/workspace/move', m, { name: 'Nada', root: true })).status).toBe(404)
  })

  it('space create/edit/move/list/delete', async () => {
    const m = maestro()
    expect((await call('POST', '/space/create', m, { name: 'Clientes', icon: 'folder', color: 'blue' })).status).toBe(200)
    expect((await call('POST', '/space/create', m, { name: 'Pessoal' })).status).toBe(200)
    expect((await call('POST', '/space/create', m, { name: 'clientes' })).status).toBe(409)
    expect((await call('POST', '/space/edit', m, { name: 'Clientes', newName: 'Cli', color: 'none' })).status).toBe(200)
    expect((await call('POST', '/space/move', m, { name: 'Pessoal', left: true })).status).toBe(200)
    const list = JSON.parse((await call('GET', '/space/list', m)).body) as Array<{ name: string; position: number; color?: string; icon: string }>
    expect(list.map((p) => p.name)).toEqual(['Espaços de Trabalho', 'Pessoal', 'Cli'])
    expect(list[2]).toMatchObject({ icon: 'folder' })
    expect(list[2]!.color).toBeUndefined()
    expect((await call('POST', '/space/move', m, { name: 'Cli', to: 2 })).status).toBe(200)
    expect(registry.sidebar().pages.map((p) => p.name)).toEqual(['Espaços de Trabalho', 'Cli', 'Pessoal'])
    expect((await call('POST', '/workspace/move', m, { name: 'Segundo', space: 'Cli' })).status).toBe(200)
    expect((await call('POST', '/space/delete', m, { name: 'Cli' })).status).toBe(200)
    expect(registry.sidebar().workspaces.find((w) => w.id === w2)!.pageId).toBe('inicio')
  })
})

describe('CLI: workspace e space', () => {
  it('interpreta os subcomandos', () => {
    expect(parseArgs(['workspace', 'list'])).toEqual({ cmd: 'workspace-list' })
    expect(parseArgs(['workspace', 'create', 'Loja', '--dir', '/p', '--space', 'Clientes'])).toEqual({ cmd: 'workspace-create', name: 'Loja', dir: '/p', space: 'Clientes' })
    expect(() => parseArgs(['workspace', 'create', 'Loja'])).toThrow(/--dir/)
    expect(parseArgs(['workspace', 'rename', 'A', 'B'])).toEqual({ cmd: 'workspace-rename', old: 'A', new: 'B' })
    expect(parseArgs(['workspace', 'move', 'A', '--space', 'S'])).toEqual({ cmd: 'workspace-move', name: 'A', space: 'S' })
    expect(() => parseArgs(['workspace', 'move', 'A'])).toThrow(/Uso/)
    expect(parseArgs(['space', 'list'])).toEqual({ cmd: 'space-list' })
    expect(parseArgs(['space', 'create', 'S'])).toEqual({ cmd: 'space-create', name: 'S' })
    expect(parseArgs(['space', 'delete', 'S'])).toEqual({ cmd: 'space-delete', name: 'S' })
    expect(() => parseArgs(['workspace', 'rename', 'A'])).toThrow(/Uso/)
    expect(() => parseArgs(['space', 'explode'])).toThrow(/Uso/)
  })
})
