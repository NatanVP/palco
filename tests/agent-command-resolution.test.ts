import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearAgentResolutionCache, resolveAgentForCommand } from '../src/main/agents/command-resolution'

const homes: string[] = []
afterEach(() => { clearAgentResolutionCache(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
const home = (): string => { const value = mkdtempSync(join(tmpdir(), 'palco-shell-resolution-')); homes.push(value); return value }
const available = (name: string): boolean => {
  try { execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }); return true } catch { return false }
}

describe('detecta agente em wrappers sem executar a função', () => {
  it.skipIf(!available('fish'))('lê função e reconhece o repasse de $argv (requer fish no PATH)', async () => {
    const root = home(), functions = join(root, '.config/fish/functions')
    mkdirSync(functions, { recursive: true })
    const marker = join(root, 'executou')
    writeFileSync(join(functions, 'clauded.fish'), `function clauded --wraps=claude\n  touch '${marker}'\n  claude --dangerously-skip-permissions $argv\nend\n`)
    const result = await resolveAgentForCommand('clauded', { shell: 'fish', env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, '.config') } })
    expect(result).toMatchObject({ agent: 'claude', wrapper: true, forwardsArgs: true })
    expect(existsSync(marker)).toBe(false)
  })

  for (const shell of ['bash', 'zsh']) it.skipIf(!available(shell))(`lê alias sem executá-lo (requer ${shell} no PATH)`, async () => {
    const root = home(), rc = shell === 'bash' ? '.bashrc' : '.zshrc'
    const marker = join(root, 'executou')
    writeFileSync(join(root, rc), `alias clauded='touch ${marker}; claude --dangerously-skip-permissions "$@"'\n`)
    const result = await resolveAgentForCommand('clauded', { shell, env: { ...process.env, HOME: root, ZDOTDIR: root } })
    expect(result).toMatchObject({ agent: 'claude', wrapper: true, forwardsArgs: true })
    expect(existsSync(marker)).toBe(false)
  })

  it.skipIf(!available('bash'))('ignora comentário e string e identifica argumentos não repassados (requer bash no PATH)', async () => {
    const root = home()
    writeFileSync(join(root, '.bashrc'), `function clauded() { echo "claude"; claude; # codex "$@"\n}\n`)
    const result = await resolveAgentForCommand('clauded', { shell: 'bash', env: { ...process.env, HOME: root } })
    expect(result).toMatchObject({ agent: 'other', wrapper: true, forwardsArgs: false })
    expect(result.warning).toBeTruthy()
  })

  it.skipIf(!available('bash'))('guarda o resultado por nome e shell (requer bash no PATH)', async () => {
    const root = home()
    writeFileSync(join(root, '.bashrc'), `alias clauded='claude "$@"'\n`)
    const options = { shell: 'bash', env: { ...process.env, HOME: root } }
    const first = await resolveAgentForCommand('clauded', options)
    rmSync(join(root, '.bashrc'))
    const second = await resolveAgentForCommand('clauded', options)
    expect(first.agent).toBe('claude')
    expect(second).toEqual(first)
  })

  it.skipIf(!available('bash') || !available('zsh'))('separa o mesmo nome por shell (requer bash e zsh no PATH)', async () => {
    const root = home()
    writeFileSync(join(root, '.bashrc'), `alias clauded='claude "$@"'\n`)
    writeFileSync(join(root, '.zshrc'), `alias clauded='codex "$@"'\n`)
    const env = { ...process.env, HOME: root, ZDOTDIR: root }
    const bash = await resolveAgentForCommand('clauded', { shell: 'bash', env })
    const zsh = await resolveAgentForCommand('clauded', { shell: 'zsh', env })
    expect(bash.agent).toBe('claude')
    expect(zsh.agent).toBe('codex')
  })
})
