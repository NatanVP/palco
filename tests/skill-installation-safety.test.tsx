// @vitest-environment happy-dom
// Bibliotecas de agentes: regressões de instalação e preservação dos arquivos do usuário.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/** Falha injetada: devolve `true` para a chamada que deve estourar. */
const fault = vi.hoisted(() => ({ write: null as null | ((path: string) => boolean), rename: null as null | ((from: string, to: string) => boolean) }))
vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>()
  const boom = (): never => { throw Object.assign(new Error('ENOSPC: falha injetada'), { code: 'ENOSPC' }) }
  return {
    ...real,
    writeFileSync: ((path: string, ...rest: unknown[]) => (fault.write?.(String(path)) ? boom() : (real.writeFileSync as (...a: unknown[]) => void)(path, ...rest))) as typeof real.writeFileSync,
    renameSync: ((from: string, to: string) => (fault.rename?.(String(from), String(to)) ? boom() : real.renameSync(from, to))) as typeof real.renameSync
  }
})

import { SkillBases } from '../src/main/skill-bases'
import { installSkills, VERSION_FILE } from '../src/main/skills-install'
import { PromptStore } from '../src/main/prompts/prompt-store'
import { AgentsTab } from '../src/renderer/src/settings/tabs/agents'

const dirs: string[] = []
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'palco-skill-safety-')); dirs.push(d); return d }
let root: Root | undefined, host: HTMLElement
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => {
  fault.write = null; fault.rename = null
  await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
  const home = temp(), source = join(temp(), 'source'), file = join(home, 'bases.json')
  for (const name of ['palco', 'palco-extra']) { mkdirSync(join(source, name), { recursive: true }); writeFileSync(join(source, name, 'SKILL.md'), `nova ${name}`) }
  return { home, source, file, make: (accounts: (a: 'claude' | 'codex') => string[] = () => []) => new SkillBases(file, source, home, accounts) }
}
/** Uma cópia antiga, gerenciada pelo palco. */
function managed(dir: string, name = 'palco'): string { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), 'antiga'); writeFileSync(join(dir, name, VERSION_FILE), 'v-antiga\n'); return join(dir, name) }
/** Uma pasta do usuário com o mesmo nome de uma skill do palco. */
function mine(dir: string, name = 'palco'): string { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), 'do usuário'); writeFileSync(join(dir, name, 'notes.txt'), 'minhas notas'); return join(dir, name) }
const intact = (dir: string): void => { expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('do usuário'); expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('minhas notas') }

describe("instalar nunca apaga o que não tem o marcador do palco", () => {
  for (const [id, path] of [['claude', '.claude/skills'], ['agents', '.agents/skills'], ['hermes', '.hermes/skills'], ['antigravity', '.gemini/config/skills']] as const) {
    it(`preserva a pasta do usuário em ${path} e avisa qual ficou de fora`, () => {
      const { home, make } = setup(), kept = mine(join(home, path)), s = make()
      s.apply()
      intact(kept)
      expect(existsSync(join(kept, VERSION_FILE))).toBe(false)
      // As outras skills do mesmo local são instaladas normalmente.
      expect(existsSync(join(home, path, 'palco-extra', VERSION_FILE))).toBe(true)
      expect(s.list().find(b => b.id === id)!.conflicts).toEqual(['palco'])
      expect(readdirSync(join(home, path)).filter(n => n.startsWith('.'))).toEqual([])
    })
  }
  it('não segue nem apaga link: nem a skill, nem o marcador', () => {
    const { source } = setup(), target = join(temp(), 'skills'), outside = mine(temp())
    mkdirSync(target, { recursive: true }); symlinkSync(outside, join(target, 'palco'))
    const fake = join(target, 'palco-extra'); mkdirSync(fake); writeFileSync(join(fake, 'notes.txt'), 'meu')
    const elsewhere = join(temp(), 'marker'); writeFileSync(elsewhere, 'x'); symlinkSync(elsewhere, join(fake, VERSION_FILE))
    expect(installSkills(source, target)).toEqual([])
    intact(outside); expect(lstatSync(join(target, 'palco')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(fake, 'notes.txt'), 'utf8')).toBe('meu')
  })
  it('não instala através de uma pasta de destino que é link', () => {
    const { source } = setup(), real = temp(), link = join(temp(), 'link'); symlinkSync(real, link)
    expect(installSkills(source, link)).toEqual([])
    expect(readdirSync(real)).toEqual([])
  })
  it('se a troca falha no meio, a cópia anterior volta para o lugar', () => {
    const { source } = setup(), target = temp(), old = managed(target)
    fault.rename = (from, to) => from.endsWith('.tmp') && to === old
    expect(() => installSkills(source, target)).toThrow(/ENOSPC/)
    expect(readFileSync(join(old, 'SKILL.md'), 'utf8')).toBe('antiga')
  })
  it('mudar o caminho de um local só apaga o antigo depois de o novo estar completo', () => {
    const { home, make } = setup(), s = make()
    const b = s.save({ name: 'Meu', path: join(home, 'um'), enabled: true })
    mine(join(home, 'dois'))
    s.save({ ...b, path: join(home, 'dois') })
    expect(existsSync(join(home, 'um/palco/SKILL.md'))).toBe(true)
    intact(join(home, 'dois/palco'))
  })
})

