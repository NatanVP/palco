// `palco say` e `palco recall` pelo socket real; o terminal é sempre o do token.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AgentCatalog, PresetStore } from '../../src/main/agents/presets'
import { RoleStore } from '../../src/main/agents/roles'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { ChatService } from '../../src/main/chat/chat-service'
import { ChatStore } from '../../src/main/chat/chat-store'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { startServer } from '../../src/main/server/http-server'
import { HEADER_TOKEN } from '../../src/shared/auth'

let root: string, socket: string, registry: WorkspaceRegistry, server: { close(): Promise<void> }, me: string, chat: ChatService, delivered: string[]
const call = (method: string, path: string, body?: unknown, token = 'tok'): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const req = http.request({ socketPath: socket, method, path, headers: { [HEADER_TOKEN]: token, ...(payload ? { 'content-type': 'application/json' } : {}) } }, res => {
    let data = ''; res.setEncoding('utf8'); res.on('data', c => (data += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
  })
  req.on('error', reject); req.end(payload)
})
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'palco-chat-routes-')); socket = join(root, 's.sock'); mkdirSync(join(root, 'home')); delivered = []
  registry = new WorkspaceRegistry(join(root, 'workspaces'))
  me = registry.get(registry.activeId()).addNode({ kind: 'terminal', floorId: null, name: 'Eu', agent: 'claude', command: 'claude', cwd: root, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } } as never)
  chat = new ChatService({ store: new ChatStore(join(root, 'chats')), home: join(root, 'home'), deliver: (_id, t) => void delivered.push(t), write: () => {}, isRunning: () => true, isAgent: () => true, onTerminalData: () => () => {},
    now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: t => clearTimeout(t as NodeJS.Timeout), settleMs: 60000 })
  const roles = new RoleStore(join(root, 'roles'))
  const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'claude', setTimeout, clearTimeout }, { shellIdleMs: 60000, settleMs: 0 })
  server = await startServer(socket, { registry, broker, chat, agents: new AgentCatalog(new PresetStore(join(root, 'presets.json'), roles), roles),
    terminals: { screenText: () => '', markReady: () => {}, notePromptHook: () => {}, isRunning: () => true, hasSession: () => true, agentState: () => 'ready', identify: (t: string) => (t === 'tok' ? { id: me, gen: 1 } : undefined) } })
})
afterEach(async () => { chat.dispose(); await server.close(); registry.flushAll(); rmSync(root, { recursive: true, force: true }) })

it('say grava a bolha no chat do terminal do token e recall a devolve', async () => {
  await chat.send(me, { text: 'oi', attachments: [] })
  expect((await call('POST', '/say', { text: 'olá, usuário' })).status).toBe(200)
  expect(chat.state(me).entries.map(e => e.text)).toEqual(['oi', 'olá, usuário'])
  const r = await call('GET', '/recall?turns=1')
  expect(r.status).toBe(200); expect(r.body).toContain('olá, usuário')
  const json = await call('GET', '/recall?turns=1&json=1')
  expect(JSON.parse(json.body)).toMatchObject({thread: 'blue', entries: [{text: 'oi'}, {text: 'olá, usuário'}]})
  expect((await call('GET', '/recall?list=1')).body).toContain('blue')
})
it('say recusa pedido inválido com 400 e a razão; sem token é 401/403', async () => {
  expect((await call('POST', '/say', {})).status).toBe(400)
  expect((await call('POST', '/say', { question: { prompt: 'q', options: [{ label: 'A' }] } })).body).toMatch(/duas/)
  expect((await call('POST', '/say', { text: 'x', attach: ['relativo.txt'] })).body).toMatch(/absolut/)
  expect((await call('POST', '/say', { text: 5 })).status).toBe(400)
  expect([401, 403]).toContain((await call('POST', '/say', { text: 'x' }, 'errado')).status)
})
it('say com anexo guarda a cópia; recall attachment devolve o caminho dentro do histórico', async () => {
  const f = join(root, 'r.txt'); writeFileSync(f, 'dados')
  await call('POST', '/say', { text: 'veja', attach: [f] })
  const id = chat.state(me).entries[0]!.attachments![0]!.id
  const r = await call('GET', `/recall/attachment?id=${id}`)
  expect(r.status).toBe(200); expect(r.body).toContain(join(root, 'chats')); expect((await call('GET', '/recall/attachment?id=nao')).status).toBe(404)
})
it('recall valida tópico e turns', async () => {
  expect((await call('GET', '/recall?thread=../x')).status).toBe(400); expect((await call('GET', '/recall?turns=0')).status).toBe(400)
  expect((await call('GET', '/recall?thread=red')).body).toContain('empty')
})
