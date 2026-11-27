// partitura importada nunca inicia nada sem confirmação, a importação é toda ou nada e a atualização mostra o que muda.
import * as fs from 'node:fs'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PartituraStore, reviewPartitura } from '../../src/main/partituras/partitura-store'
import { previewUpdate, startPartitura, updatePartitura } from '../../src/main/partituras/routes'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import type { Partitura } from '../../src/shared/model'

let dir: string, lib: PartituraStore, registry: WorkspaceRegistry
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-import-safety-')); lib = new PartituraStore(join(dir, 'library')); registry = new WorkspaceRegistry(join(dir, 'workspaces')) })
afterEach(() => { registry.flushAll(); rmSync(dir, { recursive: true, force: true }) })

const terminal = (extra: Record<string, unknown> = {}) => ({ key: 'a', kind: 'terminal', floorId: null, name: 'T', agent: 'other', command: 'touch marcador', cwd: '/algum/lugar', pos: { x: 0, y: 0 }, size: { w: 400, h: 260 }, ...extra })
const score = (name: string, nodes: unknown[] = [terminal()]) => ({ name, createdAt: '2026-11-25', bands: [], connections: [], nodes }) as unknown as Partitura
const file = (...items: unknown[]) => JSON.stringify({ format: 'palco-partituras', version: 1, partituras: items })
const store = () => registry.active()
const spawned: string[] = []
const start = (name: string, commands: boolean, confirmed?: boolean) => startPartitura(lib, store(), name, null, { x: 0, y: 0 }, commands, (n) => spawned.push(n.command), undefined, () => {}, confirmed)
beforeEach(() => { spawned.length = 0 })

it('a revisão do arquivo lista cada terminal com comando, pasta e ambiente, mais os portais e arquivos, sem gravar nada', () => {
  const doc = file(score('Fora', [terminal({ environment: { kind: 'ssh', host: 'servidor', user: 'ana', port: 22 }, maestro: true }),
    terminal({ key: 'b', name: 'C', agent: 'claude', command: '' }), terminal({ key: 'c', name: 'S', agent: 'shell', command: '' }),
    { key: 'p', kind: 'portal', floorId: null, name: 'P', url: 'https://example.com/x', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } },
    { key: 'f', kind: 'file', floorId: null, name: 'F', path: '/etc/hosts', pos: { x: 0, y: 0 }, size: { w: 200, h: 100 } }]))
  expect(lib.reviewImport(doc)).toEqual([{ name: 'Fora', imported: true, portals: ['https://example.com/x'], paths: ['/etc/hosts'], terminals: [
    { name: 'T', agent: 'other', command: 'touch marcador', cwd: '/algum/lugar', environment: 'ssh · ana@servidor', maestro: true },
    { name: 'C', agent: 'claude', command: 'claude', cwd: '/algum/lugar', environment: 'local', maestro: false },
    { name: 'S', agent: 'shell', command: '', cwd: '/algum/lugar', environment: 'local', maestro: false }] }])
  expect(lib.list()).toEqual([])
})
it('importar marca como importada e tira o que é desta máquina ou decide a inicialização', () => {
  lib.import(file(score('Fora', [terminal({ accountId: 'conta-alheia', autoStart: true, recruitedBy: 'x', unloaded: true, id: 'forjado' })])))
  const saved = lib.get('Fora')
  expect(saved.imported).toBe(true)
  for (const field of ['accountId', 'autoStart', 'recruitedBy', 'unloaded', 'id']) expect(saved.nodes[0]).not.toHaveProperty(field)
  expect(reviewPartitura(saved).imported).toBe(true)
  expect(lib.export()).not.toContain('"imported"')
})
it('recusa portal que não é http, https nem file, e pasta com caractere de controle', () => {
  const portal = { key: 'p', kind: 'portal', floorId: null, name: 'P', url: 'javascript:alert(1)', pos: { x: 0, y: 0 }, size: { w: 4, h: 3 } }
  expect(() => lib.reviewImport(file(score('A', [portal])))).toThrow()
  expect(() => lib.import(file(score('B', [terminal({ cwd: '/a\nrm -rf x' })])))).toThrow()
  expect(lib.list()).toEqual([])
})
it('arquivo que não é JSON dá mensagem legível', () => { expect(() => lib.reviewImport('isto não é json')).toThrow('arquivo inválido') })

