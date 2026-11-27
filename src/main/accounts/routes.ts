import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Account, AgentKind } from '../../shared/model'
import { AccountError, type AccountStore } from './account-store'

/** Shared with recruit/reconfigure: default means no pinned account; named accounts must match the CLI. */
export function resolveAccountId(wanted:string,agent:AgentKind,accounts?:Pick<AccountStore,'byName'>):string|undefined {
 if(wanted.toLowerCase()==='default')return undefined
 if(!['claude','codex','antigravity'].includes(agent))throw new AccountError(400,`conta não se aplica a ${agent}`)
 const found=accounts?.byName(wanted)
 if(!found||found.agent!==agent)throw new AccountError(404,`conta '${wanted}' não existe para ${agent}`)
 return found.id
}

export function accountInput(value: unknown, cwd: string): Omit<Account, 'id'> {
  const body = value as Record<string, unknown> | null
  if (!body || typeof body.name !== 'string' || !['claude', 'codex', 'antigravity'].includes(String(body.agent)) || typeof body.dir !== 'string' || !body.dir.trim()) throw new AccountError(400, 'conta inválida')
  const dir = body.dir.startsWith('~/') ? join(homedir(), body.dir.slice(2)) : resolve(cwd, body.dir)
  return { name: body.name, agent: body.agent as Account['agent'], configDir: dir }
}
type Caller = { cwd: string; maestro?: boolean }
type Ctx = { body: Record<string, unknown>; caller: Caller }

/**
 * Contas pelo socket: só um terminal Maestro gerencia (a interface, pelo IPC, continua livre).
 * Uma conta escolhe a pasta de configuração com que agentes e o probe de uso sobem.
 */
export function createAccountRoutes(accounts: AccountStore) {
  const json = (v: unknown) => ({ status: 200, body: JSON.stringify(v), type: 'application/json' as const })
  const onlyMaestro = (caller: Caller): void => {
    if (caller.maestro !== true) throw new AccountError(403, 'contas só podem ser gerenciadas por um terminal maestro (ou pela interface)')
  }
  return {
    'GET /account/list': ({ caller }: Ctx) => { onlyMaestro(caller); return json(accounts.list()) },
    'POST /account/add': ({ body, caller }: Ctx) => { onlyMaestro(caller); return json(accounts.add(accountInput(body, caller.cwd))) },
    'POST /account/remove': ({ body, caller }: Ctx) => {
      onlyMaestro(caller)
      if (typeof body.name !== 'string') throw new AccountError(400, 'nome da conta inválido')
      const account = accounts.byName(body.name)
      if (!account) throw new AccountError(404, 'conta inexistente')
      accounts.remove(account.id)
      return json({ ok: true })
    }
  }
}
