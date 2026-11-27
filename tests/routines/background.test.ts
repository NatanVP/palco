import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeRoutineFire } from '../../src/main/routines/fire'
import { RoutineRunner } from '../../src/main/routines/routine-runner'
import { RoutineStore } from '../../src/main/routines/routine-store'
import type { Routine, RoutineExecution, Workspace } from '../../src/shared/model'
import { parseRoutineInput } from '../../src/main/routines/routine-input'
import { draftOf, newDraft, toInput } from '../../src/renderer/src/routines/routine-form'
import { shQuote } from '../../src/shared/agent-command'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'palco-background-')); dirs.push(dir); return dir }
afterEach(() => { vi.useRealTimers(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })
const routine = (extra: Partial<Routine> = {}): Routine => ({ id: 'r', name: 'Comando', content: 'printf pronto', terminalId: '', background: true, enabled: true, createdBy: 'user', workspaceId: 'w', schedule: { kind: 'every', seconds: 10 }, ...extra })
const fire = (cwd: string, timeoutMs = 1000) => makeRoutineFire({
  workspace: () => ({ id: 'w', name: 'Projeto', nodes: {} }) as Workspace,
  background: () => ({ cwd, shell: '/bin/sh', env: { PATH: '/usr/bin:/bin', HOME: cwd } }), backgroundTimeoutMs: timeoutMs,
  terminals: { isRunning: () => false, write: () => {}, deliverPrompt: () => {}, agentState: () => 'ready', dialogOpen: () => null }
})

describe('comandos de rotina em segundo plano', () => {
  it('executa sem terminal, usa cwd e ambiente e captura stdout, stderr e código de saída', async () => {
    const dir = temp(), execute = fire(dir)
    const result = await execute(routine({ content: 'printf "$HOME"; printf erro >&2; printf arquivo > criado.txt; exit 7' }))
    expect(result).toMatchObject({ result: 'erro', execution: { exitCode: 7, status: 'completed' } })
    expect(typeof result === 'object' && result.execution.output).toBe(dir + 'erro')
    expect(readFileSync(join(dir, 'criado.txt'), 'utf8')).toBe('arquivo')
  })
  it('limita a saída aos últimos 64 KiB e preserva UTF-8 válido', async () => {
    const command = `${shQuote(process.execPath)} -e 'process.stdout.write("á".repeat(70000)+"fim")'`
    const result = await fire(temp())(routine({ content: command }))
    expect(typeof result).toBe('object')
    if (typeof result !== 'object') return
    expect(Buffer.byteLength(result.execution.output)).toBeLessThanOrEqual(65536)
    expect(result.execution.output.endsWith('fim')).toBe(true); expect(result.execution.output).not.toContain('�')
  })
  it('encerra o grupo de processos ao atingir o teto de tempo', async () => {
    const result = await fire(temp(), 40)(routine({ content: 'sleep 30 & wait' }))
    expect(result).toMatchObject({ result: 'erro', execution: { status: 'timedOut', exitCode: null } })
  })
  it('registra falha de shell sem perder o resultado', async () => {
    const execute = makeRoutineFire({ workspace: () => ({ nodes: {} }) as Workspace, background: () => ({ cwd: temp(), shell: '/nao-existe/shell', env: {} }), terminals: {} as never })
    expect(await execute(routine())).toMatchObject({ result: 'erro', execution: { status: 'failed', exitCode: null } })
  })
  it('preserva a execução direcionada e não usa um terminal como fallback do segundo plano', async () => {
    expect(await fire(temp())(routine({ background: undefined, terminalId: 'apagado' }))).toBe('pulado: terminal removido')
  })
})

describe('registro e concorrência de rotinas em segundo plano', () => {
  it('persiste resultado completo e aceita rotinas antigas sem conversão manual', async () => {
    const path = join(temp(), 'routines.json'), store = new RoutineStore(path)
    const r = store.add(routine()), legacy = store.add(routine({ name: 'Legada', background: undefined, terminalId: 't' }))
    const runner = new RoutineRunner({ store, fire: fire(temp()), now: () => new Date(), setTimeout, clearTimeout })
    expect(await runner.runNow(r.id)).toContain('código de saída: 0')
    const reloaded = new RoutineStore(path)
    expect(reloaded.byId(r.id)?.lastExecution).toMatchObject({ exitCode: 0, output: 'pronto', status: 'completed' })
    expect(reloaded.byId(legacy.id)?.terminalId).toBe('t')
  })
  it('pula e registra uma segunda execução enquanto a primeira ainda está ativa', async () => {
    const store = new RoutineStore(join(temp(), 'routines.json')), r = store.add(routine())
    let finish!: (value: { result: string; execution: RoutineExecution }) => void
    const execute = vi.fn(() => new Promise<{ result: string; execution: RoutineExecution }>(resolve => { finish = resolve }))
    const runner = new RoutineRunner({ store, fire: execute, now: () => new Date(), setTimeout, clearTimeout })
    const pending = runner.runNow(r.id)
    expect(await runner.runNow(r.id)).toBe('pulado: rotina já em execução')
    expect(store.history().at(-1)?.result).toBe('pulado: rotina já em execução'); expect(execute).toHaveBeenCalledTimes(1)
    finish({ result: 'ok', execution: { startedAt: new Date().toISOString(), durationMs: 1, exitCode: 0, output: 'fim', status: 'completed' } })
    expect(await pending).toContain('fim')
  })
  it('runNow espera até 60 s e permite consultar a conclusão posterior', async () => {
    vi.useFakeTimers()
    const store = new RoutineStore(join(temp(), 'routines.json')), r = store.add(routine())
    let finish!: (value: { result: string; execution: RoutineExecution }) => void
    const runner = new RoutineRunner({ store, fire: () => new Promise(resolve => { finish = resolve }), now: () => new Date(), setTimeout, clearTimeout })
    const pending = runner.runNow(r.id)
    await vi.advanceTimersByTimeAsync(60000)
    expect(await pending).toContain('continua rodando'); expect(await runner.runNow(r.id)).toContain('já em execução')
    finish({ result: 'ok', execution: { startedAt: new Date().toISOString(), durationMs: 61000, exitCode: 0, output: 'concluiu', status: 'completed' } })
    await vi.advanceTimersByTimeAsync(1)
    expect(store.byId(r.id)?.lastExecution?.output).toBe('concluiu')
  })
})

it('o formulário distingue segundo plano, lembrete e terminal e preserva rotinas salvas', () => {
  const draft = { ...newDraft('w', new Date()), name: 'Comando', content: 'echo pronto', terminalId: '@background' }
  const result = toInput(draft)
  expect('input' in result && parseRoutineInput(result.input, new Date()).routine).toMatchObject({ background: true, reminder: undefined, terminalId: '' })
  const old = { ...routine({ background: undefined, terminalId: 't' }), workspace: 'Projeto', terminal: 'Shell', scheduleText: '' }
  expect(draftOf(old, new Date()).terminalId).toBe('t')
})

it('a agenda registra disparos pulados sem executar o mesmo comando em paralelo', async () => {
  vi.useFakeTimers()
  const store = new RoutineStore(join(temp(), 'routines.json')); store.add(routine())
  const execute = vi.fn(() => new Promise<string>(() => {}))
  const runner = new RoutineRunner({ store, fire: execute, now: () => new Date(), setTimeout, clearTimeout })
  runner.start(); await vi.advanceTimersByTimeAsync(21000)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(store.history().some(run => run.result === 'pulado: rotina já em execução')).toBe(true)
  runner.stop()
})

it('o pre-run do segundo plano usa o mesmo diretório e fornece a saída ao comando', async () => {
  const dir = temp(), result = await fire(dir)(routine({ preRun: 'pwd', content: "printf '{{output}}'" }))
  expect(typeof result === 'object' && result.execution.output).toBe(dir)
})

it('encerrar o executor termina os comandos ativos sem deixar subprocessos esperando', async () => {
  const execute = fire(temp()), pending = execute(routine({ content: 'sleep 30 & wait' }))
  execute.stop()
  expect(await pending).toMatchObject({ execution: { exitCode: null } })
})

 it('a ajuda explica o destino padrão e a espera do comando run', async () => {
  const { helpFor } = await import('../../src/cli/help')
  const help = helpFor(['routine', '--help'])
  expect(help).toContain('segundo plano, sem terminal')
  expect(help).toContain('10 min')
  expect(help).toContain('60 s')
  expect(help).toContain('show mostra início, duração, código e saída')
})
