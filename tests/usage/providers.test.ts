import { queryClaudeUsage, queryCodexUsage, type Runner } from '../../src/main/usage/providers'

it('Claude pede get_usage, usa ambiente mínimo e mapeia percent/ISO/plano', async () => {
  const line = { type: 'control_response', response: { request_id: 'palco-usage', response: { rate_limits_available: true, subscription_type: 'pro', rate_limits: { five_hour: { utilization: 54, resets_at: '2030-01-01T00:00:00Z' }, seven_day: { utilization: 24, resets_at: '2030-01-07T00:00:00Z' } } } } }
  const run: Runner = vi.fn<Runner>(async (cmd, args, env, input, until, timeout) => {
    expect(cmd).toBe('claude'); expect(args).toContain('--no-session-persistence')
    // O probe não pode executar hooks nem subir MCP da conta (ex.: SessionStart do ai-memory).
    expect(args).toContain('--strict-mcp-config')
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual({ disableAllHooks: true })
    expect(env.CLAUDE_CONFIG_DIR).toBe('/fake/sonnet'); expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(JSON.parse(input[0]!)).toMatchObject({ request: { subtype: 'get_usage', skip_behaviors: true } })
    expect(until({ type: 'system' })).toBe(false); expect(until(line)).toBe(true); expect(timeout).toBe(30000)
    return line
  })
  expect(await queryClaudeUsage('/fake/sonnet', { run, timeoutMs: 30000 })).toMatchObject({ agent: 'claude', plan: 'pro', session: { usedPercent: 54, resetsAt: '2030-01-01T00:00:00.000Z' }, weekly: { usedPercent: 24 } })
})
it('Codex inicializa e consulta rateLimits; resetsAt é epochSeconds', async () => {
  const run: Runner = vi.fn<Runner>(async (cmd, args, env, input, until) => {
    expect(cmd).toBe('codex'); expect(args).toEqual(['app-server', '--stdio']); expect(env.CODEX_HOME).toBe('/fake/codex')
    expect(input.map(s => JSON.parse(s).method)).toEqual(['initialize', 'initialized', 'account/rateLimits/read'])
    expect(until({ id: 1, result: {} })).toBe(false)
    return { id: 2, result: { rateLimits: { planType: 'plus', primary: { usedPercent: 74, resetsAt: 1893456000 }, secondary: { usedPercent: 28 } } } }
  })
  expect(await queryCodexUsage('/fake/codex', { run, timeoutMs: 60000 })).toMatchObject({ plan: 'plus', session: { usedPercent: 74, resetsAt: '2030-01-01T00:00:00.000Z' }, weekly: { usedPercent: 28, resetsAt: null } })
})
it('timeout, CLI ausente, não autenticado e payload inválido dão erro curto sem vazar saída', async () => {
  for (const [failure, pattern] of [[Object.assign(new Error('private content'), { code: 'ENOENT' }), /não encontrado/], [Object.assign(new Error('private content'), { code: 'ETIMEDOUT' }), /tempo/]] as const) {
    const u = await queryClaudeUsage('/fake', { run: async () => { throw failure }, timeoutMs: 1 })
    expect(u.error).toMatch(pattern); expect(u.error).not.toContain('private')
  }
  const u = await queryCodexUsage('/fake', { run: async () => ({ id: 2, error: { code: 'notSignedIn', message: 'private' } }), timeoutMs: 1 })
  expect(u.error).toMatch(/login/)
  expect((await queryClaudeUsage('/fake', { run: async () => null, timeoutMs: 1 })).error).toBeTruthy()
  expect((await queryClaudeUsage('/fake', { run: async () => ({ type: 'control_response', response: { request_id: 'palco-usage', response: { rate_limits_available: false } } }), timeoutMs: 1 })).error).toMatch(/limites/)
})