describe("a cópia antiga do Codex só sai depois de a nova estar instalada e conferida", () => {
  const legacyOf = (home: string): string => join(home, '.codex/skills')
  it('destino novo completo: a antiga sai', () => {
    const { home, make } = setup(), old = managed(legacyOf(home))
    make().apply()
    expect(existsSync(join(home, '.agents/skills/palco', VERSION_FILE))).toBe(true)
    expect(existsSync(old)).toBe(false)
  })
  it('~/.agents/skills é um link: a antiga fica', () => {
    const { home, make } = setup(), old = managed(legacyOf(home)), shared = temp()
    mkdirSync(join(home, '.agents')); symlinkSync(shared, join(home, '.agents/skills'))
    expect(() => make().apply()).toThrow()
    expect(existsSync(join(old, 'SKILL.md'))).toBe(true); expect(readdirSync(shared)).toEqual([])
  })
  it('uma das skills esbarra numa pasta do usuário: a antiga fica', () => {
    const { home, make } = setup(), old = managed(legacyOf(home))
    mine(join(home, '.agents/skills'), 'palco-extra')
    make().apply()
    expect(existsSync(join(old, 'SKILL.md'))).toBe(true)
  })
  it('a cópia falha: a antiga fica, também nas contas', () => {
    const { home, make } = setup(), old = managed(legacyOf(home)), account = managed(join(home, 'conta/skills'))
    fault.rename = (_from, to) => to.includes('.agents')
    expect(() => make(a => (a === 'codex' ? [join(home, 'conta')] : [])).apply()).toThrow()
    expect(existsSync(old)).toBe(true); expect(existsSync(account)).toBe(true)
  })
  it('conta Codex que aponta para um local em uso não perde as skills dele', () => {
    const { home, make } = setup()
    make(a => (a === 'codex' ? [join(home, '.claude'), join(home, '.agents')] : [])).apply()
    expect(existsSync(join(home, '.claude/skills/palco/SKILL.md'))).toBe(true)
    expect(existsSync(join(home, '.agents/skills/palco/SKILL.md'))).toBe(true)
  })
  it('~/.codex é um link: nada é apagado através dele', () => {
    const { home, make } = setup(), real = temp(), old = managed(join(real, 'skills'))
    symlinkSync(real, join(home, '.codex'))
    make().apply()
    expect(existsSync(old)).toBe(true)
  })
  it('redefinir uma lista antiga também mantém a base Codex enquanto a nova não estiver completa', () => {
    const { home, file, make } = setup()
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, type: 'skill-bases', payload: [{ id: 'codex', name: 'Codex', path: legacyOf(home), enabled: true, builtin: 'codex' }] }))
    const s = make(); s.apply()
    mine(join(home, '.agents/skills'))
    s.reset()
    expect(existsSync(join(legacyOf(home), 'palco/SKILL.md'))).toBe(true)
    intact(join(home, '.agents/skills/palco'))
  })
})

