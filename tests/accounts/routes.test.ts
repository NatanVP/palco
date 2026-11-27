import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../../src/main/accounts/account-store'
import { createAccountRoutes } from '../../src/main/accounts/routes'

it('rotas autenticadas pelo servidor validam payload e resolvem --dir a partir do chamador', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palco-account-routes-'))
  try {
    const accounts = new AccountStore(join(dir, 'accounts.json'))
    const routes = createAccountRoutes(accounts)
    routes['POST /account/add']!({ body: { name: 'C2', agent: 'claude', dir: '.claude-work' }, caller: { cwd: dir, maestro: true } })
    expect(accounts.list()[0]?.configDir).toBe(join(dir, '.claude-work'))
    const reply = routes['GET /account/list']!({ body: {}, caller: { cwd: dir, maestro: true } })
    expect(JSON.parse(reply.body)[0].name).toBe('C2')
    expect(() => routes['POST /account/add']!({ body: { name: 'X', agent: 'shell', dir }, caller: { cwd: dir, maestro: true } })).toThrow(/inválida/)
    routes['POST /account/remove']!({ body: { name: 'C2' }, caller: { cwd: dir, maestro: true } })
    expect(accounts.list()).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('rotas de conta só para terminal maestro', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palco-account-routes-'))
  try {
    const accounts = new AccountStore(join(dir, 'accounts.json'))
    const routes = createAccountRoutes(accounts)
    for (const [route, body] of [['GET /account/list', {}], ['POST /account/add', { name: 'X', agent: 'claude', dir }], ['POST /account/remove', { name: 'X' }]] as const) {
      expect(() => routes[route]!({ body: { ...body }, caller: { cwd: dir } })).toThrow(/maestro/)
      expect(() => routes[route]!({ body: { ...body }, caller: { cwd: dir, maestro: false } })).toThrow(/maestro/)
    }
    expect(accounts.list()).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
