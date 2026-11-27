// @vitest-environment happy-dom
// Rotinas — painel com Rotinas/Histórico, folha Nova Rotina e o que o processo principal grava.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { registerAreas } from '../src/main/ipc/area'
import { ROUTINE_CH, routinesArea } from '../src/main/ipc/routines'
import { markRejected, RoutineRunner } from '../src/main/routines/routine-runner'
import { RoutineStore } from '../src/main/routines/routine-store'
import { RoutinesPanel } from '../src/renderer/src/routines/RoutinesPanel'
import type { RoutineInput, RoutineView } from '../src/shared/api'
import type { Routine, RoutineRun } from '../src/shared/model'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-routine-history-')) })
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) })

const routine = (over: Partial<Routine> = {}): Omit<Routine, 'id'> => ({ name: 'Pulso', schedule: { kind: 'daily', time: '09:00' }, terminalId: 't1', content: 'oi', enabled: true, createdBy: 'user', ...over })

describe('executor', () => {
  let store: RoutineStore, runner: RoutineRunner, result: string
  const now = new Date(2026, 10, 25, 10, 0)
  const boot = () => {
    vi.useFakeTimers(); vi.setSystemTime(now); result = 'ok'
    store = new RoutineStore(join(dir, 'routines.json'))
    runner = new RoutineRunner({ store, fire: () => result, now: () => new Date(), setTimeout, clearTimeout, terminalName: () => 'Alfa' })
  }

  it('não dispara antes do Início: a primeira vez é a seguinte a ele', () => {
    boot()
    const start = new Date(2026, 10, 28, 12, 0).toISOString()
    store.add(routine({ startsAt: start }))
    store.add(routine({ name: 'Intervalo', schedule: { kind: 'every', seconds: 3600 }, startsAt: start }))
    runner.start()
    expect(store.byName('Pulso')!.nextRun).toBe(new Date(2026, 10, 29, 9, 0).toISOString())
    expect(store.byName('Intervalo')!.nextRun).toBe(new Date(2026, 10, 28, 13, 0).toISOString())
    runner.stop()
  })

  it('registra no histórico o disparo agendado e o "rodar agora", com o terminal e o resultado', async () => {
    boot()
    const id = store.add(routine({ schedule: { kind: 'every', seconds: 60 }, workspaceId: 'w1' })).id
    runner.start()
    vi.advanceTimersByTime(60_000)
    result = 'pulado: terminal ocupado'
    await runner.runNow(id)
    expect(store.history().map((h) => [h.routineName, h.terminalName, h.workspaceId, h.content, h.result])).toEqual([
      ['Pulso', 'Alfa', 'w1', 'oi', 'ok'], ['Pulso', 'Alfa', 'w1', 'oi', 'pulado: terminal ocupado']
    ])
    expect(new RoutineStore(join(dir, 'routines.json')).history()).toEqual(store.history())
    runner.stop()
  })

  it('a recusa do agente corrige também o registro; o histórico guarda só os 200 últimos e dá para apagar', async () => {
    boot()
    const id = store.add(routine()).id
    await runner.runNow(id)
    markRejected(store, 't1', new Date())
    expect(store.history()[0]!.result).toMatch(/^rejeitado/)
    for (let i = 0; i < 205; i++) await runner.runNow(id)
    expect(store.history()).toHaveLength(200)
    const first = store.history()[0]!
    store.removeRun(first.id)
    expect(store.history().some((h) => h.id === first.id)).toBe(false)
    store.clearHistory()
    expect(new RoutineStore(join(dir, 'routines.json')).history()).toEqual([])
    runner.stop()
  })

  it('histórico ilegível não derruba as rotinas', () => {
    writeFileSync(join(dir, 'routines-history.json'), '{quebrado')
    const s = new RoutineStore(join(dir, 'routines.json'))
    s.add(routine())
    expect([s.list().length, s.history()]).toEqual([1, []])
  })
})

