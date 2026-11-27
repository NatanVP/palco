import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeSchedule, makeRoutineFire, type FireDeps } from '../src/main/routines/fire'
import { RoutineStore } from '../src/main/routines/routine-store'
import { nextRun, parseSchedule } from '../src/main/routines/schedule'
import type { Routine, Workspace } from '../src/shared/model'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-rt8-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const now = new Date(2026, 5, 15, 10, 0, 0) // seg, 15/06/2026 10:00

describe('agenda no formato da skill', () => {
  it('--every: 45s, 30m, 2h, 1h30m e número sozinho em minutos', () => {
    expect(parseSchedule({ every: '45s' }, now)).toEqual({ kind: 'every', seconds: 45 })
    expect(parseSchedule({ every: '30m' }, now)).toEqual({ kind: 'every', seconds: 1800 })
    expect(parseSchedule({ every: '2h' }, now)).toEqual({ kind: 'every', seconds: 7200 })
    expect(parseSchedule({ every: '1h30m' }, now)).toEqual({ kind: 'every', seconds: 5400 })
    expect(parseSchedule({ every: '15' }, now)).toEqual({ kind: 'every', seconds: 900 })
    for (const bad of ['0s', '3s', 'x', '1d', '25h']) expect(() => parseSchedule({ every: bad }, now)).toThrow()
  })
  it('--weekly com vários dias e @hora', () => {
    expect(parseSchedule({ weekly: 'mon,wed,fri@09:00' }, now)).toEqual({ kind: 'weekly', days: [1, 3, 5], time: '09:00' })
    expect(() => parseSchedule({ weekly: 'mon,xyz@09:00' }, now)).toThrow(/dia/)
    expect(() => parseSchedule({ weekly: 'mon' }, now)).toThrow()
  })
  it('--once "AAAA-MM-DD HH:MM" (espaço) e com T; passado recusado', () => {
    expect(parseSchedule({ once: '2026-06-20 15:00' }, now)).toEqual({ kind: 'once', at: new Date(2026, 5, 20, 15, 0).toISOString() })
    expect(parseSchedule({ once: '2026-06-20T15:00' }, now)).toEqual({ kind: 'once', at: new Date(2026, 5, 20, 15, 0).toISOString() })
    expect(() => parseSchedule({ once: '2026-06-01 15:00' }, now)).toThrow(/passou/)
  })
  it('próximo disparo semanal com vários dias; every em segundos', () => {
    expect(nextRun({ kind: 'weekly', days: [1, 3, 5], time: '09:00' }, now)).toEqual(new Date(2026, 5, 17, 9, 0)) // qua
    expect(nextRun({ kind: 'weekly', days: [1], time: '11:00' }, now)).toEqual(new Date(2026, 5, 15, 11, 0))
    expect(nextRun({ kind: 'every', seconds: 45 }, now)).toEqual(new Date(now.getTime() + 45_000))
  })
  it('texto da agenda', () => {
    expect(describeSchedule({ kind: 'every', seconds: 45 })).toBe('a cada 45 s')
    expect(describeSchedule({ kind: 'every', seconds: 5400 })).toBe('a cada 1 h 30 min')
    expect(describeSchedule({ kind: 'weekly', days: [1, 3, 5], time: '09:00' })).toBe('seg, qua, sex às 09:00')
  })
})

describe('store: rotinas antigas continuam valendo', () => {
  it('every em minutos e weekly com um dia viram o formato novo ao ler', () => {
    const file = join(dir, 'routines.json')
    const base = { name: 'x', terminalId: 't', content: 'c', enabled: true, createdBy: 't' }
    writeFileSync(file, JSON.stringify({ type: 'routines', schemaVersion: 1, payload: [
      { ...base, id: 'a', schedule: { kind: 'every', minutes: 5 } },
      { ...base, id: 'b', name: 'y', schedule: { kind: 'weekly', day: 2, time: '08:00' } }
    ] }))
    const store = new RoutineStore(file)
    expect(store.byId('a')?.schedule).toEqual({ kind: 'every', seconds: 300 })
    expect(store.byId('b')?.schedule).toEqual({ kind: 'weekly', days: [2], time: '08:00' })
  })
  it('lembrete (sem terminal), pre-run e opções gravam e voltam', () => {
    const store = new RoutineStore(join(dir, 'routines.json'))
    const r = store.add({ name: 'Daily', schedule: { kind: 'every', seconds: 60 }, terminalId: '', reminder: true, content: 'Hora da daily', enabled: true, createdBy: 'me', preRun: 'date', skipIfBusy: false, notify: false })
    const again = new RoutineStore(join(dir, 'routines.json')).byId(r.id)
    expect(again).toMatchObject({ reminder: true, terminalId: '', preRun: 'date', skipIfBusy: false, notify: false })
    expect(JSON.parse(readFileSync(join(dir, 'routines.json'), 'utf8')).payload).toHaveLength(1)
  })
})

