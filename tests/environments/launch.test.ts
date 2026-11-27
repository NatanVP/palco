import { describe, expect, it } from 'vitest'
import { environmentLabel, isRemote, validateEnvironment } from '../../src/shared/environment'
import { dockerLaunch, sandboxLaunch, sshLaunch, startScript, tmuxLaunch, type LaunchContext } from '../../src/main/environments/launch'
import { exportLines, remotePath, sq } from '../../src/main/environments/quote'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ctx = (over: Partial<LaunchContext> = {}): LaunchContext => ({ terminalId: 't-1', cwd: '/srv/app', env: { PALCO_TOKEN: TOKEN, PALCO_TERMINAL: 't-1', PALCO_NAME: "Agente 'A'" }, tunnelPort: 7433, endpoint: 'tcp://127.0.0.1:7433', runDir: '/run/user/1000/palco', ...over })
const argv = (p: { spawn: { file: string; args: string[] }; prepare: Array<{ file: string; args: string[] }> }): string => [p.spawn, ...p.prepare].map(s => [s.file, ...s.args].join(' ')).join('\n')

describe('citação', () => {
  it('aspas simples blindam $, crases, ponto e vírgula e aspas', () => {
    expect(sq("a'b")).toBe("'a'\\''b'"); expect(sq('$(rm -rf ~); `x`')).toBe("'$(rm -rf ~); `x`'")
    expect(remotePath('~')).toBe('"$HOME"'); expect(remotePath('~/.palco/bin')).toBe(`"$HOME"/'.palco/bin'`); expect(remotePath("/a b/'c")).toBe("'/a b/'\\''c'")
  })
  it('exportLines recusa nome de variável que viraria comando', () => {
    expect(exportLines({ A_1: "x'y" })).toBe("export A_1='x'\\''y'"); expect(() => exportLines({ 'A; rm -rf /': '1' })).toThrow(); expect(() => exportLines({ A: 'x\0' })).toThrow()
  })
})
describe('validação do ambiente', () => {
  it('local, tmux, ssh, docker e sandbox válidos; ausente = local', () => {
    expect(validateEnvironment(undefined)).toEqual({ kind: 'local' }); expect(validateEnvironment({ kind: 'tmux' })).toEqual({ kind: 'tmux' })
    expect(validateEnvironment({ kind: 'ssh', host: 'dev.example.com', user: 'ana' })).toEqual({ kind: 'ssh', host: 'dev.example.com', user: 'ana', port: 22 })
    expect(validateEnvironment({ kind: 'docker', container: 'web-1' })).toEqual({ kind: 'docker', context: '', container: 'web-1', user: '' })
    expect(validateEnvironment({ kind: 'sandbox', name: 'agente', user: 'root' })).toEqual({ kind: 'sandbox', name: 'agente', user: 'root' })
  })
  it('recusa o que o ssh ou o docker leriam como opção ou como outro argumento', () => {
    for (const host of ['-oProxyCommand=touch /tmp/x', 'a b', 'h\nx', '', '-J evil']) expect(() => validateEnvironment({ kind: 'ssh', host, user: 'u' }), host).toThrow()
    for (const user of ['-l', 'a@b', 'a b', '']) expect(() => validateEnvironment({ kind: 'ssh', host: 'h', user }), user).toThrow()
    for (const port of [0, 70000, 2.5, '22']) expect(() => validateEnvironment({ kind: 'ssh', host: 'h', user: 'u', port }), String(port)).toThrow()
    for (const container of ['--privileged', '-v', 'a b', '', 'a;b']) expect(() => validateEnvironment({ kind: 'docker', container }), container).toThrow()
    expect(() => validateEnvironment({ kind: 'docker', container: 'c', context: '--host=x' })).toThrow(); expect(() => validateEnvironment({ kind: 'docker', container: 'c', user: '-u' })).toThrow()
    expect(() => validateEnvironment({ kind: 'sandbox', name: '--x' })).toThrow(); expect(() => validateEnvironment({ kind: 'wsl' })).toThrow(); expect(() => validateEnvironment('ssh')).toThrow()
  })
  it('rótulo e remoto', () => {
    expect(environmentLabel(undefined)).toBe('Local'); expect(environmentLabel({ kind: 'ssh', host: 'h', user: 'u', port: 2200 })).toBe('u@h:2200'); expect(environmentLabel({ kind: 'docker', context: 'x', container: 'c', user: '' })).toBe('c (x)')
    expect(isRemote({ kind: 'tmux' })).toBe(false); expect(isRemote({ kind: 'ssh', host: 'h', user: 'u', port: 22 })).toBe(true)
  })
})
describe('SSH', () => {
  const e = { kind: 'ssh' as const, host: 'dev.example.com', user: 'ana', port: 2200 }
  const plan = sshLaunch(e, ctx(), { scriptPath: '~/.palco/bin/palco', addToPath: true })
  it('usa só chave/agente (BatchMode), aceita host novo, porta e túnel reverso em loopback', () => {
    const a = plan.spawn.args.join(' ')
    expect(a).toContain('BatchMode=yes'); expect(a).toContain('StrictHostKeyChecking=accept-new'); expect(a).toContain('-p 2200'); expect(a).toContain('-R 7433:127.0.0.1:7433'); expect(a).toContain('ana@dev.example.com')
    expect(plan.spawn.args[0]).toBe('-t'); expect(plan.tunnelPort).toBe(7433)
  })
  it('o token e o ambiente NUNCA aparecem na linha de comando; só o caminho do arquivo de partida', () => {
    expect(argv(plan)).not.toContain(TOKEN); expect(argv(plan)).not.toContain('Agente'); expect(plan.spawn.args.at(-1)).toBe(`sh "$HOME"/'.palco/run/t-1.sh'`)
  })
  it('o preparo roda `sh -s` com o script no stdin: 0600, apaga a si mesmo, exporta com aspas, PATH e cd', () => {
    const step = plan.prepare[0]!
    expect(step.args.at(-1)).toBe('sh -s'); expect(step.stdin).toContain(`export PALCO_TOKEN='${TOKEN}'`); expect(step.stdin).toContain("export PALCO_NAME='Agente '\\''A'\\'''")
    expect(step.stdin).toContain("export PALCO_SOCKET='tcp://127.0.0.1:7433'"); expect(step.stdin).toContain('umask 077'); expect(step.stdin).toContain('chmod 600'); expect(step.stdin).toContain('rm -f --')
    expect(step.stdin).toContain(`PATH="$HOME"/'.palco/bin':"$PATH"`); expect(step.stdin).toContain('exec "${SHELL:-/bin/sh}" -l')
  })
  it('diretório de trabalho malicioso fica entre aspas; sem addToPath não mexe no PATH', () => {
    const p = sshLaunch(e, ctx({ cwd: "/x'; touch /tmp/pwn; '" }), { scriptPath: '~/.palco/bin/palco', addToPath: false })
    expect(p.prepare[0]!.stdin).toContain("cd -- '/x'\\''; touch /tmp/pwn; '\\''' 2>/dev/null || cd"); expect(p.prepare[0]!.stdin).not.toContain('PATH=')
  })
  it('id de terminal que escapa da pasta é recusado', () => { expect(() => sshLaunch(e, ctx({ terminalId: '../x' }), { scriptPath: '~/.palco/bin/palco', addToPath: true })).toThrow() })
  it('a delimitação do heredoc é aleatória a cada plano', () => {
    const d = (s: string) => /<<'(PALCO_[0-9a-f]+)'/.exec(s)![1]; expect(d(plan.prepare[0]!.stdin!)).not.toBe(d(sshLaunch(e, ctx(), { scriptPath: '~/.palco/bin/palco', addToPath: true }).prepare[0]!.stdin!))
  })
})
describe('Docker e Sandbox', () => {
  it('docker exec com contexto, usuário, pasta e --env-file 0600; sem token na linha', () => {
    const p = dockerLaunch({ kind: 'docker', context: 'remoto', container: 'web-1', user: 'app' }, ctx({ endpoint: 'tcp://172.17.0.1:7433' }))
    expect(p.spawn.file).toBe('docker'); expect(p.spawn.args.slice(0, 5)).toEqual(['--context', 'remoto', 'exec', '-it', '--user']); expect(p.spawn.args).toContain('-w'); expect(p.spawn.args.at(-4)).toBe('web-1')
    expect(argv(p)).not.toContain(TOKEN); expect(p.files).toHaveLength(1); expect(p.files[0]).toMatchObject({ path: '/run/user/1000/palco/t-1.env', mode: 0o600 })
    expect(p.files[0]!.content).toContain(`PALCO_TOKEN=${TOKEN}\n`); expect(p.files[0]!.content).toContain('PALCO_SOCKET=tcp://172.17.0.1:7433')
  })
  it('sem contexto e sem usuário a linha é mínima; valor com quebra de linha é recusado', () => {
    expect(dockerLaunch({ kind: 'docker', context: '', container: 'c', user: '' }, ctx()).spawn.args[0]).toBe('exec')
    expect(() => dockerLaunch({ kind: 'docker', context: '', container: 'c', user: '' }, ctx({ env: { A: 'x\nB=1' } }))).toThrow()
  })
  it('sandbox usa o sbx com o mesmo cuidado (sintaxe do sbx não verificada)', () => {
    const p = sandboxLaunch({ kind: 'sandbox', name: 'agente', user: '' }, ctx()); expect(p.spawn.file).toBe('sbx'); expect(argv(p)).not.toContain(TOKEN); expect(p.files[0]!.mode).toBe(0o600)
  })
})
describe('tmux local', () => {
  const o = { tmuxPath: '/usr/bin/tmux', terminalId: 't-1', cwd: '/home/u/p', shell: '/bin/zsh', sessionExists: false, runDir: '/run/user/1000/palco', env: { PALCO_TOKEN: TOKEN } }
  it('sessão nova: servidor próprio, nome por terminal, cwd e script 0600 que se apaga; token fora da linha', () => {
    const p = tmuxLaunch(o)
    expect(p.spawn.args.slice(0, 5)).toEqual(['-L', 'palco', 'new-session', '-s', 'palco-t-1']); expect(p.spawn.args).toContain('palco-t-1'); expect(p.spawn.args).toContain('/home/u/p')
    expect(argv(p)).not.toContain(TOKEN); expect(p.files[0]).toMatchObject({ mode: 0o600 }); expect(p.files[0]!.content).toContain('rm -f --'); expect(p.files[0]!.content).toContain(`export PALCO_TOKEN='${TOKEN}'`)
  })
  it('sessão que já existe só reata, sem arquivo de ambiente (não deixa token no disco)', () => {
    const p = tmuxLaunch({ ...o, sessionExists: true }); expect(p.files).toEqual([]); expect(p.spawn.args).toEqual(['-L', 'palco', 'attach-session', '-t', 'palco-t-1'])
  })
})
describe('script de partida', () => { it('entra no shell de login depois de apagar o arquivo', () => { const s = startScript("'/x'", { cwd: '/a', env: {}, endpoint: 'tcp://127.0.0.1:1' }); expect(s.indexOf("rm -f -- '/x'")).toBeLessThan(s.indexOf('exec')) }) })

import { invalidTerminalExtras, pickTerminalExtras } from '../../src/main/domain/terminal-extras'
describe('ambiente no nó do terminal', () => {
  it('é validado e regravado só com os campos do tipo', () => {
    expect(invalidTerminalExtras({ environment: { kind: 'ssh', host: '-x', user: 'u' } })).toEqual(['environment']); expect(invalidTerminalExtras({ environment: { kind: 'ssh', host: 'h', user: 'u' } })).toEqual([])
    expect(pickTerminalExtras({ environment: { kind: 'ssh', host: 'h', user: 'u', extra: 'x' } })).toEqual({ environment: { kind: 'ssh', host: 'h', user: 'u', port: 22 } })
  })
})