describe('processo principal', () => {
  let registry: WorkspaceRegistry, store: RoutineStore, handlers: Map<string, (...a: unknown[]) => unknown>, sent: unknown[][], off: () => void
  let w1: string, w2: string, alfa: string, beto: string
  const call = <T,>(channel: string, ...args: unknown[]): T => handlers.get(channel)!(...args) as T
  const input = (over: Partial<RoutineInput> = {}): RoutineInput => ({ name: 'Resumo', workspaceId: w1, terminalId: alfa, content: 'resuma', skipIfBusy: true, schedule: { kind: 'daily', time: '09:00' }, end: { kind: 'never' }, notify: true, enabled: true, ...over })
  beforeEach(() => {
    registry = new WorkspaceRegistry(join(dir, 'workspaces'))
    w1 = registry.activeId(); w2 = registry.create('Outro')
    const term = (ws: string, name: string) => registry.get(ws).addNode({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: dir, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } } as never)
    alfa = term(w1, 'Alfa'); beto = term(w2, 'Beto')
    store = new RoutineStore(join(dir, 'routines.json'))
    handlers = new Map(); sent = []
    off = registerAreas([routinesArea], { handle: (c, fn) => void handlers.set(c, fn), listen: () => {}, send: (...a) => void sent.push(a), removeChannel: () => {}, deps: { registry, routines: { store, runner: { runNow: async () => 'ok' } } } as never })
  })
  afterEach(() => { off(); registry.flushAll() })

  it('cria no workspace escolhido e lista as rotinas de todos, com o nome de cada um', () => {
    call(ROUTINE_CH.save, input())
    call(ROUTINE_CH.save, input({ name: 'Aviso', workspaceId: w2, terminalId: null, content: 'beba água', end: { kind: 'count', count: 3 }, startsAt: '2027-01-01T12:00:00.000Z' }))
    expect(call<RoutineView[]>(ROUTINE_CH.list).map((r) => [r.name, r.workspace, r.terminal, r.reminder === true, r.remaining, r.startsAt])).toEqual([
      ['Resumo', registry.list().find((w) => w.id === w1)!.name, 'Alfa', false, undefined, undefined],
      ['Aviso', 'Outro', '', true, 3, '2027-01-01T12:00:00.000Z']
    ])
    expect(sent.at(-1)![0]).toBe(ROUTINE_CH.changed)
  })

  it('editar troca agenda, fim e destino, e zera o próximo disparo e o último resultado', () => {
    const id = call<string>(ROUTINE_CH.save, input({ end: { kind: 'count', count: 2 } }))
    store.patch(id, { nextRun: '2027-01-01T00:00:00.000Z', lastRun: { at: '2026-01-01T00:00:00.000Z', result: 'ok' } })
    call(ROUTINE_CH.save, input({ id, name: 'Resumo 2', end: { kind: 'count', count: 2 } }))
    expect(store.byId(id)!.nextRun).toBe('2027-01-01T00:00:00.000Z')
    call(ROUTINE_CH.save, input({ id, name: 'Resumo 2', workspaceId: w2, terminalId: beto, schedule: { kind: 'every', seconds: 120 }, end: { kind: 'date', date: '2027-02-01T23:59:59.999Z' } }))
    const saved = store.byId(id)!
    expect([saved.workspaceId, saved.terminalId, saved.schedule, saved.until, saved.remaining, saved.nextRun, saved.lastRun]).toEqual([w2, beto, { kind: 'every', seconds: 120 }, '2027-02-01T23:59:59.999Z', undefined, undefined, undefined])
  })

  it.each([
    [{ name: '  ' }, /nome/],
    [{ workspaceId: 'nao-existe' }, /workspace/],
    [{ terminalId: 'de-outro' }, /terminal/],
    [{ content: ' ' }, /comando ou o prompt/],
    [{ schedule: { kind: 'once', at: '2020-01-01T00:00:00.000Z' } }, /já passou/],
    [{ schedule: { kind: 'weekly', days: [], time: '09:00' } }, /agenda/],
    [{ schedule: { kind: 'every', seconds: 1 } }, /agenda/],
    [{ end: { kind: 'count', count: 0 } }, /execuções/],
    [{ end: { kind: 'date', date: '2020-01-01T00:00:00.000Z' } }, /término/]
  ] as Array<[Partial<RoutineInput>, RegExp]>)('recusa %o sem gravar', (over, message) => {
    expect(() => call(ROUTINE_CH.save, input(over))).toThrow(message)
    expect(store.list()).toEqual([])
  })

  it('salva um comando em segundo plano sem terminal no workspace escolhido', () => {
    const id = call<string>(ROUTINE_CH.save, input({ terminalId: null, background: true }))
    expect(store.byId(id)).toMatchObject({ terminalId: '', background: true, workspaceId: w1, floorId: null })
    expect(() => call(ROUTINE_CH.save, input({ name: 'Inválida', terminalId: null, background: true, floorId: 'ausente' }))).toThrow(/andar/)
  })

  it('nome repetido é recusado no mesmo workspace e aceito em outro', () => {
    call(ROUTINE_CH.save, input())
    expect(() => call(ROUTINE_CH.save, input({ name: 'resumo' }))).toThrow(/já existe/)
    expect(() => call(ROUTINE_CH.save, input({ workspaceId: w2, terminalId: beto }))).not.toThrow()
  })

  it('liga, roda, exclui e cuida do histórico de qualquer workspace', async () => {
    const id = call<string>(ROUTINE_CH.save, input({ workspaceId: w2, terminalId: beto }))
    call(ROUTINE_CH.setEnabled, id, false)
    expect(store.byId(id)!.enabled).toBe(false)
    expect(await call(ROUTINE_CH.runNow, id)).toBe('ok')
    store.addRun({ routineId: id, routineName: 'Resumo', content: 'x', firedAt: new Date().toISOString(), result: 'ok' })
    expect(sent.at(-1)![0]).toBe(ROUTINE_CH.historyChanged)
    const runs = call<RoutineRun[]>(ROUTINE_CH.history)
    call(ROUTINE_CH.historyRemove, runs[0]!.id)
    store.addRun({ routineId: id, routineName: 'Resumo', content: 'x', firedAt: new Date().toISOString(), result: 'ok' })
    call(ROUTINE_CH.historyClear)
    expect(call<RoutineRun[]>(ROUTINE_CH.history)).toEqual([])
    call(ROUTINE_CH.remove, id)
    expect(store.list()).toEqual([])
  })
})

