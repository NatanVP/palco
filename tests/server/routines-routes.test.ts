import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AskBroker } from '../../src/main/ask/ask-broker'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { makeRoutineFire } from '../../src/main/routines/fire'
import { RoutineRunner } from '../../src/main/routines/routine-runner'
import { RoutineStore } from '../../src/main/routines/routine-store'
import { startServer } from '../../src/main/server/http-server'
import { HEADER_TOKEN } from '../../src/shared/auth'
import type { Routine } from '../../src/shared/model'

interface Res { status: number; body: string }

let dir: string
let socket: string
let store: WorkspaceStore
let routines: RoutineStore
let runner: RoutineRunner
let server: { close(): Promise<void> }
let writes: Array<[string, string]>
let prompts: Array<[string, string]>
let running: Set<string>
let ids: { me: string; codex: string; shell: string; far: string }

const term = (name: string, agent: 'claude' | 'codex' | 'shell', x: number, maestro = false) =>
  store.addNode({ kind: 'terminal', floorId: null, name, agent, command: '', cwd: '/tmp', ...(maestro ? { maestro: true } : {}), pos: { x, y: 0 }, size: { w: 400, h: 300 } })

function call(method: string, path: string, who: string, body?: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request({ socketPath: socket, method, path, headers: { [HEADER_TOKEN]: `tok-${who}`, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (text += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }))
    })
    req.on('error', reject)
    req.end(data)
  })
}
const post = (path: string, who: string, body: unknown): Promise<Res> => call('POST', path, who, body)

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'palco-rt-'))
  socket = join(dir, 's.sock')
  store = new WorkspaceStore(join(dir, 'ws.json'))
  // Rotinas exigem o Modo Maestro (skill palco-routines): 'Eu' é o Maestro.
  ids = { me: term('Eu', 'claude', 0, true), codex: term('Cod', 'codex', 500), shell: term('Sh', 'shell', 1000), far: term('Longe', 'shell', 2000) }
  store.connect(ids.me, ids.codex)
  store.connect(ids.me, ids.shell)
  writes = []
  prompts = []
  running = new Set(Object.values(ids))
  const terminals = {
    screenText: () => 'tela',
    isRunning: (id: string) => running.has(id),
    agentState: () => 'ready' as const,
    markReady: () => {},
    notePromptHook: () => {},
    identify: (t: string) => {
      const id = Object.values(ids).find((x) => `tok-${x}` === t)
      return id === undefined ? undefined : { id, gen: 1 }
    },
    write: (id: string, data: string) => void writes.push([id, data]),
    deliverPrompt: (id: string, text: string) => void prompts.push([id, text]),
    dialogOpen: (): string | null => null
  }
  routines = new RoutineStore(join(dir, 'routines.json'))
  runner = new RoutineRunner({ store: routines, fire: makeRoutineFire({ workspace: () => store.get(), terminals, background: () => ({ cwd: dir, shell: '/bin/sh', env: { HOME: dir, PATH: '/usr/bin:/bin' } }) }), now: () => new Date(), setTimeout, clearTimeout })
  runner.start()
  const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout })
  server = await startServer(socket, { store, broker, terminals, routines: { store: routines, runner } })
})

afterEach(async () => {
  runner.stop()
  await server.close()
  store.flush()
  rmSync(dir, { recursive: true, force: true })
})

