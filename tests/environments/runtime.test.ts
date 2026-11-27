import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRuntime, type EnvironmentDeps, type EnvironmentSettings, type Prepared } from '../../src/main/environments/runtime'
import { TerminalManager } from '../../src/main/pty/terminal-manager'
import type { TerminalNode } from '../../src/shared/model'
import type { Environment } from '../../src/shared/environment'

const TOKEN = 'tok-' + 'f'.repeat(60)
let dir: string, steps: Array<{ file: string; args: string[]; stdin?: string }>, listens: Array<[string, number]>
const on: EnvironmentSettings = { sshEnabled: true, dockerEnabled: true, sandboxEnabled: true, localTmuxEnabled: true, tunnelPort: 7433, sshScriptPath: '~/.palco/bin/palco', sshAddToPath: true }
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-envrt-')); steps = []; listens = [] })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const node = (environment: Environment, id = 't-1'): TerminalNode => ({ id, kind: 'terminal', floorId: null, name: 'Agente', agent: 'claude', command: 'claude', cwd: '/srv/app', environment, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } }) as TerminalNode
const deps = (over: Partial<EnvironmentDeps> = {}, settings: Partial<EnvironmentSettings> = {}, runs: Record<string, { code: number | null; out: string }> = {}): EnvironmentDeps => ({
  settings: () => ({ ...on, ...settings }), tunnel: { listen: async (h, p) => { listens.push([h, p]); return { ok: true } } }, runDir: join(dir, 'run'),
  run: async s => { steps.push(s); return runs[`${s.file} ${s.args[0]}`] ?? runs[s.file] ?? { code: 0, out: '' } }, which: p => `/usr/bin/${p}`, cliBundle: () => Buffer.from('// cli'), cleanupAfterMs: 60_000, ...over
})
const input = (n: TerminalNode) => ({ node: n, shell: '/bin/zsh', env: { PATH: '/bin', PALCO_TOKEN: TOKEN, PALCO_SOCKET: '/tmp/test.sock', PALCO_TERMINAL: n.id, PALCO_NAME: n.name, HOME: '/home/u' }, cwd: n.cwd, home: '/home/u' })
const ok = (p: Prepared): Exclude<Prepared, {error: string}> => { if ('error' in p) throw new Error(p.error); return p }

