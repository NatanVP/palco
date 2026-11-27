import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PromptStore } from '../src/main/prompts/prompt-store'
import { RoleLibrary } from '../src/main/agents/role-library'
import { RoleStore } from '../src/main/agents/roles'
import { SkillBases } from '../src/main/skill-bases'
const dirs: string[] = []
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'palco-b3-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
describe('prompts: cada opção tem consumidor persistente', () => {
 it('cria, lista por escopo e lê corpo para @Prompts, inclusive após relançar', () => {
  const root = temp(), s = new PromptStore(root)
  const p = s.save({ name: 'Revisão', description: 'Leia', body: 'Revise o diff.', workspaceId: 'w' })
  expect(s.list('other').items).toHaveLength(0); expect(s.list('w').items[0]?.name).toBe('Revisão')
  expect(new PromptStore(root).read(p.id).body).toBe('Revise o diff.')
  expect(existsSync(join(root, p.id, 'PROMPT.md'))).toBe(true)
 })
 it('edita, move escopo, impede colisão sem distinguir caixa e valida corpo', () => {
  const s = new PromptStore(temp()), p = s.save({ name: 'Um', body: 'texto', workspaceId: null })
  expect(() => s.save({ name: 'UM', body: 'outro', workspaceId: null })).toThrow(/existe/)
  const edited = s.save({ ...p, name: 'Dois', body: 'novo', workspaceId: 'w' }); expect(s.read(edited.id).body).toBe('novo')
  expect(() => s.save({ name: 'Vazio', body: ' ', workspaceId: null })).toThrow()
 })
 it('exclui com desfazer sem sobrescrever conteúdo mais recente', () => {
  const s = new PromptStore(temp()), p = s.save({ name: 'Teste', body: 'texto', workspaceId: null })
  const token = s.remove(p.id); expect(s.list().items).toHaveLength(0); s.undo(token); expect(s.read(p.id).body).toBe('texto')
  const t = s.remove(p.id); s.save({ name: 'Teste', body: 'novo', workspaceId: null }); expect(() => s.undo(t)).toThrow()
 })
 it('diagnostica UTF-8, frontmatter, vazio e limite sem perder arquivos; recusa travessia/links', () => {
  const root = temp(), s = new PromptStore(root)
  for (const [name, bytes] of [['sem', 'texto'], ['vazio', ''], ['grande', 'x'.repeat(262145)], ['utf', Buffer.from([255])]] as const) { mkdirSync(join(root, name)); writeFileSync(join(root, name, 'PROMPT.md'), bytes) }
  expect(s.list().problems).toHaveLength(4); expect(() => s.read('../fora')).toThrow()
  symlinkSync(temp(), join(root, 'link')); expect(() => s.save({ id: 'link', name: 'link', body: 't', workspaceId: null })).toThrow()
 })
})
describe('responsabilidades', () => {
 it('nome, instruções, escopo, ícone e cor persistem; nomes não colidem', () => {
  const dir = temp(), s = new RoleLibrary(new RoleStore(dir))
  s.save({ name: 'Revisor', text: 'Revise', workspaceId: 'w', icon: 'check', color: '#123456' })
  expect(new RoleLibrary(new RoleStore(dir)).list()[0]).toMatchObject({ name: 'revisor', displayName: 'Revisor', text: 'Revise', icon: 'check', color: '#123456', workspaceId: 'w' })
  expect(() => s.save({ name: 'REVISOR', text: 'x', workspaceId: null })).toThrow()
  s.save({ id: 'revisor', name: 'Revisão', text: 'novo', workspaceId: null }); expect(s.list()[0]?.displayName).toBe('Revisão')
 })
 it('exclusão múltipla desatribui terminais antes de remover', () => {
  const detached: string[] = [], s = new RoleLibrary(new RoleStore(temp()), name => { detached.push(name) })
  s.save({ name: 'A', text: 'a', workspaceId: null }); s.save({ name: 'B', text: 'b', workspaceId: null })
  s.remove(['a', 'b']); expect(detached).toEqual(['a', 'b']); expect(s.list()).toHaveLength(0)
 })
 it('descobre somente role.json do projeto, mostra prévia e importa selecionados', () => {
  const root = temp(); mkdirSync(join(root, '.palco/roles/r'), { recursive: true }); writeFileSync(join(root, '.palco/roles/r/role.json'), JSON.stringify({ name: 'Revisor', instructions: 'Leia tudo' }))
  const s = new RoleLibrary(new RoleStore(temp())), found = s.discover(root)
  expect(found[0]?.text).toBe('Leia tudo'); s.import(found, 'w'); expect(s.list()[0]?.workspaceId).toBe('w')
 })
})
describe('skills: efeito imediato e seguro', () => {
 it('ativa/desativa, edita, ordena e remove bases preservando skills do usuário', () => {
  const root = temp(), source = join(root, 'source'), target = join(root, 'target'); mkdirSync(join(source, 'palco-test'), { recursive: true }); writeFileSync(join(source, 'palco-test/SKILL.md'), 'skill')
  mkdirSync(join(target, 'user'), { recursive: true }); writeFileSync(join(target, 'user/SKILL.md'), 'user')
  const s = new SkillBases(join(root, 'bases.json'), source, root)
  const b = s.save({ name: 'Minha base', path: target, enabled: true, icon: 'folder' })
  expect(existsSync(join(target, 'palco-test/SKILL.md'))).toBe(true)
  s.save({ ...b, enabled: false }); expect(existsSync(join(target, 'palco-test'))).toBe(false); expect(existsSync(join(target, 'user/SKILL.md'))).toBe(true)
  s.reorder([b.id, ...s.list().filter(x => x.id !== b.id).map(x => x.id)]); expect(s.list()[0]?.id).toBe(b.id)
  s.remove(b.id); expect(s.list().some(x => x.id === b.id)).toBe(false)
 })
 it('valida caminhos, duplicatas e links antes de copiar ou apagar', () => {
  const root = temp(), s = new SkillBases(join(root, 'bases.json'), join(root, 'source'), root)
  expect(() => s.save({ name: 'x', path: root + '/../escape', enabled: true })).toThrow()
  expect(() => s.save({ name: 'x', path: root + '/a;echo', enabled: true })).toThrow()
  const target = join(root, 'target'); s.save({ name: 'x', path: target, enabled: false }); expect(() => s.save({ name: 'y', path: target, enabled: false })).toThrow()
  symlinkSync(temp(), join(root, 'link')); expect(() => s.save({ name: 'link', path: join(root, 'link'), enabled: true })).toThrow()
 })
})