describe("mover um prompt de escopo é tudo ou nada", () => {
  function prompt() {
    const dir = temp(), s = new PromptStore(dir), p = s.save({ name: 'Antigo', body: 'original', workspaceId: null })
    writeFileSync(join(dir, 'antigo', 'anexo.txt'), 'anexo')
    return { dir, s, p }
  }
  const untouched = ({ dir, s, p }: ReturnType<typeof prompt>): void => {
    expect(s.read(p.id)).toMatchObject({ body: 'original', workspaceId: null })
    expect(readFileSync(join(dir, 'antigo', 'anexo.txt'), 'utf8')).toBe('anexo')
    expect(s.list()).toEqual({ items: [{ id: 'antigo', name: 'Antigo', description: '', workspaceId: null }], problems: [] })
    if (existsSync(join(dir, 'w1'))) expect(readdirSync(join(dir, 'w1'))).toEqual([])
  }
  for (const [what, arm] of [
    ['a escrita do PROMPT.md', () => { fault.write = path => path.includes('.tmp') }],
    ['a publicação da pasta nova', () => { fault.rename = (_f, to) => /w1[\\/]antigo$/.test(to) }],
    ['a retirada da pasta antiga', () => { fault.rename = from => /[\\/]antigo$/.test(from) && !from.includes('w1') }]
  ] as const) {
    it(`falha em ${what}: o antigo fica como estava e dá para tentar de novo`, () => {
      const at = prompt()
      arm()
      expect(() => at.s.save({ ...at.p, body: 'novo', workspaceId: 'w1' })).toThrow(/ENOSPC/)
      untouched(at)
      fault.write = null; fault.rename = null
      expect(at.s.save({ ...at.p, body: 'novo', workspaceId: 'w1' }).id).toBe('w1/antigo')
      expect(at.s.list().items.map(i => i.id)).toEqual(['w1/antigo'])
      expect(readFileSync(join(at.dir, 'w1/antigo/anexo.txt'), 'utf8')).toBe('anexo')
      expect(existsSync(join(at.dir, 'antigo'))).toBe(false)
    })
  }
  it('anexo que é link continua link na pasta nova (não é seguido nem reescrito)', () => {
    const at = prompt(); symlinkSync('../fora.txt', join(at.dir, 'antigo', 'atalho'))
    at.s.save({ ...at.p, workspaceId: 'w1' })
    expect(lstatSync(join(at.dir, 'w1/antigo/atalho')).isSymbolicLink()).toBe(true)
  })
})

const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const fire = (el: Element, e: Event) => act(async () => { el.dispatchEvent(e) })
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
async function render(section: string) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(<AgentsTab section={section} />)) }
function promptsApi() {
  const items = [{ id: 'a', name: 'Alfa', description: '', workspaceId: null as string | null }, { id: 'b', name: 'Beta', description: '', workspaceId: null as string | null }]
  const prompts = { list: vi.fn(async () => ({ items, problems: [] })), read: vi.fn(async (id: string) => ({ ...items.find(i => i.id === id)!, body: 'corpo' })), save: vi.fn(async (d: unknown) => d), remove: vi.fn((_id: string) => new Promise<string>(() => {})), undo: vi.fn(), showFolder: vi.fn(async () => {}), directory: vi.fn(async () => '/p') }
  Object.assign(window, { palco: { workspaces: { sidebar: async () => ({ workspaces: [{ id: 'w1', name: 'COdigos' }], active: 'w1' }), onSidebar: () => () => {} }, prompts } })
  return prompts
}

