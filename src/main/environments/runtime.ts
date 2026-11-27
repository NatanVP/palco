import { mkdirSync, rmSync, writeFileSync, chmodSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { posix, join } from 'node:path'
import type { TerminalNode } from '../../shared/model'
import { dockerLaunch, sandboxLaunch, sshBaseOptions, sshLaunch, tmuxLaunch, type LaunchPlan, type LaunchStep } from './launch'
import { remotePath, sq } from './quote'
import type { TunnelServer } from './tunnel'

export interface EnvironmentSettings {
  sshEnabled: boolean; dockerEnabled: boolean; sandboxEnabled: boolean; localTmuxEnabled: boolean
  tunnelPort: number; sshScriptPath: string; sshAddToPath: boolean
}
export interface EnvironmentDeps {
  settings(): EnvironmentSettings
  tunnel: Pick<TunnelServer, 'listen'>
  runDir: string
  run(step: LaunchStep, timeoutMs: number): Promise<{ code: number | null; out: string }>
  which(program: string): string | null
  cliBundle(): Buffer | null
  cleanupAfterMs?: number
}
export interface EnvironmentInput {
  node: TerminalNode; shell: string; env: Record<string, string>; cwd: string; home: string
  signal?: AbortSignal
  /** Explicit restart destroys the old tmux pane instead of reattaching. */
  restart?: boolean
  settingsContent?: string
}
export type Prepared = {
  file: string; args: string[]; env: Record<string, string>; cwd: string
  cleanup(): void | Promise<void>
  warning?: string; remoteCli?: boolean; reused?: boolean; sessionFile?: string
} | { error: string; fallbackLocal?: boolean }
const STEP_MS = 25000

export class EnvironmentRuntime {
  private readonly provisioned = new Set<string>()
  private readonly teardown = new Map<string, Promise<void>>()
  private readonly leases = new Map<string, string>()
  constructor(private readonly d: EnvironmentDeps) {}

  /** A removed node must not leave a detached tmux session. New preparations wait for this teardown. */
  dispose(id: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return Promise.resolve()
    const previous = this.teardown.get(id) ?? Promise.resolve()
    const task = previous.then(async () => {
      const tmux = this.d.which('tmux')
      if (tmux) await this.d.run({ file: tmux, args: ['-L', 'palco', 'kill-session', '-t', `palco-${id}`] }, 5000)
      rmSync(join(this.d.runDir, `tmux-${id}.session`), { force: true })
      this.leases.delete(id)
    }).then(() => {}, () => {})
    this.teardown.set(id, task)
    void task.finally(() => { if (this.teardown.get(id) === task) this.teardown.delete(id) })
    return task
  }

  private writeSession(file: string, value: { token: string; socket: string }): void {
    const tmp = file + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, ...value }), { mode: 0o600, flag: 'wx' })
      renameSync(tmp, file)
    } finally { rmSync(tmp, { force: true }) }
  }

  async prepare(i: EnvironmentInput): Promise<Prepared> {
    const e = i.node.environment, s = this.d.settings()
    if (!e || e.kind === 'local') return { error: 'ambiente local não passa por aqui' }
    await this.teardown.get(i.node.id)
    const check = () => { if (i.signal?.aborted) throw new Error('Partida cancelada.') }
    check()
    const run = async (step: LaunchStep, timeout = STEP_MS) => {
      check()
      const result = await this.d.run({ ...step, signal: i.signal }, timeout)
      check()
      return result
    }
    const { PALCO_TOKEN, ...outer } = i.env
    const scoped: Record<string, string> = Object.fromEntries(Object.entries({
      PALCO_TOKEN, PALCO_TERMINAL_ID: i.node.id, PALCO_TERMINAL: i.node.id,
      PALCO_NAME: i.env.PALCO_NAME, PALCO_CLI: 'palco', PALCO_CLAUDE_SETTINGS_FILE: i.env.PALCO_CLAUDE_SETTINGS_FILE
    }).filter((v): v is [string, string] => typeof v[1] === 'string'))
    mkdirSync(this.d.runDir, { recursive: true, mode: 0o700 })
    chmodSync(this.d.runDir, 0o700)
    // Every attempt owns different ephemeral files, including concurrent cancelled generations.
    const ctx = {
      terminalId: i.node.id, launchId: randomUUID(), cwd: i.node.cwd, env: scoped,
      tunnelPort: s.tunnelPort, endpoint: `tcp://127.0.0.1:${s.tunnelPort}`, runDir: this.d.runDir
    }
    let plan: LaunchPlan | undefined, warning: string | undefined, sessionFile: string | undefined
    const settingsCleanup: LaunchStep[] = []
    let reused = false, lease: string | undefined, cleaned = false
    const settingsFile = i.settingsContent && e.kind !== 'tmux' ? `/tmp/palco-settings-${randomUUID()}.json` : undefined
    if (settingsFile) scoped.PALCO_CLAUDE_SETTINGS_FILE = settingsFile
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      for (const f of plan?.files ?? []) rmSync(f.path, { force: true })
      // Cleanup of the previous attachment cannot remove a newly rotated credential.
      if (sessionFile && this.leases.get(i.node.id) === lease) {
        rmSync(sessionFile, { force: true }); this.leases.delete(i.node.id)
      }
      for (const step of plan?.cleanup ?? []) {
        try { await this.d.run(step, STEP_MS) } catch { /* Remote expiry was armed before writing token bytes. */ }
      }
      for (const step of settingsCleanup) {
        try { await this.d.run(step, STEP_MS) } catch { /* The remote terminal may already be gone. */ }
      }
    }
    try {
      switch (e.kind) {
        case 'tmux': {
          if (!s.localTmuxEnabled) return { error: 'tmux local está desligado (Configurações › Geral › Ambientes)' }
          const tmux = this.d.which('tmux')
          if (!tmux) return { error: 'tmux não foi encontrado no PATH' }
          if (i.restart) await run({ file: tmux, args: ['-L', 'palco', 'kill-session', '-t', `palco-${i.node.id}`] }, 5000)
          const has = await run({ file: tmux, args: ['-L', 'palco', 'has-session', '-t', `palco-${i.node.id}`] }, 5000)
          sessionFile = join(this.d.runDir, `tmux-${i.node.id}.session`)
          if (has.code === 0) {
            if (i.restart) throw new Error('A sessão tmux antiga não encerrou; reinício cancelado.')
            const marker = await run({ file: tmux, args: ['-L', 'palco', 'show-environment', '-t', `palco-${i.node.id}`, 'PALCO_SESSION_FILE'] }, 5000)
            if (marker.code !== 0 || marker.out.trim() !== 'PALCO_SESSION_FILE=' + sessionFile) {
              return { error: 'Esta sessão tmux é anterior à rotação segura de credenciais. Use Reiniciar para migrá-la.', fallbackLocal: false }
            }
            reused = true
          }
          if (!PALCO_TOKEN || !i.env.PALCO_SOCKET) throw new Error('Credencial da sessão indisponível.')
          lease = randomUUID()
          this.writeSession(sessionFile, { token: PALCO_TOKEN, socket: i.env.PALCO_SOCKET })
          this.leases.set(i.node.id, lease)
          const env = Object.fromEntries(Object.entries(i.env).filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)))
          delete env.PALCO_TOKEN
          env.PALCO_SESSION_FILE = sessionFile
          plan = tmuxLaunch({ tmuxPath: tmux, terminalId: i.node.id, cwd: i.cwd, shell: i.shell, sessionExists: reused, runDir: this.d.runDir, env, launchId: ctx.launchId, sessionFile })
          break
        }
        case 'ssh': {
          if (!s.sshEnabled) return { error: 'Espaços de trabalho SSH estão desligados (Configurações › Geral › Ambientes)' }
          if (!this.d.which('ssh')) return { error: 'o ssh não foi encontrado no PATH' }
          const up = await this.d.tunnel.listen('127.0.0.1', s.tunnelPort)
          check()
          if (!up.ok) return { error: `túnel indisponível: ${up.reason}` }
          plan = sshLaunch(e, ctx, { scriptPath: s.sshScriptPath, addToPath: s.sshAddToPath })
          const key = `${e.user}@${e.host}:${e.port}:${s.sshScriptPath}`
          if (!this.provisioned.has(key)) {
            const cli = this.d.cliBundle()
            if (cli) {
              const bin = posix.dirname(s.sshScriptPath), cjs = `${bin}/palco.cjs`
              const wrapper = '#!/bin/sh\nexec node "$(dirname "$0")/palco.cjs" "$@"\n'
              const a = await run({ file: 'ssh', args: [...plan.prepare[0]!.args.slice(0, -1), `mkdir -p ${remotePath(bin)} && cat > ${remotePath(cjs)}`], stdin: cli.toString('utf8') })
              const b = a.code === 0 ? await run({ file: 'ssh', args: [...plan.prepare[0]!.args.slice(0, -1), `cat > ${remotePath(s.sshScriptPath)} && chmod 755 ${remotePath(s.sshScriptPath)}`], stdin: wrapper }) : a
              if (b.code !== 0) throw new Error('não foi possível instalar o CLI no host remoto')
              this.provisioned.add(key)
            }
          }
          break
        }
        case 'docker': {
          if (!s.dockerEnabled) return { error: 'o contêiner Docker está desligado (Configurações › Geral › Ambientes)' }
          if (!this.d.which('docker')) return { error: 'o docker não foi encontrado no PATH' }
          const gw = await run({ file: 'docker', args: [...(e.context ? ['--context', e.context] : []), 'network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'] }, 8000)
          const gateway = gw.code === 0 ? gw.out.trim() : ''
          if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(gateway) || e.context) {
            warning = 'O CLI do palco dentro do contêiner pode não alcançar o app (sem ponte local do Docker, ou contexto remoto).'
          } else {
            const up = await this.d.tunnel.listen(gateway, s.tunnelPort)
            check()
            if (up.ok) ctx.endpoint = `tcp://${gateway}:${s.tunnelPort}`
            else warning = 'túnel para o contêiner indisponível'
          }
          plan = dockerLaunch(e, ctx)
          break
        }
        case 'sandbox': {
          if (!s.sandboxEnabled) return { error: 'o Docker Sandbox está desligado (Configurações › Geral › Ambientes)' }
          if (!this.d.which('sbx')) return { error: 'o sbx não foi encontrado no PATH' }
          warning = 'O CLI do palco dentro da sandbox não é suportado ainda (a rede do sbx não foi verificada).'
          plan = sandboxLaunch(e, ctx)
          break
        }
      }
      if (i.settingsContent && !reused) {
        if (!settingsFile) throw new Error('caminho das configurações indisponível')
        const writer = `umask 077 && cat > ${sq(settingsFile)}`
        const remover = `rm -f -- ${sq(settingsFile)}`
        if (e.kind === 'ssh') {
          const dest = `${e.user}@${e.host}`, base = sshBaseOptions(e)
          plan!.prepare.push({ file: 'ssh', args: [...base, dest, writer], stdin: i.settingsContent })
          settingsCleanup.push({ file: 'ssh', args: [...base, dest, remover] })
        } else if (e.kind === 'docker') {
          const prefix = [...(e.context ? ['--context', e.context] : []), 'exec', '-i', ...(e.user ? ['--user', e.user] : []), e.container]
          plan!.prepare.push({ file: 'docker', args: [...prefix, '/bin/sh', '-c', writer], stdin: i.settingsContent })
          settingsCleanup.push({ file: 'docker', args: [...prefix, '/bin/sh', '-c', remover] })
        } else if (e.kind === 'sandbox') {
          const prefix = ['exec', '-i', ...(e.user ? ['--user', e.user] : []), e.name, '--']
          plan!.prepare.push({ file: 'sbx', args: [...prefix, '/bin/sh', '-c', writer], stdin: i.settingsContent })
          settingsCleanup.push({ file: 'sbx', args: [...prefix, '/bin/sh', '-c', remover] })
        }
      }
      for (const step of plan.prepare) {
        const result = await run(step)
        if (result.code !== 0) throw new Error('não foi possível preparar o ambiente')
      }
      check()
      for (const f of plan.files) writeFileSync(f.path, f.content, { mode: f.mode, flag: 'wx' })
      const timer = setTimeout(() => {
        for (const f of plan?.files ?? []) rmSync(f.path, { force: true })
        for (const step of plan?.cleanup ?? []) void this.d.run(step, STEP_MS).catch(() => {})
      }, this.d.cleanupAfterMs ?? 15000)
      timer.unref?.()
      return {
        file: plan.spawn.file, args: plan.spawn.args, env: outer, cwd: i.home, reused, sessionFile,
        remoteCli: e.kind === 'ssh' || e.kind === 'docker' || e.kind === 'sandbox',
        cleanup: async () => { clearTimeout(timer); await cleanup() }, ...(warning ? { warning } : {})
      }
    } catch (error) {
      await cleanup()
      if (i.signal?.aborted) return { error: 'Partida cancelada.', fallbackLocal: false }
      return { error: error instanceof Error ? error.message : 'Falha no preparo do ambiente.', fallbackLocal: false }
    }
  }
}