import { PresetStore } from '../src/main/agents/presets'
import { PartituraStore } from '../src/main/partituras/partitura-store'
it('remover responsabilidade limpa referências de presets e partituras sem iniciar processos', () => {
 const root = temp(), roles = new RoleStore(join(root, 'roles')); roles.create('a', 'Leia')
 const presets = new PresetStore(join(root, 'presets.json'), roles)
 presets.create({ name: 'Teste', agent: 'claude', command: 'claude', role: 'a' }); presets.clearRole('a'); expect(presets.get('Teste').role).toBeUndefined()
 const parts = new PartituraStore(join(root, 'parts')); parts.save({ name: 'Teste', createdAt: new Date().toISOString(), nodes: [{ key: 't', floorId: null, kind: 'terminal', name: 'T', agent: 'claude', command: 'claude', cwd: root, role: 'a', pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } }], connections: [], bands: [] })
 parts.clearRole('a'); expect(parts.usesRole('a')).toBe(false)
})
it('desativar base de CLI remove também skills gerenciadas nas contas; pasta da conta não é apagada', () => {
 const root = temp(), source = join(root, 'source'), account = join(root, 'account'); mkdirSync(join(source, 'palco-test'), { recursive: true }); writeFileSync(join(source, 'palco-test/SKILL.md'), 'skill')
 const s = new SkillBases(join(root, 'bases.json'), source, root, agent => agent === 'claude' ? [account] : [])
 s.apply(); expect(existsSync(join(account, 'skills/palco-test/SKILL.md'))).toBe(true)
 const base = s.list().find(x => x.id === 'claude')!; s.save({ ...base, enabled: false })
 expect(existsSync(join(account, 'skills/palco-test'))).toBe(false); expect(existsSync(account)).toBe(true)
 expect(s.targets('claude', account)).toEqual([])
})
it('configuração de skills inválida fica somente leitura, sem instalar defaults por cima', () => {
 const root = temp(), file = join(root, 'bases.json'); writeFileSync(file, '{bad')
 const s = new SkillBases(file, join(root, 'source'), root)
 expect(() => s.list()).toThrow(/somente leitura/)
 s.apply(); expect(s.targets('claude')).toEqual([]); expect(readFileSync(file, 'utf8')).toBe('{bad')
})
it('excluir prompt remove pasta vazia sem criar diagnóstico falso', () => {
 const root = temp(), s = new PromptStore(root), p = s.save({ name: 'A', body: 'B', workspaceId: null }); s.remove(p.id)
 expect(s.list().problems).toEqual([])
})
it('responsabilidade chamada constructor é global por padrão e exclusão remove seus metadados', () => {
 const store = new RoleStore(temp()), lib = new RoleLibrary(store)
 store.create('constructor', 'texto'); expect(store.scopeOf('constructor')).toBeNull()
 lib.save({ id: 'constructor', name: 'Constructor', text: 'x', icon: 'check', color: '#123456', workspaceId: null }); lib.remove(['constructor'])
 store.create('constructor', 'novo'); expect(store.details('constructor')).toEqual({})
})
it('base de skills não pode apontar para os recursos do próprio app', () => {
 const root = temp(), source = join(root, 'resources/skills'); mkdirSync(source, { recursive: true })
 const s = new SkillBases(join(root, 'bases.json'), source, root)
 expect(() => s.save({ name: 'Recursos', path: source, enabled: true })).toThrow(/recursos/)
})
it('exclusão mostra contagem viva de terminais que serão desatribuídos', () => {
 const lib = new RoleLibrary(new RoleStore(temp()), () => {}, () => 3)
 lib.save({ name: 'Revisor', text: 'x', workspaceId: null }); expect(lib.list()[0]?.terminalCount).toBe(3)
})