describe('ambiente desligado ou programa ausente', () => {
  it.each([['ssh', { kind: 'ssh', host: 'h', user: 'u', port: 22 }, 'sshEnabled', /SSH estão desligados/], ['docker', { kind: 'docker', context: '', container: 'c', user: '' }, 'dockerEnabled', /Docker está desligado/],
    ['sandbox', { kind: 'sandbox', name: 's', user: '' }, 'sandboxEnabled', /Sandbox está desligado/], ['tmux', { kind: 'tmux' }, 'localTmuxEnabled', /tmux local está desligado/]] as const)('%s desligado recusa sem executar nada', async (_n, env, flag, msg) => {
    const r = await new EnvironmentRuntime(deps({}, { [flag]: false })).prepare(input(node(env))); expect(r).toMatchObject({ error: expect.stringMatching(msg) }); expect(steps).toEqual([])
  })
  it('programa fora do PATH', async () => {
    for (const [env, prog] of [[{ kind: 'ssh', host: 'h', user: 'u', port: 22 }, 'ssh'], [{ kind: 'docker', context: '', container: 'c', user: '' }, 'docker'], [{ kind: 'sandbox', name: 's', user: '' }, 'sbx'], [{ kind: 'tmux' }, 'tmux']] as const)
      expect(await new EnvironmentRuntime(deps({ which: () => null })).prepare(input(node(env)))).toMatchObject({ error: expect.stringContaining(prog) })
  })
})
describe('tmux', () => {
  it('sessão nova: grava a ponte 0600 e o script sem token, o PTY roda o tmux e o ambiente externo NÃO tem o token', async () => {
    const p = ok(await new EnvironmentRuntime(deps({}, {}, { '/usr/bin/tmux -L': { code: 1, out: 'no server' } })).prepare(input(node({ kind: 'tmux' }))))
    expect(p.file).toBe('/usr/bin/tmux'); expect(p.args).toContain('new-session'); expect(p.env.PALCO_TOKEN).toBeUndefined(); expect(JSON.stringify([p.file, p.args])).not.toContain(TOKEN)
    const script = join(dir, 'run', readdirSync(join(dir, 'run')).find(f => f.endsWith('.sh'))!); expect(statSync(script).mode & 0o777).toBe(0o600); expect(readFileSync(script, 'utf8')).not.toContain(TOKEN); expect(statSync(p.sessionFile!).mode & 0o777).toBe(0o600)
    p.cleanup(); expect(existsSync(script)).toBe(false)
  })
  it('sessão antiga sem ponte recusa reanexar até Reiniciar', async () => {
    const p = await new EnvironmentRuntime(deps()).prepare(input(node({kind: 'tmux'}))); expect(p).toMatchObject({error: expect.stringContaining('Reiniciar'), fallbackLocal: false})
  })
})
describe('SSH', () => {
  const env = { kind: 'ssh', host: 'dev.example.com', user: 'ana', port: 22 } as const
  it('sobe o túnel em loopback, instala o CLI uma vez por host, prepara o script e entrega o ssh -t ao PTY', async () => {
    const rt = new EnvironmentRuntime(deps()), p = ok(await rt.prepare(input(node(env))))
    expect(listens).toEqual([['127.0.0.1', 7433]]); expect(p.file).toBe('ssh'); expect(p.args).toContain('-R'); expect(p.args.at(-1)).toMatch(/t-1-[a-f0-9-]+\.sh/)
    expect(steps.map(s => s.args.at(-1))).toEqual([expect.stringContaining('palco.cjs'), expect.stringContaining('chmod 755'), 'sh -s'])
    expect(steps[0]!.stdin).toBe('// cli'); expect(steps[2]!.stdin).toContain(TOKEN)
    expect(JSON.stringify([p.file, p.args, p.env])).not.toContain(TOKEN)
    steps.length = 0; ok(await rt.prepare(input(node(env, 't-2')))); expect(steps).toHaveLength(1)
  })
  it('sem o bundle do CLI não instala; falha de instalação ou de preparo vira erro legível', async () => {
    const r = await new EnvironmentRuntime(deps({ cliBundle: () => null })).prepare(input(node(env))); ok(r); expect(steps).toHaveLength(1)
    expect(await new EnvironmentRuntime(deps({}, {}, { ssh: { code: 255, out: 'Permission denied (publickey).' } })).prepare(input(node(env)))).toMatchObject({ error: expect.stringContaining('instalar o CLI') })
  })
  it('porta do túnel ocupada é erro, não travamento', async () => {
    expect(await new EnvironmentRuntime(deps({ tunnel: { listen: async () => ({ ok: false, reason: 'a porta 7433 já está em uso' }) } })).prepare(input(node(env)))).toMatchObject({ error: expect.stringContaining('7433') })
  })
  it('instala as configurações do agente num arquivo remoto privado e remove o arquivo ao encerrar', async () => {
    const content = '{"hooks":{}}'
    const p = ok(await new EnvironmentRuntime(deps()).prepare({ ...input(node(env)), settingsContent: content }))
    const writer = steps.find(s => s.stdin === content)!
    expect(writer.args.at(-1)).toContain('cat >')
    expect(steps.find(s => s.stdin?.includes('PALCO_CLAUDE_SETTINGS_FILE'))?.stdin).toContain('PALCO_CLAUDE_SETTINGS_FILE')
    await p.cleanup()
    expect(steps.some(s => s.args.at(-1)?.startsWith('rm -f --') )).toBe(true)
  })
})
describe('Docker e Sandbox', () => {
  const env = { kind: 'docker', context: '', container: 'web-1', user: 'app' } as const
  it('descobre o gateway da ponte, escuta nele e manda o endpoint ao contêiner; o token fica só no --env-file 0600', async () => {
    const p = ok(await new EnvironmentRuntime(deps({}, {}, { docker: { code: 0, out: '172.17.0.1\n' } })).prepare(input(node(env))))
    expect(listens).toEqual([['172.17.0.1', 7433]]); expect(p.file).toBe('docker'); expect(JSON.stringify(p.args)).not.toContain(TOKEN)
    const file = join(dir, 'run', readdirSync(join(dir, 'run')).find(f => f.endsWith('.env'))!); expect(statSync(file).mode & 0o777).toBe(0o600); expect(readFileSync(file, 'utf8')).toContain('PALCO_SOCKET=tcp://172.17.0.1:7433'); p.cleanup(); expect(existsSync(file)).toBe(false)
  })
  it('sem ponte local (ou contexto remoto) sobe mesmo assim, avisando que o CLI do palco pode não alcançar o app', async () => {
    const p = ok(await new EnvironmentRuntime(deps({}, {}, { docker: { code: 1, out: 'erro' } })).prepare(input(node(env)))); expect(p.warning).toMatch(/pode não alcançar/); expect(listens).toEqual([])
  })
  it('sandbox sobe com o aviso de que o CLI do palco lá dentro ainda não é suportado', async () => {
    const p = ok(await new EnvironmentRuntime(deps()).prepare(input(node({ kind: 'sandbox', name: 'ag', user: '' })))); expect(p.file).toBe('sbx'); expect(p.warning).toMatch(/não é suportado/)
  })
  it('prepara arquivo de configurações dentro do contêiner sem embutir o conteúdo no comando', async () => {
    const content = '{"hooks":{}}'
    const p = ok(await new EnvironmentRuntime(deps({}, {}, { docker: { code: 0, out: '172.17.0.1\n' } })).prepare({ ...input(node(env)), settingsContent: content }))
    const writer = steps.find(s => s.stdin === content)!
    expect(writer.args.join(' ')).toContain('cat >')
    expect(p.args.join(' ')).not.toContain(content)
    expect(p.env.PALCO_CLAUDE_SETTINGS_FILE).toBeUndefined()
    await p.cleanup()
    expect(steps.some(s => s.args.at(-1)?.startsWith('rm -f --'))).toBe(true)
  })
})

