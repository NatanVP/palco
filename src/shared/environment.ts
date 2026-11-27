/** Onde um terminal roda. `docker` é um contêiner que já existe; `sandbox` é um Docker Sandbox do `sbx`. */
export type Environment =
  | { kind: 'local' }
  | { kind: 'tmux' }
  | { kind: 'ssh'; host: string; user: string; port: number }
  | { kind: 'docker'; context: string; container: string; user: string }
  | { kind: 'sandbox'; name: string; user: string }
export const ENVIRONMENT_KINDS = ['local', 'tmux', 'ssh', 'docker', 'sandbox'] as const
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number]

const BAD = /[\s\u0000-\u001f\u007f]/
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const CTX = /^[A-Za-z0-9_.-]{0,64}$/
const USER = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,63}$/
const fail = (m: string): never => { throw new Error(m) }

/** Valida o ambiente vindo da interface ou do arquivo. Rejeita o que o `ssh`/`docker` leriam como opção (começa com `-`) ou como outro argumento (espaço, controle). */
export function validateEnvironment(raw: unknown): Environment {
  if (raw === undefined || raw === null) return { kind: 'local' }
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail('ambiente inválido')
  const o = raw as Record<string, unknown>
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : fail(`${k} inválido`))
  switch (o.kind) {
    case 'local': return { kind: 'local' }
    case 'tmux': return { kind: 'tmux' }
    case 'ssh': {
      const host = str('host'), user = str('user'), port = o.port === undefined ? 22 : o.port
      if (!host || host.startsWith('-') || BAD.test(host) || host.length > 255) fail('host SSH inválido')
      if (!user || user.startsWith('-') || user.includes('@') || BAD.test(user) || user.length > 64) fail('usuário SSH inválido')
      if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) fail('porta SSH inválida')
      return { kind: 'ssh', host, user, port: port as number }
    }
    case 'docker': {
      const context = o.context === undefined ? '' : str('context'), container = str('container'), user = o.user === undefined ? '' : str('user')
      if (!CTX.test(context)) fail('contexto Docker inválido')
      if (!NAME.test(container)) fail('nome do contêiner inválido')
      if (user !== '' && !USER.test(user)) fail('usuário do contêiner inválido')
      return { kind: 'docker', context, container, user }
    }
    case 'sandbox': {
      const name = str('name'), user = o.user === undefined ? '' : str('user')
      if (!NAME.test(name)) fail('nome da sandbox inválido')
      if (user !== '' && !USER.test(user)) fail('usuário da sandbox inválido')
      return { kind: 'sandbox', name, user }
    }
    default: return fail('tipo de ambiente desconhecido')
  }
}
export function environmentLabel(e: Environment | undefined): string {
  if (!e) return 'Local'
  switch (e.kind) {
    case 'local': return 'Local'
    case 'tmux': return 'tmux'
    case 'ssh': return e.port === 22 ? `${e.user}@${e.host}` : `${e.user}@${e.host}:${e.port}`
    case 'docker': return e.context ? `${e.container} (${e.context})` : e.container
    case 'sandbox': return e.name
  }
}
/** Ambiente em outro computador/contêiner: o CLI do palco lá dentro fala com o app por um túnel TCP. */
export const isRemote = (e: Environment | undefined): boolean => e?.kind === 'ssh' || e?.kind === 'docker' || e?.kind === 'sandbox'