describe('disparo', () => {
  const ws = { id: 'w', name: 'Projeto', nodes: {
    sh: { id: 'sh', kind: 'terminal', name: 'Backend', agent: 'shell', command: '', cwd: '/tmp', floorId: null, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } },
    ag: { id: 'ag', kind: 'terminal', name: 'Agente', agent: 'claude', command: 'claude', cwd: '/tmp', floorId: null, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } }
  }, connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 } } as unknown as Workspace
  const routine = (extra: Partial<Routine> = {}): Routine => ({ id: 'r', name: 'Resumo', schedule: { kind: 'every', seconds: 60 }, terminalId: 'sh', content: 'echo oi', enabled: true, createdBy: 'ag', ...extra })
  function deps(over: Partial<FireDeps> = {}) {
    const writes: string[] = [], prompts: string[] = [], notes: Array<[string, string]> = []
    const d: FireDeps = {
      workspace: () => ws,
      workspaceDir: () => dir,
      terminals: { isRunning: () => true, agentState: () => 'ready', write: (_i, data) => void writes.push(data), deliverPrompt: (_i, t) => void prompts.push(t), dialogOpen: () => null },
      isBusy: () => false,
      notify: (title, body) => void notes.push([title, body]),
      ...over
    }
    return { fire: makeRoutineFire(d), writes, prompts, notes }
  }

  it('lembrete: só a notificação com o texto, nada no terminal', async () => {
    const h = deps()
    expect(await h.fire(routine({ reminder: true, terminalId: '', content: 'Hora da daily' }))).toBe('ok')
    expect(h.notes).toEqual([['Resumo', 'Hora da daily']])
    expect(h.writes).toEqual([])
  })
  it('pre-run: a saída entra no lugar de {{output}}, com as variáveis da skill', async () => {
    const h = deps()
    const script = 'printf "%s|%s|%s|%s" "$PALCO_WORKSPACE_NAME" "$PALCO_WORKSPACE_DIR" "$PALCO_ROUTINE_NAME" "$PALCO_TERMINAL_NAME"'
    expect(await h.fire(routine({ terminalId: 'ag', content: 'Resuma:\n{{output}}', preRun: script, notify: false }))).toBe('ok')
    expect(h.prompts).toEqual([`Resuma:\nProjeto|${dir}|Resumo|Agente`])
  })
  it('pre-run sem {{output}} roda mas não insere; saída diferente de 0 pula o disparo', async () => {
    const h = deps()
    expect(await h.fire(routine({ preRun: 'echo ignorado', notify: false }))).toBe('ok')
    expect(h.writes).toEqual(['echo oi\r'])
    expect(await h.fire(routine({ preRun: 'exit 3', notify: false }))).toMatch(/pulado: .*pre-run.*3/)
    expect(h.writes).toHaveLength(1)
  })
  it('ocupado: pula por padrão; --no-skip-if-busy dispara', async () => {
    const h = deps({ isBusy: () => true })
    expect(await h.fire(routine({ notify: false }))).toMatch(/pulado: .*ocupado/)
    expect(await h.fire(routine({ skipIfBusy: false, notify: false }))).toBe('ok')
    expect(h.writes).toEqual(['echo oi\r'])
  })
  it('notifica ao disparar, a menos que --no-notify', async () => {
    const h = deps()
    await h.fire(routine())
    await h.fire(routine({ notify: false }))
    expect(h.notes).toEqual([['Resumo', 'Disparada em Backend']])
  })
})
