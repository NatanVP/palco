import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { RoleStore } from '../../src/main/agents/roles'
import { PresetStore, AgentCatalog } from '../../src/main/agents/presets'
import { buildAgentCommand } from '../../src/main/pty/agent-command'
let dir: string
beforeEach(() => { dir = mkdtempSync(join(process.cwd(), 'tests/agents/.data-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
it('round trips roles and presets, resolves recruit defaults, and refuses shell/missing roles', () => {
  const roles = new RoleStore(join(dir, 'roles')), presets = new PresetStore(join(dir, 'presets.json'), roles)
  roles.create('Reviewer', 'literal "quoted" $HOME\nsecond line')
  presets.create({ name: 'reviewer', agent: 'codex', command: '', role: 'Reviewer' })
  const catalog = new AgentCatalog(presets, roles)
  expect(catalog.recruit({ preset: 'reviewer' })).toEqual({ agent: 'codex', command: 'codex', role: 'reviewer' })
  expect(new PresetStore(join(dir, 'presets.json'), roles).list()).toHaveLength(1)
  expect(new RoleStore(join(dir, 'roles')).get('Reviewer').text).toBe('literal "quoted" $HOME\nsecond line')
  expect(() => presets.create({ name: 'bad', agent: 'claude', command: '', role: 'absent' })).toThrow(/role não encontrado/)
  expect(() => catalog.recruit({ agent: 'shell', role: 'Reviewer' })).toThrow('role não se aplica a shell')
  expect(() => roles.create('../..', 'bad')).toThrow()
  roles.edit('Reviewer', 'changed'); expect(roles.get('Reviewer').text).toBe('changed')
  presets.remove('reviewer'); expect(presets.list()).toEqual([])
})
it('quotes the complete role config and file path as single shell words', () => {
  const role = { file: "/tmp/role's $FILE.md", text: "quotes '\" $HOME\nnext" }
  const quote = (s: string): string => "'" + s.replace(/'/g, "'\"'\"'") + "'"
  expect(buildAgentCommand('claude', 'claude', '/b', role)).toContain('--append-system-prompt-file ' + quote(role.file))
  // O texto do role do Codex vai por variável de ambiente (tests/pty/role-env.test.ts); o comando só a referencia.
  expect(buildAgentCommand('codex', 'codex', '/b', role)).toContain('-c "developer_instructions=$PALCO_ROLE_TOML"')
  expect(buildAgentCommand('codex', 'codex', '/b', role)).not.toContain('quotes')
  expect(() => buildAgentCommand('shell', '', '/b', role)).toThrow('role não se aplica a shell')
})
