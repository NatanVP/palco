import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import type { Environment } from '../../shared/environment'
import { exportLines, remotePath, sq } from './quote'

/**
 * Como subir um terminal em cada ambiente. Só monta a receita (programa, argumentos, arquivos temporários, passos de preparo): quem chama
 * executa. REGRA: o token e o ambiente do terminal nunca vão na linha de comando; vão num arquivo 0600 (local, no host remoto ou no contêiner)
 * que o próprio script de partida apaga ao ler. A linha de comando carrega só o caminho desse arquivo.
 */
export interface LaunchFile { path: string; content: string; mode: 0o600 }
export interface LaunchStep { file: string; args: string[]; stdin?: string; signal?: AbortSignal }
export interface LaunchPlan {
  /** Passos que rodam antes do terminal (preparar o host remoto). */
  prepare: LaunchStep[]
  cleanup?: LaunchStep[]
  /** Arquivos locais a gravar antes do spawn; quem chama os apaga depois (`cleanupAfterMs`) ou o script os apaga. */
  files: LaunchFile[]
  spawn: { file: string; args: string[] }
  /** Se o túnel reverso (`ssh -R`) faz parte do spawn, a porta; o app precisa ouvir em loopback nela. */
  tunnelPort?: number
}
export interface LaunchContext {
  terminalId: string
  launchId?: string
  cwd: string
  /** Variáveis do terminal (PALCO_TOKEN, PALCO_TERMINAL…): vão só para o arquivo de partida. */
  env: Record<string, string>
  tunnelPort: number
  /** Onde o CLI remoto acha o app: `tcp://127.0.0.1:porta` (ssh) ou `tcp://<ponte>:porta` (contêiner). */
  endpoint: string
  /** Pasta temporária local 0700 (arquivos de partida). */
  runDir: string
}
const RUN_REMOTE = '~/.palco/run'
const idOk = (id: string): string => { if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('id de terminal inválido'); return id }

export function sshBaseOptions(e: Extract<Environment, { kind: 'ssh' }>): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', ...(e.port !== 22 ? ['-p', String(e.port)] : [])]
}
/** Script de partida: lido uma vez, apaga a si mesmo e entra no shell de login. */
export function startScript(selfPath: string, ctx: Pick<LaunchContext, 'cwd' | 'env' | 'endpoint'>, remoteBinDir?: string, cliPath?: string): string {
  return ['#!/bin/sh', `rm -f -- ${selfPath}`, exportLines({ ...ctx.env, PALCO_SOCKET: ctx.endpoint }),
    ...(cliPath ? [`PALCO_CLI=${remotePath(cliPath)}; export PALCO_CLI`] : []),
    ...(remoteBinDir ? [`PATH=${remoteBinDir}:"$PATH"; export PATH`] : []), `cd -- ${remotePath(ctx.cwd)} 2>/dev/null || cd`, 'exec "${SHELL:-/bin/sh}" -l', ''].join('\n')
}

export function sshLaunch(e: Extract<Environment, { kind: 'ssh' }>, ctx: LaunchContext, o: { scriptPath: string; addToPath: boolean }): LaunchPlan {
  const id = idOk(ctx.terminalId)+(ctx.launchId?'-'+idOk(ctx.launchId):''), run = `${RUN_REMOTE}/${id}.sh`, bin = posix.dirname(o.scriptPath)
  const dest = `${e.user}@${e.host}`, base = sshBaseOptions(e)
  // O script entra por stdin (`sh -s`), com delimitador aleatório: nada do conteúdo vira linha de comando.
  const delim = `PALCO_${randomBytes(8).toString('hex')}`
  const body = startScript(remotePath(run), { cwd: ctx.cwd, env: ctx.env, endpoint: ctx.endpoint }, o.addToPath ? remotePath(bin) : undefined, o.scriptPath)
  const provision = ['umask 077', `mkdir -p ${remotePath(RUN_REMOTE)} ${remotePath(bin)}`, `( sleep 60; rm -f -- ${remotePath(run)} ) </dev/null >/dev/null 2>&1 &`, `cat > ${remotePath(run)} <<'${delim}'`, body.trimEnd(), delim, `chmod 600 ${remotePath(run)}`, ''].join('\n')
  return {
    prepare: [{ file: 'ssh', args: [...base, dest, 'sh -s'], stdin: provision }], cleanup: [{file:'ssh',args:[...base,dest,`rm -f -- ${remotePath(run)}`]}], files: [],
    spawn: { file: 'ssh', args: ['-t', '-o', 'ExitOnForwardFailure=no', '-R', `${ctx.tunnelPort}:127.0.0.1:${ctx.tunnelPort}`, ...base, dest, `sh ${remotePath(run)}`] },
    tunnelPort: ctx.tunnelPort
  }
}

