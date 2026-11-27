// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentsTab } from '../src/renderer/src/settings/tabs/agents'
import { SkillBases } from '../src/main/skill-bases'
import type { SkillBase } from '../src/shared/agent-libraries'

let root: Root | undefined, host: HTMLElement
const dirs: string[] = []
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'palco-skill-paths-')); dirs.push(d); return d }
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const base = (id: string, name: string, path: string, enabled = true): SkillBase => ({ id, name, path: `/home/u/${path}`, display: `~/${path}`, enabled, icon: 'sparkle' })
function mock(items = [base('a', 'Claude Code', '.claude/skills'), base('b', 'Agent Skills', '.agents/skills', false), base('c', 'Hermes', '.hermes/skills')]) {
  const skills = { list: vi.fn(async () => items), save: vi.fn(async (d: unknown) => d), remove: vi.fn(async () => {}), reorder: vi.fn(async () => {}), reset: vi.fn(async () => {}) }
  Object.assign(window, { palco: { skills } })
  return skills
}
async function panel() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(<AgentsTab section="Skills" />)) }
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
async function type(el: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
const label = (text: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${text}"]`)!

it('um cartão como o dos presets: marcador, ícone, nome e caminho com ~, ações só em ícone', async () => {
  mock()
  await panel()
  expect(host.querySelector('h3')).toBeNull()
  expect(host.querySelector('.settings-hint')?.textContent).toContain('skills')
  const rows = [...host.querySelectorAll('ul.preset-card > li')]
  expect(rows).toHaveLength(3)
  expect(rows[0]!.querySelector('.preset-name')?.textContent).toBe('Claude Code')
  expect(rows[0]!.querySelector('.preset-command')?.textContent).toBe('~/.claude/skills')
  expect(rows[0]!.querySelector('.preset-icon svg')).not.toBeNull()
  expect(rows[0]!.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true')
  expect(rows[1]!.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('false')
  for (const b of rows[0]!.querySelectorAll('button')) expect(b.textContent).toBe('')
  expect(label('Mover Claude Code para cima').disabled).toBe(true)
  expect(label('Mover Hermes para baixo').disabled).toBe(true)
  expect(button('Adicionar Caminho Personalizado').querySelector('svg.lucide-plus')).not.toBeNull()
  expect(button('Redefinir para Padrão').querySelector('svg.lucide-rotate-ccw')).not.toBeNull()
  expect(host.textContent).toContain('As alterações são aplicadas imediatamente.')
  expect(host.textContent).not.toContain('WSL')
})

it('marcar, mover, excluir e redefinir chamam o main (os dois últimos com confirmação)', async () => {
  const skills = mock()
  await panel()
  await click(host.querySelector('[role=checkbox]')!)
  expect(skills.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', enabled: false }))
  await click(label('Mover Claude Code para baixo'))
  expect(skills.reorder).toHaveBeenLastCalledWith(['b', 'a', 'c'])
  await click(label('Excluir Hermes'))
  expect(skills.remove).not.toHaveBeenCalled()
  await click(document.querySelector('.settings-confirm .danger')!)
  expect(skills.remove).toHaveBeenCalledWith('c')
  await click(button('Redefinir para Padrão'))
  expect(skills.reset).not.toHaveBeenCalled()
  await click(document.querySelector('.settings-confirm .danger')!)
  expect(skills.reset).toHaveBeenCalled()
})

it('o editor abre dentro da aba, mostra o caminho com ~ e valida antes de salvar', async () => {
  const skills = mock()
  await panel()
  await click(label('Editar Claude Code'))
  const editor = () => host.querySelector('[data-inline-editor]')!
  const path = () => editor().querySelector<HTMLInputElement>('input.is-mono')!
  expect(path().value).toBe('~/.claude/skills')
  await type(path(), '~/../fora'); expect(editor().querySelector('[role=alert]')?.textContent).toContain('..'); expect(button('Salvar').disabled).toBe(true)
  await type(path(), '~/a;b'); expect(button('Salvar').disabled).toBe(true)
  await type(path(), '.hermes/skills/'); expect(editor().querySelector('[role=alert]')?.textContent).toContain('Outra entrada'); expect(button('Salvar').disabled).toBe(true)
  await type(path(), '~/novo/skills'); await click(button('Salvar'))
  expect(skills.save).toHaveBeenLastCalledWith({ id: 'a', name: 'Claude Code', path: '~/novo/skills', enabled: true, icon: 'sparkle' })
  expect(host.querySelector('[data-inline-editor]')).toBeNull()
  await click(button('Adicionar Caminho Personalizado'))
  expect(button('Salvar').disabled).toBe(true)
  await type(editor().querySelector<HTMLInputElement>('input[maxlength="120"]')!, 'Meu'); await type(path(), '/opt/skills'); await click(button('Salvar'))
  expect(skills.save).toHaveBeenLastCalledWith({ name: 'Meu', path: '/opt/skills', enabled: true, icon: 'folder' })
})

function setup() {
  const home = temp(), source = join(temp(), 'source'), file = join(home, 'bases.json')
  mkdirSync(join(source, 'palco-test'), { recursive: true }); writeFileSync(join(source, 'palco-test/SKILL.md'), 'skill')
  const installed = (path: string) => existsSync(join(home, path, 'palco-test/SKILL.md'))
  return { home, source, file, installed, make: (accounts: (a: 'claude' | 'codex') => string[] = () => []) => new SkillBases(file, source, home, accounts) }
}

it('locais padrão do palco, todos ligados, com o caminho em ~', () => {
  const { make, home, installed } = setup(), s = make()
  expect(s.list().map(b => [b.name, b.display, b.icon, b.enabled])).toEqual([
    ['Claude Code', '~/.claude/skills', 'badge-check', true], ['Agent Skills', '~/.agents/skills', 'file-text', true],
    ['Hermes', '~/.hermes/skills', 'send', true], ['Antigravity', '~/.gemini/config/skills', 'sparkle', true]
  ])
  s.apply()
  for (const p of ['.claude/skills', '.agents/skills', '.hermes/skills', '.gemini/config/skills']) expect(installed(p)).toBe(true)
  // Codex lê ~/.agents/skills; um terminal Claude não precisa dela.
  expect(s.targets('codex')).toContain(join(home, '.agents/skills'))
  expect(s.targets('codex')).not.toContain(join(home, '.claude/skills'))
  expect(s.targets('claude')).not.toContain(join(home, '.agents/skills'))
})

it('contas Claude recebem as skills; as do Codex não precisam: toda conta lê ~/.agents/skills, que fica no HOME', () => {
  const { make, home } = setup(), s = make(agent => [join(home, agent === 'codex' ? '.codex' : 'conta-claude')])
  s.apply()
  expect(existsSync(join(home, 'conta-claude/skills/palco-test'))).toBe(true)
  expect(existsSync(join(home, '.codex/skills'))).toBe(false)
  expect(s.targets('codex', join(home, '.codex'))).toEqual([join(home, '.agents/skills')])
  expect(s.targets('claude', join(home, 'conta-claude'))).toContain(join(home, 'conta-claude/skills'))
})

it('quem tem a lista antiga (base Codex em ~/.codex/skills) continua com as contas Codex', () => {
  const { home, source, file } = setup()
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, type: 'skill-bases', payload: [{ id: 'codex', name: 'Codex', path: join(home, '.codex/skills'), enabled: true, builtin: 'codex' }] }))
  const s = new SkillBases(file, source, home, agent => (agent === 'codex' ? [join(home, 'conta-codex')] : []))
  expect(s.list().map(b => b.id)).toEqual(['codex'])
  s.apply()
  expect(existsSync(join(home, 'conta-codex/skills/palco-test'))).toBe(true)
  expect(existsSync(join(home, '.codex/skills/palco-test'))).toBe(true)
})

it('sem lista própria, remove de ~/.codex/skills só as cópias do palco (o padrão antigo)', () => {
  const { make, home, installed } = setup()
  const old = join(home, '.codex/skills')
  mkdirSync(join(old, 'palco-test'), { recursive: true }); writeFileSync(join(old, 'palco-test/SKILL.md'), 'x'); writeFileSync(join(old, 'palco-test/.palco-version'), 'v')
  mkdirSync(join(old, 'palco-meu'), { recursive: true }); writeFileSync(join(old, 'palco-meu/SKILL.md'), 'do usuário')
  const account = join(home, 'conta-codex/skills')
  mkdirSync(join(account, 'palco-test'), { recursive: true }); writeFileSync(join(account, 'palco-test/.palco-version'), 'v')
  make(agent => (agent === 'codex' ? [join(home, '.codex'), join(home, 'conta-codex')] : [])).apply()
  expect(installed('.codex/skills')).toBe(false)
  expect(existsSync(join(account, 'palco-test'))).toBe(false)
  expect(existsSync(join(old, 'palco-meu/SKILL.md'))).toBe(true)
})

it('quem já tem lista própria continua com ela; redefinir volta ao padrão e limpa o que saiu', () => {
  const { make, home, file, installed } = setup()
  const s = make()
  const extra = s.save({ name: 'Extra', path: '~/extra/skills', enabled: true })
  expect(extra.path).toBe(join(home, 'extra/skills'))
  s.remove('hermes'); s.save({ ...s.list().find(b => b.id === 'claude')!, enabled: false })
  expect(make().list().map(b => b.id)).toEqual(['claude', 'agents', 'antigravity', extra.id])
  s.reset()
  expect(s.list().map(b => b.id)).toEqual(['claude', 'agents', 'hermes', 'antigravity'])
  expect(s.list().every(b => b.enabled)).toBe(true)
  expect(installed('extra/skills')).toBe(false)
  expect(installed('.claude/skills')).toBe(true); expect(installed('.hermes/skills')).toBe(true)
  expect(readFileSync(file, 'utf8')).not.toContain('"display"')
})

it('um local padrão que é link não derruba os outros', () => {
  const { make, home, installed } = setup()
  mkdirSync(join(home, '.claude')); symlinkSync(temp(), join(home, '.claude/skills'))
  const s = make()
  expect(() => s.apply()).toThrow()
  expect(installed('.agents/skills')).toBe(true); expect(installed('.gemini/config/skills')).toBe(true)
  expect(s.targets('claude')).not.toContain(join(home, '.claude/skills'))
})
