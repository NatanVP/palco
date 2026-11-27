// pela linha de comando, uma partitura importada não confirmada não cria andar nem inicia nada.
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AgentCatalog, PresetStore } from '../../src/main/agents/presets'
import { RoleStore } from '../../src/main/agents/roles'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { PartituraStore } from '../../src/main/partituras/partitura-store'
import { startServer } from '../../src/main/server/http-server'
import { HEADER_TOKEN } from '../../src/shared/auth'
import { defaultPreferences, validatePreferences, type Preferences } from '../../src/shared/preferences'
import { NOTE_COLOR_HEX } from '../../src/shared/new-item'

let root: string, socket: string, registry: WorkspaceRegistry, server: { close(): Promise<void> }, me: string, prefs: Preferences
const post = (path: string, body: unknown): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const payload = JSON.stringify(body)
  const req = http.request({ socketPath: socket, method: 'POST', path, headers: { [HEADER_TOKEN]: 'tok', 'content-type': 'application/json' } }, res => {
    let data = ''; res.setEncoding('utf8'); res.on('data', c => (data += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
  })
  req.on('error', reject); req.end(payload)
})
const created: string[] = [], spawned: string[] = []
const score = { name: 'Fora', createdAt: '2026-11-25', bands: [], connections: [], nodes: [{ key: 'a', kind: 'terminal', floorId: null, name: 'T', agent: 'other', command: 'touch marcador', cwd: '/x', pos: { x: 0, y: 0 }, size: { w: 4, h: 3 } }] }

beforeEach(async () => {
  created.length = 0; spawned.length = 0
  root = mkdtempSync(join(tmpdir(), 'palco-import-authority-')); socket = join(root, 's.sock'); prefs = defaultPreferences()
  registry = new WorkspaceRegistry(join(root, 'workspaces'))
  me = registry.get(registry.activeId()).addNode({ kind: 'terminal', floorId: null, name: 'Eu', agent: 'claude', command: '', cwd: root, maestro: true, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } } as never)
  const partituras = new PartituraStore(join(root, 'partituras')); partituras.import(JSON.stringify({ format: 'palco-partituras', version: 1, partituras: [score] }))
  const roles = new RoleStore(join(root, 'roles'))
  const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout }, { shellIdleMs: 60000, settleMs: 0 })
  server = await startServer(socket, {
    registry, broker, preferences: () => prefs, partituras, floors: { create: async (input: { name: string }) => { created.push(input.name); throw new Error('não deveria criar') } } as never,
    agents: new AgentCatalog(new PresetStore(join(root, 'presets.json'), roles), roles),
    terminals: { spawn: (n: { command: string }) => spawned.push(n.command), dispose: () => {}, screenText: () => '', markReady: () => {}, notePromptHook: () => {}, isRunning: () => true, hasSession: () => true, agentState: () => 'ready', identify: (t: string) => (t === 'tok' ? { id: me, gen: 1 } : undefined) }
  })
})
afterEach(async () => { await server.close(); registry.flushAll(); rmSync(root, { recursive: true, force: true }) })

it('floor create --partitura recusa antes de criar o andar', async () => {
  const r = await post('/floor/create', { name: 'Novo', partitura: 'Fora', noGit: true })
  expect(r.status).toBe(409); expect(r.body).toContain('confirme os comandos'); expect(created).toEqual([]); expect(spawned).toEqual([])
})
it('partitura insert com comandos é recusado; sem iniciar, entra parado', async () => {
  const refused = await post('/partitura/insert', { name: 'Fora', commands: true })
  expect(refused.status).toBe(409); expect(spawned).toEqual([])
  expect((await post('/partitura/insert', { name: 'Fora', commands: false })).status).toBe(200)
  expect(spawned).toEqual([]); expect(Object.values(registry.active().get().nodes).filter((n) => n.name === 'T')[0]).toMatchObject({ autoStart: false })
})