export function dockerLaunch(e: Extract<Environment, { kind: 'docker' }>, ctx: LaunchContext): LaunchPlan {
  const id = idOk(ctx.terminalId)+(ctx.launchId?'-'+idOk(ctx.launchId):''), envFile = posix.join(ctx.runDir, `${id}.env`)
  // `--env-file` (KEY=valor por linha, sem expansão) mantém o token fora da linha de comando.
  const lines = Object.entries({ ...ctx.env, PALCO_SOCKET: ctx.endpoint }).map(([k, v]) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || /[\r\n\0]/.test(v)) throw new Error(`variável inválida: ${k}`); return `${k}=${v}` })
  return {
    prepare: [], files: [{ path: envFile, content: lines.join('\n') + '\n', mode: 0o600 }],
    spawn: { file: 'docker', args: [...(e.context ? ['--context', e.context] : []), 'exec', '-it', ...(e.user ? ['--user', e.user] : []), '--env-file', envFile, '-w', ctx.cwd, e.container, '/bin/sh', '-c', 'exec "${SHELL:-/bin/sh}" -l'] }
  }
}

/** Docker Sandbox pelo `sbx`: requer suporte a `exec`, arquivo de ambiente e terminal interativo. */
export function sandboxLaunch(e: Extract<Environment, { kind: 'sandbox' }>, ctx: LaunchContext): LaunchPlan {
  const id = idOk(ctx.terminalId)+(ctx.launchId?'-'+idOk(ctx.launchId):''), envFile = posix.join(ctx.runDir, `${id}.env`)
  const lines = Object.entries({ ...ctx.env, PALCO_SOCKET: ctx.endpoint }).map(([k, v]) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || /[\r\n\0]/.test(v)) throw new Error(`variável inválida: ${k}`); return `${k}=${v}` })
  return { prepare: [], files: [{ path: envFile, content: lines.join('\n') + '\n', mode: 0o600 }], spawn: { file: 'sbx', args: ['exec', '-it', ...(e.user ? ['--user', e.user] : []), '--env-file', envFile, '-w', ctx.cwd, e.name, '--', '/bin/sh', '-c', 'exec "${SHELL:-/bin/sh}" -l'] } }
}

/** tmux local: sessão `palco-<id>` num servidor próprio (`-L palco`); reatar é explícito; nunca criar com -A (evita anexar inadvertidamente a uma sessão concorrente). */
export function tmuxLaunch(o: { tmuxPath: string; terminalId: string; cwd: string; shell: string; sessionExists: boolean; runDir: string; env: Record<string, string>; launchId?:string; sessionFile?:string }): LaunchPlan {
  const id = idOk(o.terminalId), session = `palco-${id}`, base = ['-L', 'palco']
  if (o.sessionExists) return { prepare: [], files: [], spawn: { file: o.tmuxPath, args: [...base, 'attach-session', '-t', session] } }
  const script = posix.join(o.runDir, `${id}${o.launchId?'-'+idOk(o.launchId):''}.sh`)
  const content = ['#!/bin/sh', `rm -f -- ${sq(script)}`, exportLines(o.env), `exec ${sq(o.shell)} -l`, ''].join('\n')
  return { prepare: [], files: [{ path: script, content, mode: 0o600 }], spawn: { file: o.tmuxPath, args: [...base, 'new-session', ...(o.sessionFile?['-e',`PALCO_SESSION_FILE=${o.sessionFile}`]:[]), '-s', session, '-c', o.cwd, `sh ${sq(script)}`] } }
}
