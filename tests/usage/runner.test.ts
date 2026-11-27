import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { existsSync } from 'node:fs'
import { createUsageRunner } from '../../src/main/usage/runner'

function child() {
  return Object.assign(new EventEmitter(), { pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
it('usa spawn sem shell, pasta vazia, espera initialize e remove pasta após close', async () => {
  const proc = child(), kill = vi.fn(), spawn = vi.fn<NonNullable<Parameters<typeof createUsageRunner>[0]>['spawn'] & {}>((_cmd, _args, _opts) => proc)
  const runner = createUsageRunner({ spawn, kill })
  const writes: string[] = []; proc.stdin.on('data', chunk => writes.push(chunk.toString()))
  const result = runner('codex', ['app-server', '--stdio'], { HOME: '/fake', CODEX_HOME: '/fake/codex' }, ['{"id":1,"method":"initialize"}', '{"method":"initialized"}', '{"id":2,"method":"account/rateLimits/read"}'], line => (line as { id: number }).id === 2, 60000)
  await vi.advanceTimersByTimeAsync(0)
  expect(spawn.mock.calls[0]?.[2]).toMatchObject({ shell: false, detached: true, stdio: ['pipe', 'pipe', 'ignore'] })
  const options = spawn.mock.calls[0]![2]!
  expect(options.env).toMatchObject({ CODEX_HOME: '/fake/codex', CODEX_SQLITE_HOME: expect.stringContaining('palco-usage-') })
  expect(writes.join('')).toContain('initialize')
  proc.stdout.write('{"id":1,"result":{}}\n')
  expect(writes.join('')).toContain('account/rateLimits/read')
  proc.stdout.write('{"id":2,"result":{"rateLimits":{}}}\n')
  expect(kill).toHaveBeenCalledWith(-12345, 'SIGTERM')
  proc.emit('close', 0)
  expect(await result).toMatchObject({ id: 2 })
  expect(existsSync(options.cwd)).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})
it('timeout encerra grupo TERM/KILL após 1s, rejeita erro tipado, dispose mata processos', async () => {
  const proc = child(), kill = vi.fn(), runner = createUsageRunner({ spawn: () => proc, kill })
  const result = runner('claude', [], {}, ['{}'], () => false, 30000)
  const failed = expect(result).rejects.toMatchObject({ code: 'ETIMEDOUT' })
  await vi.advanceTimersByTimeAsync(30000)
  expect(kill).toHaveBeenLastCalledWith(-12345, 'SIGTERM')
  await vi.advanceTimersByTimeAsync(1000)
  expect(kill).toHaveBeenLastCalledWith(-12345, 'SIGKILL')
  await failed
  proc.emit('close', 0)
  expect(vi.getTimerCount()).toBe(0)
  const second = runner('claude', [], {}, ['{}'], () => false, 30000)
  const stopped = expect(second).rejects.toMatchObject({ code: 'ECANCELED' })
  runner.dispose(); await vi.advanceTimersByTimeAsync(1000); await stopped
  proc.emit('close', 0)
  expect(vi.getTimerCount()).toBe(0)
})
it('limita saída e não usa stderr no erro', async () => {
  const proc = child(), runner = createUsageRunner({ spawn: () => proc, kill: vi.fn() })
  const result = runner('claude', [], {}, [], () => false, 30000)
  const failed = expect(result).rejects.toMatchObject({ code: 'EOUTPUT' })
  proc.stdout.write('a'.repeat(1024 * 1024 + 1))
  await vi.advanceTimersByTimeAsync(1000); await failed; proc.emit('close', 1)
})

it('o probe recebe só HOME, PATH, LANG, TERM e a variável da conta (sem SSH_AUTH_SOCK)', async () => {
  const proc = child(), spawn = vi.fn<NonNullable<Parameters<typeof createUsageRunner>[0]>['spawn'] & {}>((_cmd, _args, _opts) => proc)
  const runner = createUsageRunner({ spawn, kill: vi.fn() })
  const env = { HOME: '/h', PATH: '/bin', LANG: 'C.UTF-8', TERM: 'dumb', SSH_AUTH_SOCK: '/tmp/agent.sock', USER: 'u', ANTHROPIC_API_KEY: 'test-placeholder', NO_COLOR: '1', CLAUDE_CONFIG_DIR: '/h/.claude' }
  const done = runner('claude', ['-p'], env, ['{}'], () => true, 1000).catch(() => undefined)
  const got = spawn.mock.calls[0]![2]!.env
  expect(Object.keys(got).sort()).toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH', 'TERM'])
  proc.emit('close', 0)
  await done
  const proc2 = child(), spawn2 = vi.fn<NonNullable<Parameters<typeof createUsageRunner>[0]>['spawn'] & {}>((_cmd, _args, _opts) => proc2)
  const runner2 = createUsageRunner({ spawn: spawn2, kill: vi.fn() })
  const done2 = runner2('codex', ['app-server'], { ...env, CLAUDE_CONFIG_DIR: undefined as unknown as string, CODEX_HOME: '/h/.codex' }, ['{}'], () => true, 1000).catch(() => undefined)
  expect(Object.keys(spawn2.mock.calls[0]![2]!.env).sort()).toEqual(['CODEX_HOME', 'CODEX_SQLITE_HOME', 'HOME', 'LANG', 'PATH', 'TERM'])
  proc2.emit('close', 0)
  await done2
})
it('Antigravity aceita JSON completo formatado sem newline final e passa XDG isolado',async()=>{
 const proc=child(),spawn=vi.fn<NonNullable<Parameters<typeof createUsageRunner>[0]>['spawn'] & {}>(()=>proc),runner=createUsageRunner({spawn,kill:vi.fn()})
 const result=runner('agy',['-p','/usage','--output-format','json'],{HOME:'/account',XDG_CONFIG_HOME:'/account/.config'},[],v=>(v as {status?:string}).status==='SUCCESS',90000)
 proc.stdout.write('{\n  "status": "SUCCESS",\n  "command": {}\n}')
 proc.emit('close',0)
 expect(await result).toEqual({status:'SUCCESS',command:{}})
 expect(spawn.mock.calls[0]?.[2]?.env.XDG_CONFIG_HOME).toBe('/account/.config')
})
