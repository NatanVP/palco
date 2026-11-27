import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoutineRunner } from '../../src/main/routines/routine-runner'
import { RoutineStore } from '../../src/main/routines/routine-store'
import type { Routine } from '../../src/shared/model'

let dir: string
let store: RoutineStore
let fired: string[]
let result: string
let runner: RoutineRunner

const base = (name: string, over: Partial<Routine> = {}): Omit<Routine, 'id'> => ({
  name, schedule: { kind: 'every', seconds: 60 }, terminalId: 't1', content: `oi ${name}`, enabled: true, createdBy: 't0', ...over
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 23, 10, 0, 0))
  dir = mkdtempSync(join(tmpdir(), 'palco-routines-'))
  store = new RoutineStore(join(dir, 'routines.json'))
  fired = []
  result = 'ok'
  runner = new RoutineRunner({ store, fire: (r) => (fired.push(r.name), result), now: () => new Date(), setTimeout, clearTimeout })
})
afterEach(() => {
  runner.stop()
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

it('dispara no horário uma vez e agenda o próximo', () => {
  store.add(base('pulso'))
  runner.start()
  vi.advanceTimersByTime(59_000)
  expect(fired).toEqual([])
  vi.advanceTimersByTime(1_000)
  expect(fired).toEqual(['pulso'])
  const r = store.byName('pulso')!
  expect(r.lastRun?.result).toBe('ok')
  expect(new Date(r.nextRun!).getTime()).toBe(new Date(2026, 10, 23, 10, 2).getTime())
  vi.advanceTimersByTime(60_000)
  expect(fired).toEqual(['pulso', 'pulso'])
})

it('--count: dispara N vezes e se desativa', () => {
  store.add(base('duas', { remaining: 2 }))
  runner.start()
  vi.advanceTimersByTime(5 * 60_000)
  expect(fired).toEqual(['duas', 'duas'])
  expect(store.byName('duas')).toMatchObject({ enabled: false, remaining: 0 })
})

it('--until no passado: desativa sem disparar', () => {
  store.add(base('velha', { until: new Date(2026, 10, 23, 9, 0).toISOString() }))
  runner.start()
  vi.advanceTimersByTime(10 * 60_000)
  expect(fired).toEqual([])
  expect(store.byName('velha')?.enabled).toBe(false)
})

it("depois de horas parado não dispara rajada: no máximo uma vez por ciclo de execução", () => {
  store.add(base('pulso'))
  runner.start()
  runner.stop()
  vi.setSystemTime(new Date(2026, 10, 23, 15, 0, 0)) // app "parado" 5 h
  runner.start()
  vi.advanceTimersByTime(60_000)
  expect(fired).toEqual(['pulso'])
})

it('duas rotinas no mesmo minuto disparam uma vez cada', () => {
  store.add(base('a'))
  store.add(base('b'))
  runner.start()
  vi.advanceTimersByTime(60_000)
  expect(fired.sort()).toEqual(['a', 'b'])
})

it('o resultado do disparo (ex.: pulado) fica em lastRun', () => {
  result = 'pulado: terminal removido'
  store.add(base('orfa'))
  runner.start()
  vi.advanceTimersByTime(60_000)
  expect(store.byName('orfa')?.lastRun?.result).toBe('pulado: terminal removido')
  expect(store.byName('orfa')?.enabled).toBe(true)
})

it('once dispara uma vez e se desativa; desativada não dispara', () => {
  store.add(base('uma', { schedule: { kind: 'once', at: new Date(2026, 10, 23, 10, 5).toISOString() } }))
  store.add(base('off', { enabled: false }))
  runner.start()
  vi.advanceTimersByTime(60 * 60_000)
  expect(fired).toEqual(['uma'])
  expect(store.byName('uma')?.enabled).toBe(false)
})

it('runNow dispara fora de hora sem mudar a agenda; criar com o runner ligado agenda', async () => {
  runner.start()
  const r = store.add(base('nova', { schedule: { kind: 'daily', time: '11:00' } }))
  expect(await runner.runNow(r.id)).toBe('ok')
  expect(fired).toEqual(['nova'])
  vi.advanceTimersByTime(60 * 60_000)
  expect(fired).toEqual(['nova', 'nova'])
})

describe('RoutineStore', () => {
  it('persiste, recarrega e descarta rotina inválida com aviso', () => {
    const file = join(dir, 'r2.json')
    const s = new RoutineStore(file)
    s.add(base('boa'))
    const again = new RoutineStore(file)
    expect(again.list().map((r) => r.name)).toEqual(['boa'])
    writeFileSync(file, JSON.stringify({ type: 'routines', schemaVersion: 1, payload: [again.list()[0], { id: 'x', name: 'ruim' }] }))
    const loaded = new RoutineStore(file)
    expect(loaded.list().map((r) => r.name)).toEqual(['boa'])
    expect(loaded.warning).toContain('1 rotina inválida')
  })

  it('nome duplicado é recusado', () => {
    store.add(base('x'))
    expect(() => store.add(base('X'))).toThrow("já existe uma rotina chamada 'X'")
  })
})

describe('makeRoutineFire', () => {
  it('pula com motivo quando há um diálogo aberto no agente', async () => {
    const { makeRoutineFire } = await import('../../src/main/routines/fire')
    const delivered: string[] = []
    const fire = makeRoutineFire({
      workspace: () => ({ id: 'w', name: 'w', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, floors: {}, activeFloor: null, connections: [],
        nodes: { t1: { id: 't1', kind: 'terminal', floorId: null, name: 'Cod', agent: 'codex', command: 'codex', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } } } }),
      terminals: { isRunning: () => true, agentState: () => 'ready', write: () => {}, deliverPrompt: (_id, t) => void delivered.push(t), dialogOpen: () => 'Approaching rate limits' }
    })
    expect(await fire({ id: 'r', name: 'p', schedule: { kind: 'every', seconds: 60 }, terminalId: 't1', content: 'oi', enabled: true, createdBy: 'x' })).toBe('pulado: diálogo aberto no agente (Approaching rate limits)')
    expect(delivered).toEqual([])
  })
})

describe('markRejected', () => {
  it('troca o ok recente da rotina daquele terminal por rejeitado; antigo ou de outro terminal fica', async () => {
    const { markRejected } = await import('../../src/main/routines/routine-runner')
    const now = new Date()
    const recent = store.add(base('recente', { lastRun: { at: new Date(now.getTime() - 5_000).toISOString(), result: 'ok' } }))
    const old = store.add(base('antiga', { lastRun: { at: new Date(now.getTime() - 60_000).toISOString(), result: 'ok' } }))
    const other = store.add(base('outra', { terminalId: 't2', lastRun: { at: now.toISOString(), result: 'ok' } }))
    markRejected(store, 't1', now)
    expect(store.byId(recent.id)?.lastRun?.result).toBe('rejeitado: o agente não aceitou o prompt (diálogo aberto?)')
    expect(store.byId(old.id)?.lastRun?.result).toBe('ok')
    expect(store.byId(other.id)?.lastRun?.result).toBe('ok')
  })
})