it('partitura importada não inicia nada sem confirmação: nem pelo painel nem pela linha de comando, e nada vai para o canvas', () => {
  lib.import(file(score('Fora')))
  expect(() => start('Fora', true)).toThrow(/confirme os comandos/)
  expect(spawned).toEqual([]); expect(Object.keys(store().get().nodes)).toEqual([])
  expect(lib.get('Fora').imported).toBe(true)
})
it('inserir sem iniciar é livre e continua pedindo confirmação depois; confirmada uma vez, passa a valer como local', () => {
  lib.import(file(score('Fora')))
  start('Fora', false)
  expect(spawned).toEqual([]); expect(Object.values(store().get().nodes)[0]).toMatchObject({ autoStart: false })
  expect(() => start('Fora', true)).toThrow(/confirme os comandos/)
  start('Fora', true, true)
  expect(spawned).toEqual(['touch marcador']); expect(lib.get('Fora').imported).toBeUndefined()
  start('Fora', true); expect(spawned).toHaveLength(2)
})
it('se o início falha, a confirmação não fica gravada', () => {
  lib.import(file(score('Fora')))
  expect(() => startPartitura(lib, store(), 'Fora', null, { x: 0, y: 0 }, true, () => { throw new Error('sem pty') }, undefined, () => {}, true)).toThrow('sem pty')
  expect(lib.get('Fora').imported).toBe(true)
})
it('partitura salva localmente continua iniciando como antes; importada sem terminal não pede confirmação', () => {
  lib.save(score('Local')); start('Local', true); expect(spawned).toEqual(['touch marcador'])
  lib.import(file(score('So nota', [{ key: 'n', kind: 'note', floorId: null, name: 'N', content: 'oi', pos: { x: 0, y: 0 }, size: { w: 2, h: 2 } }])))
  expect(() => start('So nota', true)).not.toThrow()
})
it('renomear mantém a marca de importada', () => { lib.import(file(score('Fora'))); lib.rename('Fora', 'Outra'); expect(lib.get('Outra').imported).toBe(true) })

it('importação é toda ou nada mesmo quando a gravação falha no meio', () => {
  const original = lib.save.bind(lib)
  vi.spyOn(lib, 'save').mockImplementation((p) => { if (p.name === 'Tres') throw new Error('disco cheio'); original(p) })
  expect(() => lib.import(file(score('Um'), score('Dois'), score('Tres')))).toThrow('disco cheio')
  expect(lib.list()).toEqual([]); expect(fs.existsSync(join(dir, 'library')) ? readdirSync(join(dir, 'library')) : []).toEqual([])
})
it('falha na importação não apaga o que já existia', () => {
  lib.save(score('Antiga'))
  const original = lib.save.bind(lib)
  vi.spyOn(lib, 'save').mockImplementation((p) => { if (p.name === 'Dois') throw new Error('disco cheio'); original(p) })
  expect(() => lib.import(file(score('Um'), score('Dois')))).toThrow()
  expect(lib.list().map((p) => p.name)).toEqual(['Antiga'])
})

it('a prévia da atualização diz o que sai, o que entra e o que muda, sem gravar', () => {
  const note = (name: string, content: string) => store().addNode({ kind: 'note', floorId: null, name, content, pos: { x: 0, y: 0 }, size: { w: 200, h: 100 } } as never)
  const a = note('Fica', 'igual'), b = note('Muda', 'antes'), c = note('Sai', 'x')
  lib.save({ ...score('Time', []), nodes: [a, b, c].map((id) => { const { id: _, ...n } = store().get().nodes[id]!; return { ...n, key: id } }) as never })
  store().patchNode(b, { content: 'depois' } as never)
  const d = note('Entra', 'novo'), before = lib.get('Time')
  expect(previewUpdate(lib, store(), 'Time', null, { noteText: true, ids: new Set([a, b, d]) })).toEqual({
    name: 'Time', before: 3, after: 3, connections: [0, 0],
    removed: [{ kind: 'note', name: 'Sai' }], added: [{ kind: 'note', name: 'Entra' }], changed: [{ kind: 'note', name: 'Muda' }] })
  expect(lib.get('Time')).toEqual(before)
  updatePartitura(lib, store(), 'Time', null, { noteText: true, ids: new Set([a, d]) })
  expect(lib.get('Time').nodes.map((n) => n.name).sort()).toEqual(['Entra', 'Fica'])
})