describe('TerminalManager com ambientes', () => {
  const fakePty = () => { const calls: Array<{ file: string; args: string[]; env: Record<string, string>; cwd: string }> = []; const spawnPty = vi.fn((file: string, args: string[], o: { env: Record<string, string>; cwd: string }) => { calls.push({ file, args, env: o.env, cwd: o.cwd }); return { pid: 1, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} } }); return { calls, spawnPty } }
  const mk = (rt: { prepare: EnvironmentRuntime['prepare'] } | undefined, warnings: string[], exits: number[]) => {
    const f = fakePty(), tm = new TerminalManager({ socketPath: '/tmp/s', palcoBin: '/opt/palco/bin/palco', env: { SHELL: '/bin/zsh', PATH: '/bin' }, spawnPty: f.spawnPty as never, onWarning: (_i, m) => warnings.push(m), ...(rt ? { environments: rt as never } : {}) })
    tm.onExit((_id, code) => exits.push(code)); return { tm, ...f }
  }
  const settle = () => new Promise(r => setTimeout(r, 20))
  it('SSH: o PTY roda o ssh (não o shell) fora da pasta remota, sem o token no ambiente externo', async () => {
    const w: string[] = [], x: number[] = [], rt = new EnvironmentRuntime(deps()), m = mk(rt, w, x)
    m.tm.spawn(node({ kind: 'ssh', host: 'h', user: 'u', port: 22 })); await settle()
    expect(m.calls[0]!.file).toBe('ssh'); expect(m.calls[0]!.cwd).not.toBe('/srv/app'); expect(m.calls[0]!.env.PALCO_TOKEN).toBeUndefined(); expect(JSON.stringify(m.calls[0]!.args)).not.toContain(TOKEN.slice(0, 8))
  })
  it('erro de preparo: avisa e encerra o terminal (exit -1) sem subir PTY', async () => {
    const w: string[] = [], x: number[] = [], m = mk(new EnvironmentRuntime(deps({}, { sshEnabled: false })), w, x)
    m.tm.spawn(node({ kind: 'ssh', host: 'h', user: 'u', port: 22 })); await settle(); expect(m.calls).toEqual([]); expect(x).toEqual([-1]); expect(w[0]).toMatch(/SSH estão desligados/)
  })
  it('tmux ausente cai no shell comum, avisando', async () => {
    const w: string[] = [], x: number[] = [], m = mk(new EnvironmentRuntime(deps({ which: () => null })), w, x)
    m.tm.spawn(node({ kind: 'tmux' })); await settle(); expect(m.calls[0]!.file).toBe('/bin/zsh'); expect(w[0]).toMatch(/tmux/); expect(x).toEqual([])
  })
  it('sem o runtime, ambiente remoto não sobe (e local continua igual)', async () => {
    const w: string[] = [], x: number[] = [], m = mk(undefined, w, x)
    m.tm.spawn(node({ kind: 'docker', context: '', container: 'c', user: '' })); await settle(); expect(m.calls).toEqual([]); expect(x).toEqual([-1])
    m.tm.spawn({ ...node({ kind: 'local' }), id: 'l1' }); await settle(); expect(m.calls[0]!.file).toBe('/bin/zsh')
  })
})