describe('falha ao salvar preserva o estado do editor', () => {
  it('mantém o rascunho, relê a lista e a nova tentativa usa o mesmo prompt', async () => {
    const prompts = promptsApi()
    prompts.save.mockRejectedValueOnce(new Error("Error invoking remote method 'x': Error: disco cheio"))
    await render('Prompts')
    await fire(host.querySelector('[data-item="a"] .library-select')!, new MouseEvent('dblclick', { bubbles: true }))
    const reads = prompts.list.mock.calls.length
    await click(button('Salvar'))
    expect(document.querySelector('.library-editor [role=alert]')?.textContent).toBe('disco cheio')
    expect(prompts.list.mock.calls.length).toBeGreaterThan(reads)
    await click(button('Salvar'))
    expect(prompts.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', body: 'corpo' }))
    expect(document.querySelector('.library-editor')).toBeNull()
  })
})

describe("\"Mostrar pasta de prompts\" segue a pílula", () => {
  it('abre a pasta do espaço escolhido; em Todos e Global, a raiz', async () => {
    const prompts = promptsApi()
    await render('Prompts')
    await click(button('Mostrar pasta de prompts')); expect(prompts.showFolder).toHaveBeenLastCalledWith(null)
    await click([...host.querySelectorAll('.library-pills button')].find(b => b.textContent === 'COdigos')!)
    await click(button('Mostrar pasta de prompts')); expect(prompts.showFolder).toHaveBeenLastCalledWith('w1')
  })
})

describe("lista ocupada não aceita teclado, duplo clique nem menu", () => {
  it('com uma exclusão pendente, nada mais chega à API', async () => {
    const prompts = promptsApi()
    await render('Prompts')
    const select = () => host.querySelector('[data-item="b"] .library-select')!
    await click(host.querySelector('[data-item="a"] .library-delete')!)
    expect(prompts.remove).toHaveBeenCalledTimes(1)
    const reads = prompts.read.mock.calls.length
    for (const key of ['Delete', 'Backspace']) await fire(select(), new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await fire(select(), new MouseEvent('dblclick', { bubbles: true }))
    await fire(select().closest('.library-row')!, new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await click(host.querySelector('[data-item="b"] .library-expand')!)
    await fire(host.querySelector('.library-description p')!, new MouseEvent('dblclick', { bubbles: true }))
    expect(prompts.remove).toHaveBeenCalledTimes(1)
    expect(prompts.read.mock.calls.length).toBe(reads)
    expect(document.querySelector('[role=menu]')).toBeNull()
    expect(document.querySelector('.library-editor')).toBeNull()
  })
  it('só libera quando todas as operações pendentes terminam', async () => {
    const prompts = promptsApi(), done: Array<() => void> = []
    prompts.showFolder.mockImplementation(() => new Promise<void>(r => { done.push(r) }))
    prompts.remove.mockImplementation(() => new Promise<string>(r => { done.push(() => r('t')) }))
    await render('Prompts')
    const del = () => host.querySelector<HTMLButtonElement>('[data-item="a"] .library-delete')!
    // Duas no mesmo tique, antes de a tela se desabilitar.
    await act(async () => { del().click(); button('Mostrar pasta de prompts').click() })
    expect(done).toHaveLength(2)
    await act(async () => { done[0]!() })
    expect(del().disabled).toBe(true)
    await act(async () => { done[1]!() })
    expect(del().disabled).toBe(false)
  })
})

describe('proteção dos arquivos do usuário na interface', () => {
  it('a linha do local diz quais skills não foram instaladas e por quê', async () => {
    Object.assign(window, { palco: { skills: { list: async () => [{ id: 'agents', name: 'Agent Skills', path: '/h/.agents/skills', display: '~/.agents/skills', enabled: true, conflicts: ['palco'] }] } } })
    await render('Skills')
    expect(host.querySelector('.skill-conflict')?.textContent).toContain('palco')
  })
})
