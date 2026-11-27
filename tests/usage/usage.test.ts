import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readClaudeUsage } from '../../src/main/usage/claude-usage'
import { readCodexUsage } from '../../src/main/usage/codex-usage'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-usage-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const rateLine = (used5h: number, usedWeek: number): string => JSON.stringify({
  timestamp: '2026-11-24T10:00:00Z', type: 'event_msg',
  payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: used5h, window_minutes: 300, resets_at: 4102444800 }, secondary: { used_percent: usedWeek, window_minutes: 10080, resets_at: 4103049600 }, plan_type: 'plus' } }
})
const touch = (file: string, secondsAgo: number): void => {
  const t = Date.now() / 1000 - secondsAgo
  utimesSync(file, t, t)
}

describe('readCodexUsage', () => {
  it('usa o último rate_limits do .jsonl mais recente', async () => {
    const day = join(dir, '2026', '11', '24')
    mkdirSync(day, { recursive: true })
    const old = join(day, 'velho.jsonl'), novo = join(day, 'novo.jsonl')
    writeFileSync(old, rateLine(10, 1) + '\n')
    writeFileSync(novo, [rateLine(50, 5), '{"type":"outra"}', rateLine(91, 16)].join('\n') + '\n')
    touch(old, 600)
    touch(novo, 10)
    const u = await readCodexUsage(dir)
    expect(u).toMatchObject({ agent: 'codex', plan: 'plus', session: { usedPercent: 91 }, weekly: { usedPercent: 16 } })
    expect(u.session?.resetsAt).toBe(new Date(4102444800 * 1000).toISOString())
  })

  it('pula para um arquivo anterior quando o mais recente não tem rate_limits', async () => {
    writeFileSync(join(dir, 'a.jsonl'), rateLine(30, 3) + '\n')
    writeFileSync(join(dir, 'b.jsonl'), '{"type":"sem limites"}\n')
    touch(join(dir, 'a.jsonl'), 100)
    touch(join(dir, 'b.jsonl'), 5)
    expect((await readCodexUsage(dir)).session?.usedPercent).toBe(30)
  })

  it('arquivo grande: lê só o fim', async () => {
    const big = join(dir, 'grande.jsonl')
    writeFileSync(big, rateLine(1, 1) + '\n' + ('{"x":"' + 'a'.repeat(1000) + '"}\n').repeat(2000) + rateLine(77, 7) + '\n')
    expect((await readCodexUsage(dir)).session?.usedPercent).toBe(77)
  })

  it('sem sessões: erro legível', async () => {
    expect(await readCodexUsage(join(dir, 'nao-existe'))).toMatchObject({ agent: 'codex', error: 'sem sessão recente do Codex' })
  })
})

describe('readClaudeUsage', () => {
  const status = (used5h?: number): string => JSON.stringify({ session_id: 'x', cwd: '/c', ...(used5h === undefined ? {} : { rate_limits: { five_hour: { used_percentage: used5h, resets_at: 4102444800 }, seven_day: { used_percentage: 16, resets_at: 4103049600 } } }) })

  it('usa o arquivo mais recente que tenha rate_limits', async () => {
    writeFileSync(join(dir, 't1.json'), status(16))
    writeFileSync(join(dir, 't2.json'), status())
    writeFileSync(join(dir, 't3.json'), status(40))
    touch(join(dir, 't1.json'), 300)
    touch(join(dir, 't2.json'), 1)
    touch(join(dir, 't3.json'), 60)
    const u = await readClaudeUsage(dir)
    expect(u).toMatchObject({ agent: 'claude', session: { usedPercent: 40 }, weekly: { usedPercent: 16 } })
    expect(u.weekly?.resetsAt).toBe(new Date(4103049600 * 1000).toISOString())
  })

  it('sem leitura: erro explicando de onde vem', async () => {
    writeFileSync(join(dir, 't.json'), status())
    expect((await readClaudeUsage(dir)).error).toBe('ainda sem leitura: abra um Claude pelo palco e mande uma mensagem')
  })
})

describe('janela que já renovou', () => {
  it('Codex: resets_at no passado vira 0% e sem horário (a leitura é anterior à renovação)', async () => {
    const past = Math.floor(Date.now() / 1000) - 60
    writeFileSync(join(dir, 'a.jsonl'), JSON.stringify({ payload: { rate_limits: { primary: { used_percent: 91, resets_at: past }, secondary: { used_percent: 16, resets_at: past + 86400 } } } }) + '\n')
    const u = await readCodexUsage(dir)
    expect(u.session).toEqual({ usedPercent: 0, resetsAt: null })
    expect(u.weekly?.usedPercent).toBe(16)
  })

  it('Claude: idem', async () => {
    const past = Math.floor(Date.now() / 1000) - 60
    writeFileSync(join(dir, 't.json'), JSON.stringify({ rate_limits: { five_hour: { used_percentage: 80, resets_at: past }, seven_day: { used_percentage: 20, resets_at: past + 86400 } } }))
    expect((await readClaudeUsage(dir)).session).toEqual({ usedPercent: 0, resetsAt: null })
  })
})

describe('cachedUsage', () => {
  it('reaproveita a leitura dentro do prazo e relê depois', async () => {
    const { cachedUsage } = await import('../../src/main/usage/cache')
    let reads = 0
    let now = 1000
    const get = cachedUsage(async () => { reads++; return [] }, 15_000, () => now)
    await Promise.all([get(), get(), get()])
    expect(reads).toBe(1)
    now += 14_000
    await get()
    expect(reads).toBe(1)
    now += 2_000
    await get()
    expect(reads).toBe(2)
  })
})
