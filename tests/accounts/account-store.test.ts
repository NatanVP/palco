import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore, accountEnvironment } from '../../src/main/accounts/account-store'
import { parseArgs } from '../../src/cli/args'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-accounts-test-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
it('semeia contas, inclui sonnet só quando é diretório, e não recria removidas', () => {
  mkdirSync(join(dir, '.claude-sonnet'))
  const file = join(dir, '.palco/accounts.json'), store = new AccountStore(file)
  store.seed(dir)
  expect(store.list().map(a => a.name)).toEqual(['Claude 1', 'Claude 2', 'Codex', 'Antigravity'])
  const a = store.list()[1]!
  store.remove(a.id)
  const reopened = new AccountStore(file); reopened.seed(dir)
  expect(reopened.list().map(a => a.name)).toEqual(['Claude 1', 'Codex', 'Antigravity'])
  expect(statSync(file).mode & 0o777).toBe(0o600)
})
it('não lê nenhum arquivo das pastas de conta e semeia sem sonnet', () => {
  writeFileSync(join(dir, '.claude-sonnet'), 'não é pasta')
  const store = new AccountStore(join(dir, 'accounts.json')); store.seed(dir)
  expect(store.list().map(a => a.name)).toEqual(['Claude 1', 'Codex', 'Antigravity'])
})
it('valida e persiste contas; snapshots não permitem mutar o store', () => {
  const file = join(dir, 'accounts.json'), store = new AccountStore(file)
  const a = store.add({ name: 'Trabalho', agent: 'claude', configDir: dir })
  expect(new AccountStore(file).byId(a.id)).toEqual(a)
  expect(() => store.add({ name: 'trabalho', agent: 'codex', configDir: dir })).toThrow()
  expect(() => store.add({ name: 'X', agent: 'claude', configDir: '../x' })).toThrow()
  store.list()[0]!.name = 'mutado'
  expect(store.byId(a.id)?.name).toBe('Trabalho')
})
it('env correto por agente e fallback com aviso para conta removida/incompatível', () => {
  const store = new AccountStore(join(dir, 'accounts.json'))
  const a = store.add({ name: 'C2', agent: 'claude', configDir: dir })
  expect(accountEnvironment({ agent: 'claude', accountId: a.id }, id => store.byId(id))).toEqual({ env: { CLAUDE_CONFIG_DIR: dir } })
  expect(accountEnvironment({ agent: 'codex', accountId: a.id }, id => store.byId(id)).warning).toMatch(/conta/)
  store.remove(a.id)
  expect(accountEnvironment({ agent: 'claude', accountId: a.id }, id => store.byId(id))).toMatchObject({ env: {}, warning: expect.stringMatching(/padrão/) })
  const c = store.add({ name: 'Codex', agent: 'codex', configDir: dir })
  expect(accountEnvironment({ agent: 'codex', accountId: c.id }, id => store.byId(id)).env).toEqual({ CODEX_HOME: dir })
})
it('CLI account valida subcomandos e suporta --', () => {
  expect(parseArgs(['account', 'add', 'C2', '--agent', 'claude', '--dir', dir])).toEqual({ cmd: 'account-add', name: 'C2', agent: 'claude', dir })
  expect(parseArgs(['account', 'list'])).toEqual({ cmd: 'account-list' })
  expect(parseArgs(['account', 'remove', '--', '-nome'])).toEqual({ cmd: 'account-remove', name: '-nome' })
  expect(() => parseArgs(['account', 'add', 'X', '--agent', 'shell', '--dir', dir])).toThrow()
})
