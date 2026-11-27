import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installSkills, palcoSkills, skillTargets, VERSION_FILE } from '../src/main/skills-install'

let dir: string, source: string, target: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'palco-skills-'))
  source = join(dir, 'src')
  target = join(dir, 'home', '.claude', 'skills')
  for (const name of ['palco', 'palco-manager']) {
    mkdirSync(join(source, name, 'ref'), { recursive: true })
    writeFileSync(join(source, name, 'SKILL.md'), `# ${name}\n`)
    writeFileSync(join(source, name, 'ref', 'extra.md'), 'extra\n')
  }
  mkdirSync(join(source, 'outra'))
  writeFileSync(join(source, 'outra', 'SKILL.md'), 'não é do palco')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('copia só as skills palco*, com a versão, e não toca no resto da pasta do agente', () => {
  mkdirSync(join(target, 'minha-skill'), { recursive: true })
  writeFileSync(join(target, 'minha-skill', 'SKILL.md'), 'do usuário')
  expect(palcoSkills(source)).toEqual(['palco', 'palco-manager'])
  expect(installSkills(source, target)).toEqual(['palco', 'palco-manager'])
  expect(readFileSync(join(target, 'palco-manager', 'ref', 'extra.md'), 'utf8')).toBe('extra\n')
  expect(readFileSync(join(target, 'palco', VERSION_FILE), 'utf8').trim()).toMatch(/^[0-9a-f]{16}$/)
  expect(existsSync(join(target, 'outra'))).toBe(false)
  expect(readFileSync(join(target, 'minha-skill', 'SKILL.md'), 'utf8')).toBe('do usuário')
  // Sem sobra de temporários.
  expect(readdirSync(target).sort()).toEqual(['minha-skill', 'palco', 'palco-manager'])
})

it('só reinstala quando a versão muda; a cópia nova substitui a pasta inteira', () => {
  installSkills(source, target)
  writeFileSync(join(target, 'palco', 'lixo.md'), 'local')
  expect(installSkills(source, target)).toEqual([])
  expect(existsSync(join(target, 'palco', 'lixo.md'))).toBe(true)
  writeFileSync(join(source, 'palco', 'SKILL.md'), '# palco v2\n')
  expect(installSkills(source, target)).toEqual(['palco'])
  expect(readFileSync(join(target, 'palco', 'SKILL.md'), 'utf8')).toBe('# palco v2\n')
  expect(existsSync(join(target, 'palco', 'lixo.md'))).toBe(false)
})

it('pastas de destino por agente e conta', () => {
  expect(skillTargets('claude', '/h')).toEqual(['/h/.claude/skills'])
  expect(skillTargets('claude', '/h', '/h/.claude-sonnet')).toEqual(['/h/.claude/skills', '/h/.claude-sonnet/skills'])
  expect(skillTargets('codex', '/h', '/h/.codex')).toEqual(['/h/.codex/skills'])
  expect(skillTargets('shell', '/h')).toEqual([])
  expect(skillTargets('other', '/h')).toEqual([])
})
