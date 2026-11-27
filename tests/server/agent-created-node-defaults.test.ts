// o que o agente cria (nota, portal) herda os Padrões de Novos Itens e respeita Empilhar / Espaço Livre.
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AgentCatalog, PresetStore } from '../../src/main/agents/presets'
import { RoleStore } from '../../src/main/agents/roles'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
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
const nodesOf = (kind: string) => Object.values(registry.get(registry.activeId()).get().nodes).filter(n => n.kind === kind)

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'palco-node-defaults-')); socket = join(root, 's.sock'); prefs = defaultPreferences()
  registry = new WorkspaceRegistry(join(root, 'workspaces'))
  me = registry.get(registry.activeId()).addNode({ kind: 'terminal', floorId: null, name: 'Eu', agent: 'shell', command: '', cwd: root, pos: { x: 1000, y: 0 }, size: { w: 400, h: 300 } } as never)
  const roles = new RoleStore(join(root, 'roles'))
  const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout }, { shellIdleMs: 60000, settleMs: 0 })
  server = await startServer(socket, {
    registry, broker, preferences: () => prefs, portals: {} as never,
    agents: new AgentCatalog(new PresetStore(join(root, 'presets.json'), roles), roles),
    terminals: { screenText: () => '', markReady: () => {}, notePromptHook: () => {}, isRunning: () => true, hasSession: () => true, agentState: () => 'ready', identify: (t: string) => (t === 'tok' ? { id: me, gen: 1 } : undefined) }
  })
})
afterEach(async () => { await server.close(); registry.flushAll(); rmSync(root, { recursive: true, force: true }) })

it('nota do agente nasce com cor, tamanho e fonte dos padrões', async () => {
  prefs = validatePreferences({ defaultNoteColor: 'green', defaultNoteSize: { width: 320, height: 240 }, defaultNoteFontSize: 18, defaultNoteFontFamily: 'sans' })
  expect((await post('/note/create', { content: 'oi', name: 'N1' })).status).toBe(200)
  expect(nodesOf('note')[0]).toMatchObject({ color: NOTE_COLOR_HEX.green, size: { w: 320, h: 240 }, fontSize: 18, fontFamily: 'sans' })
})
it('Empilhar repete o ponto de sempre; Espaço Livre afasta a nota de quem já está lá', async () => {
  await post('/note/create', { content: 'a', name: 'A' }); await post('/note/create', { content: 'b', name: 'B' })
  const [a, b] = nodesOf('note'); expect(b!.pos).toEqual(a!.pos)
  prefs = validatePreferences({ agentNotePlacement: 'freeSpace' })
  await post('/note/create', { content: 'c', name: 'C' })
  const c = nodesOf('note').find(n => n.name === 'C')!
  const hit = (n: { pos: { x: number; y: number }; size: { w: number; h: number } }): boolean => c.pos.x < n.pos.x + n.size.w && c.pos.x + c.size.w > n.pos.x && c.pos.y < n.pos.y + n.size.h && c.pos.y + c.size.h > n.pos.y
  expect(nodesOf('note').filter(n => n.id !== c.id).some(hit)).toBe(false)
})
it('portal do agente usa o tamanho padrão dos portais quando não pedem um', async () => {
  prefs = validatePreferences({ defaultPortalSize: { width: 700, height: 500 } })
  expect((await post('/portal', { action: 'create', name: 'P', args: ['https://example.com'] })).status).toBe(200)
  expect(nodesOf('portal')[0]!.size).toEqual({ w: 700, h: 500 })
})
it('portal do agente usa o escopo padrão de armazenamento escolhido nas Configurações', async () => {
  prefs = validatePreferences({ defaultPortalStorage: 'workspace' })
  expect((await post('/portal', { action: 'create', name: 'P', args: ['https://example.com'] })).status).toBe(200)
  expect(nodesOf('portal')[0]).toMatchObject({ storage: 'workspace' })
})