describe('rotas de rotina', () => {
  it('create → list → run → show; agente recebe deliverPrompt e shell recebe o comando com Enter', async () => {
    const created = await post('/routine/create', ids.me, { name: 'pulso', content: 'responda: pulso', every: '30m', terminal: 'Cod' })
    expect(created.status).toBe(200)
    expect(created.body).toContain('pulso')
    expect(created.body).toContain('próximo disparo')
    expect((await post('/routine/create', ids.me, { name: 'ls', content: 'ls -la', daily: '09:00', terminal: 'Sh' })).status).toBe(200)

    const list = JSON.parse((await call('GET', '/routine/list', ids.me)).body) as Array<{ name: string; terminal: string; schedule: string; enabled: boolean }>
    expect(list.map((r) => [r.name, r.terminal, r.enabled])).toEqual([['pulso', 'Cod', true], ['ls', 'Sh', true]])
    expect(list[0]!.schedule).toBe('a cada 30 min')

    expect((await post('/routine/run', ids.me, { name: 'pulso' })).body).toBe('ok')
    expect((await post('/routine/run', ids.me, { name: 'ls' })).body).toBe('ok')
    expect(prompts).toEqual([[ids.codex, 'responda: pulso']])
    expect(writes).toEqual([[ids.shell, 'ls -la\r']])

    const show = JSON.parse((await call('GET', '/routine/show?name=pulso', ids.me)).body) as Routine & { terminal: string }
    expect(show.lastRun?.result).toBe('ok')
    expect(show.terminal).toBe('Cod')
  })

  it('sem --terminal executa em segundo plano e show guarda o resultado', async () => {
    expect((await post('/routine/create', ids.me, { name: 'eu', content: 'oi', every: '5m' })).status).toBe(200)
    expect(routines.byName('eu')).toMatchObject({ terminalId: '', background: true })
    await post('/routine/edit', ids.me, { name: 'eu', content: 'printf resultado; printf erro >&2; exit 7' })
    const run = await post('/routine/run', ids.me, { name: 'eu' })
    expect(run.status).toBe(200)
    expect(run.body).toContain('código de saída: 7')
    expect(run.body).toContain('resultado')
    expect(run.body).toContain('erro')
    const show = JSON.parse((await call('GET', '/routine/show?name=eu', ids.me)).body)
    expect(show.lastExecution).toMatchObject({ exitCode: 7, status: 'completed' })
    expect(show.lastExecution.durationMs).toBeGreaterThanOrEqual(0)
    expect(prompts).toEqual([])
    expect(writes).toEqual([])
  })

  it('terminal fora do alcance → 404; nome duplicado → 409; agenda inválida → 400', async () => {
    expect((await post('/routine/create', ids.me, { name: 'x', content: 'oi', every: '5m', terminal: 'Longe' })).status).toBe(404)
    expect((await post('/routine/create', ids.me, { name: 'x', content: 'oi', every: '5m' })).status).toBe(200)
    expect((await post('/routine/create', ids.me, { name: 'X', content: 'oi', every: '5m' })).status).toBe(409)
    expect((await post('/routine/create', ids.me, { name: 'y', content: 'oi', daily: '25:00' })).status).toBe(400)
    expect((await post('/routine/create', ids.me, { name: 'z', content: 'oi', once: '2000-01-01T00:00' })).body).toContain('horário já passou')
  })

  it('disable impede o disparo; enable volta; delete remove; inexistente → 404', async () => {
    await post('/routine/create', ids.me, { name: 'p', content: 'oi', every: '5m', terminal: 'Cod' })
    expect((await post('/routine/disable', ids.me, { name: 'p' })).status).toBe(200)
    expect(routines.byName('p')).toMatchObject({ enabled: false })
    expect(routines.byName('p')?.nextRun).toBeUndefined()
    expect((await post('/routine/enable', ids.me, { name: 'p' })).status).toBe(200)
    expect(routines.byName('p')?.nextRun).toBeDefined()
    expect((await post('/routine/delete', ids.me, { name: 'p' })).status).toBe(200)
    expect(routines.list()).toEqual([])
    expect((await post('/routine/run', ids.me, { name: 'p' })).status).toBe(404)
  })

  it('disparo pula com motivo quando o terminal some ou parou', async () => {
    await post('/routine/create', ids.me, { name: 'p', content: 'oi', every: '5m', terminal: 'Cod' })
    running.delete(ids.codex)
    expect((await post('/routine/run', ids.me, { name: 'p' })).body).toBe('pulado: terminal parado')
    store.removeNode(ids.codex)
    expect((await post('/routine/run', ids.me, { name: 'p' })).body).toBe('pulado: terminal removido')
    expect(prompts).toEqual([])
  })
})

