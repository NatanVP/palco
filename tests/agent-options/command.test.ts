import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_OPTIONS } from '../../src/shared/agent-options'
import { readAgentOption, writeAgentOption } from '../../src/shared/agent-option-command'
import { splitCommand } from '../../src/shared/agent-command'
const option = (agent: 'claude' | 'codex', flag: string) => AGENT_OPTIONS.find(o => o.agent === agent && o.flag === flag)!
describe('opções do comando de agente', () => {
  it('liga e desliga uma opção sem alterar o resto do comando', () => {
    const o = option('claude', '--verbose')
    expect(writeAgentOption('claude --model sonnet', o, [])).toBe('claude --model sonnet --verbose')
    expect(writeAgentOption('claude --verbose --model sonnet --verbose', o, null)).toBe('claude --model sonnet')
  })
  it('reconhece aliases, valores com igual e opções curtas anexadas', () => {
    expect(readAgentOption('codex -m="modelo especial"', option('codex', '--model'))).toEqual(['modelo especial'])
    expect(readAgentOption('codex -sdanger-full-access', option('codex', '--sandbox'))).toEqual(['danger-full-access'])
    expect(readAgentOption('claude --effort=max', option('claude', '--effort'))).toEqual(['max'])
  })
  it('cota valores com espaços, aspas e caracteres de shell', () => {
    const value = "modelo 'especial'; $(echo não)"
    const command = writeAgentOption('claude', option('claude', '--model'), [value])
    expect(splitCommand(command)).toEqual(['claude', '--model', value])
  })
  it('lista variádica do Claude e repetível do Codex preservam cada diretório', () => {
    for (const agent of ['claude', 'codex'] as const) {
      const o = option(agent, '--add-dir'), values = ['/tmp/com espaço', '/tmp/outro']
      expect(readAgentOption(writeAgentOption(agent, o, values), o)).toEqual(values)
    }
  })
  it('não confunde valores de outras flags ou o texto depois de -- com opções', () => {
    const o = option('claude', '--model')
    expect(readAgentOption("claude --append-system-prompt '--model'", o)).toBeNull()
    expect(readAgentOption('claude -- --model sonnet', o)).toBeNull()
    expect(writeAgentOption('claude -- mensagem', o, ['sonnet'])).toBe('claude --model sonnet -- mensagem')
  })
  it('edita dentro do wrapper e preserva variáveis e argumentos externos', () => {
    const o = option('claude', '--model'), result = writeAgentOption('LANG=pt bash -lc "claude --verbose" extra', o, ['modelo especial'])
    const words = splitCommand(result)
    expect(words.slice(0, 3)).toEqual(['LANG=pt', 'bash', '-lc'])
    expect(words.at(-1)).toBe('extra')
    expect(readAgentOption(result, o)).toEqual(['modelo especial'])
  })
  it('recusa modificar sintaxe incompleta e não expõe opções controladas pelo palco', () => {
    expect(() => writeAgentOption("claude 'aberto", option('claude', '--verbose'), [])).toThrow()
    expect(AGENT_OPTIONS.some(o => ['--settings', '--append-system-prompt-file', '--config', '-c'].includes(o.flag))).toBe(false)
  })
})
it('desligar remove todos os aliases e não altera opções de integração já digitadas', () => {
  const o = option('codex', '--sandbox')
  expect(writeAgentOption("codex -s read-only --sandbox=workspace-write -c 'notify=[\"palco\"]'", o, null)).toBe("codex -c 'notify=[\"palco\"]'")
})
it('recusa uma opção reservada mesmo se for passada fora do catálogo', () => {
  const fake = { ...option('claude', '--model'), flag: '--settings' }
  expect(() => writeAgentOption('claude', fake, ['arquivo'])).toThrow(/indisponível/)
})
it('opções sem valor obrigatório e escolhas conhecidas não perdem seus valores', () => {
  const resume = option('claude', '--resume')
  expect(writeAgentOption('claude', resume, [])).toBe('claude --resume')
  expect(readAgentOption('claude --resume', resume)).toEqual([])
  expect(option('claude', '--effort').values).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  expect(option('codex', '--ask-for-approval').values).toEqual(['on-request', 'never'])
})
it('opções mutuamente exclusivas substituem o interruptor oposto', () => {
  expect(writeAgentOption('claude --no-chrome', option('claude', '--chrome'), [])).toBe('claude --chrome')
})

it('o shell recebe valores literais sem executar substituições ou comandos embutidos', () => {
  const home = mkdtempSync(join(tmpdir(), 'palco-option-quote-'))
  try {
    const value = "nome 'com aspas'; $(touch executado) `touch executado` $HOME"
    const command = writeAgentOption('claude', option('claude', '--model'), [value])
    const result = spawnSync('/bin/sh', ['-c', `set -- ${command}; printf '%s' "$3"`], { cwd: home, env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(value)
    expect(existsSync(join(home, 'executado'))).toBe(false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
it('valores que começam com hífen não viram flags reservadas ou perigosas', () => {
  for (const agent of ['claude', 'codex'] as const) {
    const o = option(agent, '--add-dir')
    const command = writeAgentOption(agent, o, ['/tmp', '--settings', '--dangerously-skip-permissions'])
    expect(splitCommand(command)).not.toContain('--settings')
    expect(splitCommand(command)).not.toContain('--dangerously-skip-permissions')
    expect(readAgentOption(command, o)).toEqual(['/tmp', '--settings', '--dangerously-skip-permissions'])
  }
  expect(splitCommand(writeAgentOption('claude', option('claude', '--model'), ['--settings']))).toEqual(['claude', '--model=--settings'])
})