describe('tela', () => {
  let host: HTMLDivElement, root: ReturnType<typeof createRoot>, api: ReturnType<typeof fakeApi>, closed: number
  const view = (over: Partial<RoutineView> = {}): RoutineView => ({ id: 'r1', ...routine({ workspaceId: 'w1' }), scheduleText: 'todo dia às 09:00', terminal: 'Alfa', workspace: 'Palco', ...over })
  function fakeApi(list: RoutineView[], history: RoutineRun[]) {
    return {
      routine: { list: vi.fn(async () => list), onChange: vi.fn(() => () => {}), save: vi.fn(async (_input: RoutineInput) => 'novo'), setEnabled: vi.fn(async () => {}), runNow: vi.fn(async () => 'ok'), remove: vi.fn(async () => {}), history: vi.fn(async () => history), onHistory: vi.fn(() => () => {}), historyRemove: vi.fn(async () => {}), historyClear: vi.fn(async () => {}) },
      workspaces: { sidebar: async () => ({ active: 'w1', workspaces: [{ id: 'w1', name: 'Palco' }, { id: 'w2', name: 'Outro' }] }) },
      rail: { terminals: vi.fn(async (id: string) => (id === 'w1' ? [{ id: 't1', name: 'Alfa', agent: 'claude' }] : [{ id: 't2', name: 'Beto', agent: 'shell' }])) }
    }
  }
  async function mount(list: RoutineView[] = [], history: RoutineRun[] = []) {
    api = fakeApi(list, history); closed = 0
    Object.assign(window, { palco: api })
    await act(async () => root.render(<RoutinesPanel onClose={() => { closed++ }} />))
  }
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  const dialog = (name: string) => [...host.querySelectorAll('[role=dialog]')].find((d) => d.getAttribute('aria-label') === name) as HTMLElement | undefined
  const sheet = () => dialog('Nova Rotina') ?? dialog('Editar Rotina')!
  const button = (text: string, within: ParentNode = host) => [...within.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent!.trim()) === text) as HTMLButtonElement
  const click = (el: Element) => act(async () => { (el as HTMLElement).click() })
  const field = <T extends HTMLElement = HTMLInputElement>(label: string) => sheet().querySelector(`[aria-label="${label}"]`) as unknown as T
  async function fill(label: string, value: string) {
    const el = field(label), proto = Object.getPrototypeOf(el)
    await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
  }
  const saved = () => api.routine.save.mock.calls.at(-1)![0]

  it('vazio: abas, "Sem Rotinas", o botão + e Concluído', async () => {
    await mount()
    const panel = dialog('Rotinas')!
    expect([...panel.querySelectorAll('[role=tab]')].map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([['Rotinas', 'true'], ['Histórico', 'false']])
    expect(panel.textContent).toContain('Sem Rotinas')
    expect(panel.textContent).toContain('Crie uma rotina para automatizar tarefas ou configurar lembretes.')
    expect(button('Nova Rotina')).toBeDefined()
    await click(button('Concluído'))
    expect(closed).toBe(1)
  })

  it('a folha começa como lembrete diário às 09:00, no workspace aberto, e só cria com nome', async () => {
    await mount()
    await click(button('Nova Rotina'))
    expect(document.activeElement).toBe(field('Nome da Rotina'))
    expect(field<HTMLSelectElement>('Espaço de trabalho').value).toBe('w1')
    const target = field<HTMLSelectElement>('Alvo')
    expect([...target.options].map((o) => o.textContent)).toEqual(['Nenhum (Lembrete)', 'Segundo plano (sem terminal)', 'Alfa'])
    expect(target.value).toBe('')
    expect(field('Notas')).toBeTruthy()
    expect([...sheet().querySelectorAll('[role=tab]')].map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([['Uma vez', 'false'], ['Intervalo', 'false'], ['Diário', 'true'], ['Semanal', 'false']])
    expect(field('Hora').value).toBe('09:00')
    expect(field('Início').value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(field<HTMLSelectElement>('Fim da Repetição').value).toBe('never')
    const notify = field('Notificar ao executar')
    expect([notify.getAttribute('aria-checked') ?? String(notify.checked), notify.disabled]).toEqual(['true', true])
    expect(field('Ativado').checked).toBe(true)
    expect(button('Criar', sheet()).disabled).toBe(true)
    await fill('Nome da Rotina', 'Água')
    await fill('Notas', 'beba água')
    await click(button('Criar', sheet()))
    expect(saved()).toMatchObject({ name: 'Água', workspaceId: 'w1', terminalId: null, content: 'beba água', schedule: { kind: 'daily', time: '09:00' }, end: { kind: 'never' }, notify: true, enabled: true })
    expect(new Date(saved().startsAt!).getTime()).not.toBeNaN()
    expect(dialog('Nova Rotina')).toBeUndefined()
  })

  it('com um terminal alvo pede o prompt e oferece pular se ocupado e script; semanal com fim por execuções', async () => {
    await mount()
    await click(button('Nova Rotina'))
    await fill('Nome da Rotina', 'Revisão')
    await fill('Espaço de trabalho', 'w2')
    await fill('Alvo', 't2')
    expect(button('Criar', sheet()).disabled).toBe(true)
    await fill('Comando', 'git status')
    await click(field('Pular se ocupado'))
    await fill('Script pré-execução', 'date')
    await click(button('Semanal', sheet()))
    await click(button('Criar', sheet()))
    expect(sheet().querySelector('[role=alert]')!.textContent).toContain('dia')
    await click(button('segunda', sheet())); await click(button('sexta', sheet()))
    await fill('Hora', '18:30')
    await fill('Fim da Repetição', 'count')
    await fill('Número de execuções', '4')
    await click(button('Criar', sheet()))
    expect(saved()).toMatchObject({ workspaceId: 'w2', terminalId: 't2', content: 'git status', skipIfBusy: false, preRun: 'date', schedule: { kind: 'weekly', days: [1, 5], time: '18:30' }, end: { kind: 'count', count: 4 } })
  })

  it('intervalo, fim por data e uma vez', async () => {
    await mount()
    await click(button('Nova Rotina'))
    await fill('Nome da Rotina', 'N')
    await click(button('Intervalo', sheet()))
    await fill('A cada', '2'); await fill('Unidade', 'h')
    await fill('Fim da Repetição', 'date'); await fill('Termina em', '2027-03-10')
    await click(button('Criar', sheet()))
    expect(saved().schedule).toEqual({ kind: 'every', seconds: 7200 })
    expect(saved().end).toEqual({ kind: 'date', date: new Date(2027, 2, 10, 23, 59, 59, 999).toISOString() })

    await click(button('Nova Rotina'))
    await fill('Nome da Rotina', 'U')
    await click(button('Uma vez', sheet()))
    expect(field('Início')).toBeNull()
    expect(field('Fim da Repetição')).toBeNull()
    await fill('Data e hora', '2027-05-04T08:15')
    await click(button('Criar', sheet()))
    expect(saved().schedule).toEqual({ kind: 'once', at: new Date(2027, 4, 4, 8, 15).toISOString() })
    expect(saved().startsAt).toBeUndefined()
  })

  it('mostra o erro do processo principal sem fechar a folha; Cancelar e Esc fecham só a folha', async () => {
    await mount()
    api.routine.save.mockRejectedValueOnce(new Error("Error invoking remote method 'palco:routine:save': Error: já existe uma rotina chamada 'N'"))
    await click(button('Nova Rotina'))
    await fill('Nome da Rotina', 'N')
    await click(button('Criar', sheet()))
    expect(sheet().querySelector('[role=alert]')!.textContent).toBe("já existe uma rotina chamada 'N'")
    await click(button('Cancelar', sheet()))
    expect(dialog('Nova Rotina')).toBeUndefined()
    await click(button('Nova Rotina'))
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect([dialog('Nova Rotina'), closed]).toEqual([undefined, 0])
  })

  it('a lista liga, roda, edita com os dados atuais e exclui depois de confirmar', async () => {
    await mount([view({ schedule: { kind: 'weekly', days: [2], time: '07:45' }, remaining: 5, notify: false })])
    const panel = dialog('Rotinas')!
    expect(panel.textContent).toContain('Pulso')
    expect(panel.textContent).toContain('Alfa')
    expect(panel.textContent).toContain('Palco')
    await click(panel.querySelector('[aria-label="Ativar Pulso"]')!)
    expect(api.routine.setEnabled).toHaveBeenCalledWith('r1', false)
    await click(button('Rodar agora Pulso'))
    expect(api.routine.runNow).toHaveBeenCalledWith('r1')
    await click(button('Editar Pulso'))
    expect(field('Nome da Rotina').value).toBe('Pulso')
    expect(field<HTMLSelectElement>('Alvo').value).toBe('t1')
    expect(field('Hora').value).toBe('07:45')
    expect(field('Número de execuções').value).toBe('5')
    await click(button('Salvar', sheet()))
    expect(saved()).toMatchObject({ id: 'r1', schedule: { kind: 'weekly', days: [2], time: '07:45' }, end: { kind: 'count', count: 5 }, notify: false })
    await click(button('Excluir Pulso'))
    expect(api.routine.remove).not.toHaveBeenCalled()
    await click(button('Excluir', host.querySelector('[role=alertdialog]')!))
    expect(api.routine.remove).toHaveBeenCalledWith('r1')
  })

  it('salva um comando em segundo plano sem terminal e exibe a última saída', async () => {
    await mount([view({ terminalId: '', background: true, lastExecution: { startedAt: '2026-11-26T12:00:00Z', durationMs: 12, exitCode: 7, status: 'completed', output: 'resultado do comando' } })])
    expect(host.textContent).toContain('resultado do comando')
    expect(host.textContent).toContain('7')
    await click(button('Editar Pulso'))
    expect(field<HTMLSelectElement>('Alvo').value).toBe('@background')
    await click(button('Salvar', sheet()))
    expect(saved()).toMatchObject({ terminalId: null, background: true, content: 'oi' })
  })

  it('editar rotina de terminal apagado mostra "(removido)" e só salva depois de escolher outro destino', async () => {
    await mount([view({ terminalId: 'sumiu', terminal: '(removido)' })])
    await click(button('Editar Pulso'))
    const target = field<HTMLSelectElement>('Alvo')
    expect(target.value).toBe('sumiu')
    expect(target.selectedOptions[0]!.textContent).toBe('(removido)')
    expect(button('Salvar', sheet()).disabled).toBe(true)
    await fill('Alvo', 't1')
    expect(button('Salvar', sheet()).disabled).toBe(false)
    expect([...target.options].map((o) => o.textContent)).toEqual(['Nenhum (Lembrete)', 'Segundo plano (sem terminal)', 'Alfa'])
  })

  it('editar rotina de workspace apagado passa para o aberto, sem destino antigo', async () => {
    await mount([view({ workspaceId: 'foi-embora', terminalId: 'sumiu', workspace: '(removido)' })])
    await click(button('Editar Pulso'))
    expect(field<HTMLSelectElement>('Espaço de trabalho').value).toBe('w1')
    expect(field<HTMLSelectElement>('Alvo').value).toBe('')
    await click(button('Salvar', sheet()))
    expect(saved()).toMatchObject({ workspaceId: 'w1', terminalId: null })
  })

  it('histórico: vazio, registros do mais novo ao mais antigo, apagar um e limpar', async () => {
    await mount()
    await click(button('Histórico'))
    expect(dialog('Rotinas')!.textContent).toContain('Sem Histórico')
    await act(async () => root.unmount()); root = createRoot(host)
    const run = (id: string, routineName: string, result: string, terminalName?: string): RoutineRun => ({ id, routineId: 'r', routineName, content: 'c', firedAt: '2026-11-25T12:00:00.000Z', result, ...(terminalName ? { terminalName } : {}) })
    await mount([], [run('a', 'Antiga', 'ok'), run('b', 'Nova', 'pulado: terminal ocupado', 'Alfa')])
    await click(button('Histórico'))
    const rows = [...dialog('Rotinas')!.querySelectorAll('li')]
    expect(rows.map((r) => r.querySelector('strong')!.textContent)).toEqual(['Nova', 'Antiga'])
    expect(rows[0]!.textContent).toContain('pulado: terminal ocupado')
    expect(rows[0]!.textContent).toContain('Alfa')
    expect(rows[1]!.textContent).toContain('Lembrete enviado')
    await click(button('Remover do histórico Nova'))
    expect(api.routine.historyRemove).toHaveBeenCalledWith('b')
    await click(button('Limpar Histórico'))
    expect(api.routine.historyClear).toHaveBeenCalled()
  })
})
