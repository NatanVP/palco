import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentRoleEnv, buildAgentCommand, CLAUDE_SETTINGS_ENV, claudeSettings as settingsData } from '../../src/main/pty/agent-command'

it('returns no launch command for a plain shell', () => {
  expect(buildAgentCommand('shell', 'ignored', '/path/palco')).toBe('')
})
const sh = (script: string, env: Record<string, string> = {}): string[] =>
  execFileSync('sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } }).split('\n').slice(0, -1)

// Executa a linha de comando num shell real, com `printf` no lugar do agente, e devolve os argumentos recebidos.
function claudeCommand(bin: string): { base: string[]; hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>> } {
  const dir = mkdtempSync(join(tmpdir(), 'palco-claude-settings-')), file = join(dir, 'settings.json')
  writeFileSync(file, JSON.stringify(settingsData(bin)))
  const args = sh(buildAgentCommand('claude', "printf '%s\\n' claude --model chosen", bin), { [CLAUDE_SETTINGS_ENV]: file })
  const at = args.indexOf('--settings')
  const result = { base: args.slice(0, at), hooks: JSON.parse(readFileSync(args[at + 1]!, 'utf8')).hooks }
  rmSync(dir, { recursive: true, force: true })
  return result
}
const commandWords = (command: string): string[] => sh(`printf '%s\\n' ${command}`)

it('adds Claude Stop, PreToolUse and UserPromptSubmit hooks while preserving the base flags', () => {
  const { base, hooks } = claudeCommand('/path/palco')
  expect(base).toEqual(['claude', '--model', 'chosen'])
  expect(Object.keys(hooks).sort()).toEqual(['PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'])
  const only = (event: string): string => {
    expect(hooks[event]).toHaveLength(1)
    expect(hooks[event]![0]!.hooks).toHaveLength(1)
    expect(hooks[event]![0]!.hooks[0]!.type).toBe('command')
    return hooks[event]![0]!.hooks[0]!.command
  }
  expect(commandWords(only('Stop'))).toEqual(['/path/palco', 'hook', 'claude-stop'])
  expect(commandWords(only('PreToolUse'))).toEqual(['/path/palco', 'hook', 'claude-busy'])
  expect(commandWords(only('UserPromptSubmit'))).toEqual(['/path/palco', 'hook', 'claude-busy'])
  expect(commandWords(only('SessionStart'))).toEqual(['/path/palco', 'hook', 'claude-ready'])
  expect(hooks.PreToolUse![0]!.matcher).toBe('*')
})
it('quotes apostrophes across both Claude shell layers without expanding dollars or command substitutions', () => {
  const bin = "/path/palco's $USER $(echo nope) bin"
  const { hooks } = claudeCommand(bin)
  for (const [event, word] of [['Stop', 'claude-stop'], ['PreToolUse', 'claude-busy'], ['UserPromptSubmit', 'claude-busy'], ['SessionStart', 'claude-ready']] as const) {
    expect(commandWords(hooks[event]![0]!.hooks[0]!.command)).toEqual([bin, 'hook', word])
  }
})
it('adds one Codex notify config argument without dropping the base flags', () => {
  expect(buildAgentCommand('codex', 'codex --model chosen', '/path/palco')).toBe(
    String.raw`codex --model chosen -s danger-full-access -c 'notify=["/path/palco","hook","codex-notify"]'`
  )
})
it('quotes an apostrophe in the Codex binary path and preserves spaces and dollars literally', () => {
  expect(buildAgentCommand('codex', 'codex', "/path/palco's $USER bin")).toBe(
    String.raw`codex -s danger-full-access -c 'notify=["/path/palco'"'"'s $USER bin","hook","codex-notify"]'`
  )
})

it('passes a settings file reference through direct, wrapped and remote Claude commands', () => {
  const direct = buildAgentCommand('claude', 'claude --model opus', '/local/palco')
  expect(direct).toContain(`--settings "$${CLAUDE_SETTINGS_ENV}"`)
  expect(direct).not.toContain('"statusLine"')
  const wrapped = buildAgentCommand('claude', 'fish -c "claude --model opus"', '/local/palco')
  expect(wrapped).toContain(`--settings "$${CLAUDE_SETTINGS_ENV}"`)
  const remote = buildAgentCommand('claude', 'claude --model opus', '/local/palco', undefined, true)
  expect(remote).toContain(`--settings "$${CLAUDE_SETTINGS_ENV}"`)
})

it('Codex usa danger-full-access por padrão (o sandbox bloqueia o socket), mas respeita um sandbox escolhido', () => {
  for (const base of ['codex -s read-only', 'codex --sandbox workspace-write', 'codex --sandbox=read-only', 'codex --dangerously-bypass-approvals-and-sandbox']) {
    expect(buildAgentCommand('codex', base, '/b')).not.toContain('danger-full-access -c')
    expect(buildAgentCommand('codex', base, '/b').startsWith(base + ' -c ')).toBe(true)
  }
  expect(buildAgentCommand('codex', 'codex', '/b').startsWith('codex -s danger-full-access -c ')).toBe(true)
})

it('Claude ganha uma statusLine que só grava o stdin (rate_limits) num arquivo do palco, por terminal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palco-settings-test-')), file = join(dir, 'settings.json')
  writeFileSync(file, JSON.stringify(settingsData('/path/palco')))
  const args = sh(buildAgentCommand('claude', "printf '%s\\n' claude", '/path/palco'), { [CLAUDE_SETTINGS_ENV]: file })
  const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1]!, 'utf8')) as { statusLine: { type: string; command: string } }
  expect(settings.statusLine.type).toBe('command')
  const home = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim()
  const input = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 1 } } })
  expect(settings.statusLine.command).toContain("$$")
  const out = execFileSync('sh', ['-c', settings.statusLine.command], { input, encoding: 'utf8', env: { ...process.env, HOME: home, PALCO_TERMINAL_ID: 't-1' } })
  expect(out).toBe('')
  expect(JSON.parse(execFileSync('cat', [`${home}/.palco/usage/claude/t-1.json`], { encoding: 'utf8' }))).toEqual(JSON.parse(input))
  expect(execFileSync('stat', ['-c', '%a', `${home}/.palco/usage/claude/t-1.json`], { encoding: 'utf8' }).trim()).toBe('600')
  execFileSync('rm', ['-rf', home])
  rmSync(dir, { recursive: true, force: true })
})

it('passes role bytes literally through real sh for both agent formats', () => {
  const role = { file: "/tmp/role's $FILE.md", text: "quotes '\" $HOME\nnext" }
  for (const agent of ['claude', 'codex'] as const) {
    // O Codex recebe o texto pela variável de ambiente que o PTY injeta.
    const args = sh(buildAgentCommand(agent, "printf '%s\\n'", '/b', role), { ...agentRoleEnv(agent, role), [CLAUDE_SETTINGS_ENV]: '/tmp/settings.json' })
    if (agent === 'claude') expect(args[args.indexOf('--append-system-prompt-file') + 1]).toBe(role.file)
    else {
      // printf lines split embedded newlines, but JSON encoding keeps the config in one line.
      expect(args).toContain('developer_instructions=' + JSON.stringify(role.text))
    }
  }
})

it('agente other (agy, opencode): o comando é digitado como está, sem hooks nem settings', () => {
  expect(buildAgentCommand('other', 'opencode', '/b')).toBe('opencode')
  expect(buildAgentCommand('other', 'agy', '/b')).toBe('agy')
  expect(() => buildAgentCommand('other', 'agy', '/b', { file: '/r.md', text: 'x' })).toThrow(/role não se aplica/)
})
