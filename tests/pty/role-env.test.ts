import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TerminalManager } from '../../src/main/pty/terminal-manager'
import { buildAgentCommand, CODEX_ROLE_ENV } from '../../src/main/pty/agent-command'
import type { TerminalNode } from '../../src/shared/model'

let dir: string, tm: TerminalManager | undefined
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-role-env-')) })
afterEach(() => { tm?.killAll(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) })

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout esperando condição')
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** "codex" falso: grava os argumentos (um por linha, em JSON) e sai. */
function fakeCodex(): { bin: string; out: string } {
  const bin = join(dir, 'codex-falso'), out = join(dir, 'args.json')
  writeFileSync(bin, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))\n`)
  chmodSync(bin, 0o755)
  return { bin, out }
}

const ROLE = `aspas "duplas" e 'simples', $HOME, \`crase\`, !hist\nsegunda linha\ttab ROLE-MARCA-9f3`

const codexNode = (command: string, role?: string): TerminalNode => ({
  id: 'c1', kind: 'terminal', floorId: null, name: 'Rev', agent: 'codex', command, cwd: dir,
  pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }, ...(role ? { role } : {})
})
const claudeNode = (command: string): TerminalNode => ({ id: 'a1', kind: 'terminal', floorId: null, name: 'Ana', agent: 'claude', command, cwd: dir, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })

describe('role do Codex por variável de ambiente', () => {
  it('o comando digitado só referencia a variável, sem o texto do role', () => {
    const cmd = buildAgentCommand('codex', 'codex', '/b', { file: '/r.md', text: ROLE })
    expect(cmd).not.toContain('ROLE-MARCA')
    expect(cmd).toContain(`-c "developer_instructions=$${CODEX_ROLE_ENV}"`)
  })

  it('chega literal ao Codex e não aparece na tela do terminal', async () => {
    const { bin, out } = fakeCodex()
    const warnings: string[] = []
    tm = new TerminalManager({ socketPath: '/tmp/x.sock', palcoBin: '/opt/palco', env: { SHELL: '/bin/bash', PS1: '$ ', HISTFILE: join(dir, 'hist') },
      resolveRole: () => ({ file: join(dir, 'rev.md'), text: ROLE }), onWarning: (_id, m) => warnings.push(m) })
    tm.spawn(codexNode(bin, 'rev'))
    await waitFor(() => existsSync(out))
    const args = JSON.parse(readFileSync(out, 'utf8')) as string[]
    const value = args[args.indexOf('-c') + 1]!
    expect(value.startsWith('developer_instructions=')).toBe(true)
    expect(JSON.parse(value.slice('developer_instructions='.length))).toBe(ROLE)
    expect(tm.screenText('c1')).not.toContain('ROLE-MARCA')
    expect(warnings).toEqual([])
  })

  it('role que sumiu: o terminal sobe sem role e avisa', async () => {
    const { bin, out } = fakeCodex()
    const warnings: string[] = []
    tm = new TerminalManager({ socketPath: '/tmp/x.sock', palcoBin: '/opt/palco', env: { SHELL: '/bin/bash', PS1: '$ ' },
      resolveRole: () => { throw new Error('role não encontrado') }, onWarning: (_id, m) => warnings.push(m) })
    expect(() => tm!.spawn(codexNode(bin, 'sumiu'))).not.toThrow()
    await waitFor(() => existsSync(out))
    const args = JSON.parse(readFileSync(out, 'utf8')) as string[]
    expect(args.some((a) => a.startsWith('developer_instructions='))).toBe(false)
    expect(warnings.join(';')).toMatch(/sumiu/)
  })

  it('role grande demais para a linha de comando do Codex: sobe sem role e avisa', async () => {
    const { bin, out } = fakeCodex()
    const warnings: string[] = []
    tm = new TerminalManager({ socketPath: '/tmp/x.sock', palcoBin: '/opt/palco', env: { SHELL: '/bin/bash', PS1: '$ ' },
      resolveRole: () => ({ file: '/r.md', text: 'x'.repeat(200_000) }), onWarning: (_id, m) => warnings.push(m) })
    tm.spawn(codexNode(bin, 'enorme'))
    await waitFor(() => existsSync(out))
    const args = JSON.parse(readFileSync(out, 'utf8')) as string[]
    expect(args.some((a) => a.startsWith('developer_instructions='))).toBe(false)
    expect(warnings.join(';')).toMatch(/grande/)
  })
})

describe('arquivo temporário de configurações do Claude', () => {
  const found = spawnSync('/bin/sh', ['-c', 'command -v fish'], { encoding: 'utf8' })
  const fish = found.status === 0 ? found.stdout.trim() : undefined
  it.skipIf(!fish)('entrega um caminho privado no início interativo e apaga ao sair (requer fish no PATH)', async () => {
    const out = join(dir, 'claude.json'), settingsDir = join(dir, 'run', 'settings')
    const bin = join(dir, 'claude-falso')
    writeFileSync(bin, `#!/usr/bin/env node\nconst fs=require('fs'),a=process.argv.slice(2),p=a[a.indexOf('--settings')+1];fs.writeFileSync(${JSON.stringify(out)},JSON.stringify({args:a,settings:JSON.parse(fs.readFileSync(p,'utf8')),mode:fs.statSync(p).mode&0o777,path:p}))\n`)
    chmodSync(bin, 0o755)
    const manager = tm = new TerminalManager({ socketPath: '/tmp/s', palcoBin: '/opt/palco', settingsDir, env: { HOME: dir, SHELL: fish, PS1: '$ ', TERM: 'xterm-256color' }, readyQuietMs: 50 })
    manager.onData((id, data) => {
      if (data.includes('\x1b[?u')) manager.write(id, '\x1b[?0u')
      if (data.includes('\x1b[>0q')) manager.write(id, '\x1b[>1;4000;0q')
      if (data.includes('\x1b]11;?')) manager.write(id, '\x1b]11;rgb:ffff/ffff/ffff\x1b\\')
      if (data.includes('\x1bP+q')) {
        const query = data.match(/\x1bP\+q([0-9a-f]+)\x1b\\/)?.[1]
        if (query) manager.write(id, `\x1bP1+r${query}=\x1b\\`)
      }
      if (data.includes('\x1b[c') || data.includes('\x1b[0c')) manager.write(id, '\x1b[?1;2c')
    })
    tm.spawn(claudeNode(bin))
    await waitFor(() => existsSync(out))
    const result = JSON.parse(readFileSync(out, 'utf8')) as { args: string[]; settings: { hooks: Record<string, unknown> }; mode: number; path: string }
    expect(result.args.slice(-2)).toEqual(['--settings', result.path])
    expect(result.path).toMatch(/\.json$/)
    expect(result.mode).toBe(0o600)
    expect(Object.keys(result.settings.hooks).sort()).toEqual(['PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'])
    manager.dispose('a1')
    expect(existsSync(result.path)).toBe(false)
  })
})