describe("rotas de rotina na sintaxe da skill", () => {
  it('sem Maestro: 403 com a explicação', async () => {
    const r = await post('/routine/create', ids.codex, { name: 'x', command: 'oi', every: '5m' })
    expect(r.status).toBe(403)
    expect(r.body).toMatch(/Maestro/)
    expect((await call('GET', '/routine/list', ids.codex)).status).toBe(403)
  })

  it('create com --command, --weekly de vários dias, --reminder, --pre-run e as opções', async () => {
    expect((await post('/routine/create', ids.me, { name: 'Daily', command: 'Hora da daily', weekly: 'mon,tue,wed,thu,fri@09:00', reminder: true })).status).toBe(200)
    expect(routines.byName('Daily')).toMatchObject({ reminder: true, terminalId: '', schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' } })
    expect((await post('/routine/create', ids.me, { name: 'Resumo', command: 'Resuma:\n{{output}}', every: '1h30m', terminal: 'Cod', preRun: 'git log', noSkipIfBusy: true, noNotify: true })).status).toBe(200)
    expect(routines.byName('Resumo')).toMatchObject({ preRun: 'git log', skipIfBusy: false, notify: false, schedule: { kind: 'every', seconds: 5400 } })
    expect((await post('/routine/create', ids.me, { name: 'R', command: 'x', every: '5m', reminder: true, terminal: 'Cod' })).status).toBe(400)
    const list = JSON.parse((await call('GET', '/routine/list', ids.me)).body) as Array<{ name: string; shortId: string; terminal: string }>
    expect(list.find((r) => r.name === 'Daily')).toMatchObject({ terminal: '(lembrete)' })
    expect(list[0]!.shortId).toHaveLength(8)
  })

  it('lembrete dispara notificação (sem terminal)', async () => {
    await post('/routine/create', ids.me, { name: 'L', command: 'beber água', every: '30m', reminder: true })
    expect((await post('/routine/run', ids.me, { name: 'L' })).body).toBe('ok')
    expect(prompts).toEqual([])
    expect(writes).toEqual([])
  })

  it('edit muda só o que veio; renomeia; mudar a agenda recalcula o próximo disparo', async () => {
    await post('/routine/create', ids.me, { name: 'A', command: 'oi', every: '5m', terminal: 'Cod' })
    const before = routines.byName('A')!
    expect((await post('/routine/edit', ids.me, { name: 'A', newName: 'B', command: 'tchau', daily: '03:00' })).status).toBe(200)
    const after = routines.byId(before.id)!
    expect(after).toMatchObject({ name: 'B', content: 'tchau', schedule: { kind: 'daily', time: '03:00' }, terminalId: ids.codex })
    expect(after.nextRun).not.toBe(before.nextRun)
    expect((await post('/routine/edit', ids.me, { name: 'B', terminal: 'Sh', noNotify: true })).status).toBe(200)
    expect(routines.byId(before.id)).toMatchObject({ terminalId: ids.shell, notify: false, content: 'tchau' })
    expect((await post('/routine/edit', ids.me, { name: 'B' })).status).toBe(400)
  })

  it('nomes repetidos: a lista de correspondências com ids curtos; --id escolhe', async () => {
    const a = routines.add({ name: 'Auditoria', schedule: { kind: 'every', seconds: 300 }, terminalId: ids.codex, content: 'a', enabled: true, createdBy: ids.me, workspaceId: store.get().id })
    // O store recusa nome repetido ao criar; um rename direto (dado antigo) produz a duplicata.
    const b = routines.add({ name: 'Auditoria 2', schedule: { kind: 'every', seconds: 300 }, terminalId: ids.shell, content: 'b', enabled: true, createdBy: ids.me, workspaceId: store.get().id })
    routines.patch(b.id, { name: 'Auditoria' })
    const ambiguous = await post('/routine/disable', ids.me, { name: 'Auditoria' })
    expect(ambiguous.status).toBe(409)
    expect(ambiguous.body).toContain(a.id.slice(0, 8))
    expect(ambiguous.body).toContain(b.id.slice(0, 8))
    expect((await post('/routine/disable', ids.me, { name: 'Auditoria', id: b.id.slice(0, 6) })).status).toBe(200)
    expect(routines.byId(b.id)?.enabled).toBe(false)
    expect(routines.byId(a.id)?.enabled).toBe(true)
  })
})
