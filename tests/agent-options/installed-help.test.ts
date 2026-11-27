import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AGENT_OPTIONS, EXCLUDED_AGENT_OPTIONS, type OptionAgent } from '../../src/shared/agent-options'

function helpFlags(help: string, agent: OptionAgent): string[] {
  const options = help.split('Options:\n')[1]?.split('\nCommands:')[0] ?? ''
  return options.split('\n').filter(line => /^ {2}(?! )-/.test(line) || (agent === 'codex' && /^ {6}(?! )--/.test(line)))
    .flatMap(line => (line.trim().split(/ [<\[]| {2,}/)[0] ?? '').match(/--?[a-zA-Z][\w-]*/g) ?? []).sort()
}
for (const agent of ['claude', 'codex'] as const) {
  const available = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'palco-help', agent], { stdio: 'ignore' }).status === 0
  it.skipIf(!available)(`o catálogo acompanha as flags instaladas (requer ${agent} no PATH)`, () => {
    const home = mkdtempSync(join(tmpdir(), 'palco-agent-help-'))
    try {
      const env = { ...process.env, HOME: home, CODEX_HOME: home, CLAUDE_CONFIG_DIR: home }
      const result = spawnSync(agent, ['--help'], { env, cwd: home, encoding: 'utf8', timeout: 15000 })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      const installed = helpFlags(result.stdout, agent)
      expect(installed.length).toBeGreaterThan(10)
      const catalog = [...AGENT_OPTIONS, ...EXCLUDED_AGENT_OPTIONS].filter(o => o.agent === agent).flatMap(o => [o.flag, ...o.aliases]).sort()
      expect(installed.filter(f => !catalog.includes(f)), 'Flags novas: revise e inclua ou registre a exclusão no catálogo').toEqual([])
      expect(catalog.filter(f => !installed.includes(f)), 'Flags removidas: revise o catálogo para esta versão instalada').toEqual([])
      expect(new Set(catalog).size).toBe(catalog.length)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
}
it('todas as opções têm explicação nos três idiomas e escolhas válidas', () => {
  for (const o of AGENT_OPTIONS) {
    for (const locale of ['pt-BR', 'en', 'es'] as const) expect(o.explanation[locale].length).toBeGreaterThan(15)
    if (o.kind === 'choice') expect(o.values?.length).toBeGreaterThan(1)
    if (o.flag.includes('dangerously')) expect(o.risk).toBe('danger')
  }
})
