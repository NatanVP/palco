// excluir um workspace apaga a pasta de prompts dele, e só ela.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { PromptStore, removePromptsWithWorkspace } from '../src/main/prompts/prompt-store'
import { en } from '../src/shared/i18n/catalogs/en'
import { es } from '../src/shared/i18n/catalogs/es'
import { ptBR } from '../src/shared/i18n/catalogs/pt-BR'

let dir: string, registry: WorkspaceRegistry, prompts: PromptStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'palco-prompt-cleanup-'))
  registry = new WorkspaceRegistry(join(dir, 'workspaces'))
  prompts = new PromptStore(join(dir, 'prompts'))
})
afterEach(() => { registry.flushAll(); rmSync(dir, { recursive: true, force: true }) })

const save = (name: string, workspaceId: string | null) => prompts.save({ name, body: 'texto', workspaceId })
const folder = (...parts: string[]) => join(dir, 'prompts', ...parts)
/** Uma pasta fora da biblioteca, que nenhum caminho de limpeza pode tocar. */
function outside(): string {
  const path = join(dir, 'fora'); mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'meu.txt'), 'intacto')
  return path
}

it('apaga a pasta do workspace excluído, com os anexos; a global e a dos outros ficam', () => {
  removePromptsWithWorkspace(registry, prompts)
  const other = registry.create('Outro'), first = registry.list().find((w) => w.id !== other)!.id
  save('Global', null); const gone = save('Do outro', other); save('Do primeiro', first)
  writeFileSync(folder(gone.id, 'anexo.txt'), 'x')
  registry.remove(other)
  expect(existsSync(folder(other))).toBe(false)
  expect(prompts.list().items.map((p) => p.name).sort()).toEqual(['Do primeiro', 'Global'])
})

it('não segue links: nem os de dentro da pasta, nem a própria pasta, nem a biblioteca', () => {
  const target = outside(), inside = registry.create('A'), linked = registry.create('B'), third = registry.create('C')
  removePromptsWithWorkspace(registry, prompts)
  save('p', inside); symlinkSync(target, folder(inside, 'atalho')); symlinkSync(join(target, 'meu.txt'), folder(inside, 'p', 'arquivo'))
  symlinkSync(target, folder(linked))
  registry.remove(inside); registry.remove(linked)
  expect(existsSync(folder(inside))).toBe(false)
  expect(readdirSync(folder())).toContain(linked)
  expect(readFileSync(join(target, 'meu.txt'), 'utf8')).toBe('intacto')

  // A biblioteca inteira trocada por um link: nada é apagado do outro lado.
  mkdirSync(join(target, third)); writeFileSync(join(target, third, 'nota.txt'), 'fica')
  rmSync(folder(), { recursive: true, force: true }); symlinkSync(target, folder())
  registry.remove(third)
  expect(existsSync(join(target, third, 'nota.txt'))).toBe(true)
})

it('um prompt global que ocupa o nome do id não é apagado; id inválido é recusado', () => {
  mkdirSync(folder('abc'), { recursive: true }); writeFileSync(folder('abc', 'PROMPT.md'), '---\nname: "g"\n---\ncorpo')
  save('Global', null)
  prompts.removeWorkspace('abc')
  expect(existsSync(folder('abc', 'PROMPT.md'))).toBe(true)
  for (const bad of ['', '.', '..', '../fora', 'a/b']) expect(() => prompts.removeWorkspace(bad)).toThrow()
  expect(existsSync(folder('global', 'PROMPT.md'))).toBe(true)
})

it('o desfazer de um prompt apagado não recria a pasta do workspace excluído', () => {
  removePromptsWithWorkspace(registry, prompts)
  const id = registry.create('Some'), token = prompts.remove(save('p', id).id), kept = prompts.remove(save('g', null).id)
  registry.remove(id)
  expect(() => prompts.undo(token)).toThrow()
  expect(existsSync(folder(id))).toBe(false)
  expect(prompts.undo(kept).name).toBe('g')
})

it('exclusão recusada não apaga nada, e uma falha na limpeza não desfaz a exclusão', () => {
  const warn = vi.fn()
  removePromptsWithWorkspace(registry, prompts, warn)
  const only = registry.list()[0]!.id
  save('p', only)
  expect(() => registry.remove(only)).toThrow()
  expect(existsSync(folder(only))).toBe(true)

  const other = registry.create('Outro')
  vi.spyOn(prompts, 'removeWorkspace').mockImplementation(() => { throw new Error('disco') })
  expect(() => registry.remove(other)).not.toThrow()
  expect(registry.list().map((w) => w.id)).toEqual([only])
  expect(warn).toHaveBeenCalledTimes(1)
})

it('a confirmação de exclusão avisa que os prompts do workspace são apagados', () => {
  for (const catalog of [ptBR, en, es]) expect(catalog['App.encerra_os_terminais_dele_e_ti']).toMatch(/prompts/i)
})
