import { UsageService } from '../../src/main/usage/usage-service'
import type { Runner } from '../../src/main/usage/providers'

const accounts = { list: () => [1, 2, 3].map(i => ({ id: String(i), name: `Claude ${i}`, agent: 'claude' as const, configDir: `/fake/${i}` })) }
const answer = { type: 'control_response', response: { request_id: 'palco-usage', response: { rate_limits_available: true, subscription_type: 'pro', rate_limits: { five_hour: { utilization: 20 } } } } }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
it('só consulta visível, no máximo dois em paralelo e mantém 60s inclusive refresh manual', async () => {
  const pending: Array<() => void> = []; let active = 0, max = 0
  const runner: Runner = vi.fn(() => new Promise(resolve => { active++; max = Math.max(max, active); pending.push(() => { active--; resolve(answer) }) }))
  const service = new UsageService({ accounts, runner, now: Date.now, setTimeout })
  expect(runner).not.toHaveBeenCalled()
  service.setVisible(true)
  expect(runner).toHaveBeenCalledTimes(2)
  pending.shift()!(); await vi.advanceTimersByTimeAsync(0)
  expect(runner).toHaveBeenCalledTimes(3)
  pending.shift()!(); pending.shift()!(); await vi.advanceTimersByTimeAsync(0)
  expect(max).toBe(2); expect(service.snapshot()).toHaveLength(3)
  await service.refresh(); expect(runner).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(60_000); const refresh = service.refresh('1')
  expect(runner).toHaveBeenCalledTimes(4); pending.shift()!(); await refresh
  service.setVisible(false); await vi.advanceTimersByTimeAsync(600_000)
  expect(runner).toHaveBeenCalledTimes(4); service.dispose()
})
it('falhas isoladas com backoff; cache mantém último sucesso stale; dispose cancela timers', async () => {
  let fail = false
  const runner: Runner = vi.fn(async () => { if (fail) throw Object.assign(new Error('hidden'), { code: 'ETIMEDOUT' }); return answer })
  const service = new UsageService({ accounts: { list: () => accounts.list().slice(0, 1) }, runner, now: Date.now, setTimeout })
  service.setVisible(true); await vi.advanceTimersByTimeAsync(0)
  expect(service.snapshot()[0]).toMatchObject({ accountId: '1', accountName: 'Claude 1', isStale: false, lastSuccessAt: expect.any(String) })
  fail = true; await vi.advanceTimersByTimeAsync(300_000)
  expect(service.snapshot()[0]).toMatchObject({ session: { usedPercent: 20 }, isStale: true, error: expect.stringMatching(/Claude 1/) })
  const count = vi.mocked(runner).mock.calls.length
  await vi.advanceTimersByTimeAsync(299_999); expect(runner).toHaveBeenCalledTimes(count)
  await vi.advanceTimersByTimeAsync(1); expect(runner).toHaveBeenCalledTimes(count + 1)
  await vi.advanceTimersByTimeAsync(300_000); expect(runner).toHaveBeenCalledTimes(count + 1)
  service.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('remover conta enfileirada e ocultar não lança exceção nem publica resultado removido', async () => {
  let list = accounts.list()
  const pending: Array<() => void> = []
  const runner: Runner = vi.fn(() => new Promise(resolve => pending.push(() => resolve(answer))))
  const service = new UsageService({ accounts: { list: () => list }, runner, now: Date.now, setTimeout })
  service.setVisible(true)
  list = list.slice(0, 2)
  expect(service.snapshot()).toHaveLength(2)
  expect(() => service.setVisible(false)).not.toThrow()
  pending.forEach(done => done()); await vi.advanceTimersByTimeAsync(0)
  expect(runner).toHaveBeenCalledTimes(2); service.dispose()
})
it('uma conta com CLI ausente não impede outra; backoff cresce até 30min', async () => {
  const times: number[] = []
  const runner: Runner = vi.fn(async (_cmd, _args, env) => {
    if (env.CLAUDE_CONFIG_DIR === '/fake/1') { times.push(Date.now()); throw Object.assign(new Error('não registrar'), { code: 'ENOENT' }) }
    return answer
  })
  const service = new UsageService({ accounts, runner, now: Date.now, setTimeout })
  service.setVisible(true); await vi.advanceTimersByTimeAsync(0)
  expect(service.snapshot()[0]?.error).toMatch(/Claude 1.*não encontrado/)
  expect(service.snapshot()[1]?.session?.usedPercent).toBe(20)
  for (const delay of [300000, 600000, 1200000, 1800000, 1800000]) await vi.advanceTimersByTimeAsync(delay)
  expect(times.slice(1).map((t, i) => t - times[i]!)).toEqual([300000, 600000, 1200000, 1800000, 1800000])
  service.dispose()
})
