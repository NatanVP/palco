import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import type { NewNode } from '../../src/shared/model'

let root: string
let dir: string
let legacy: string
const opened: WorkspaceRegistry[] = []

const open = (withLegacy = true): WorkspaceRegistry => {
  const r = new WorkspaceRegistry(dir, withLegacy ? legacy : undefined)
  opened.push(r)
  return r
}

const terminal = (name: string): NewNode => ({
  kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }
})

/** Um workspace.json de arquivo único, com um terminal e uma nota. */
function writeLegacy(): { id: string; terminal: string; note: string } {
  const s = new WorkspaceStore(legacy)
  const t = s.addNode(terminal('Alfa'))
  const n = s.addNode({ kind: 'note', floorId: null, name: 'Plano', content: 'oi', pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } })
  s.flush()
  return { id: s.get().id, terminal: t, note: n }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'palco-reg-'))
  dir = join(root, 'workspaces')
  legacy = join(root, 'workspace.json')
})

afterEach(() => {
  for (const r of opened.splice(0)) {
    try { r.flushAll() } catch { /* fixture */ }
  }
  rmSync(root, { recursive: true, force: true })
})

describe('WorkspaceRegistry: migração do arquivo único', () => {
  it('sem nada no disco, cria um workspace padrão ativo', () => {
    const r = open()
    expect(r.list()).toHaveLength(1)
    expect(r.activeId()).toBe(r.list()[0]!.id)
    expect(existsSync(join(dir, `${r.activeId()}.json`))).toBe(true)
  })

  it('move workspace.json para workspaces/<id>.json e renomeia o original para .migrado', () => {
    const old = writeLegacy()
    const r = open()
    expect(r.list().map((w) => w.id)).toEqual([old.id])
    expect(r.activeId()).toBe(old.id)
    expect(Object.keys(r.get(old.id).get().nodes).sort()).toEqual([old.terminal, old.note].sort())
    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(`${legacy}.migrado`)).toBe(true)
    expect(existsSync(join(dir, `${old.id}.json`))).toBe(true)
  })

  it('é idempotente: abrir de novo não duplica nem perde nada', () => {
    const old = writeLegacy()
    open().flushAll()
    const again = open()
    expect(again.list().map((w) => w.id)).toEqual([old.id])
    expect(again.get(old.id).get().nodes[old.terminal]?.name).toBe('Alfa')
  })

  it('recupera a migração interrompida depois de gravar o novo e antes de renomear o antigo', () => {
    const old = writeLegacy()
    // Simula a queda: o arquivo novo já existe, o antigo continua lá.
    const target = join(dir, `${old.id}.json`)
    open(false).flushAll() // cria a pasta com um padrão qualquer
    copyFileSync(legacy, target)
    const r = open()
    expect(r.list().map((w) => w.id)).toContain(old.id)
    expect(r.list().filter((w) => w.id === old.id)).toHaveLength(1)
    expect(r.get(old.id).get().nodes[old.terminal]?.name).toBe('Alfa')
    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(`${legacy}.migrado`)).toBe(true)
  })

  it('não sobrescreve o novo se ele já existir com outro conteúdo (o novo vence)', () => {
    const old = writeLegacy()
    const first = open()
    first.get(old.id).addNode(terminal('Novo'))
    first.flushAll()
    // O antigo reaparece (por exemplo, restaurado de backup): não pode apagar o trabalho novo.
    copyFileSync(`${legacy}.migrado`, legacy)
    const r = open()
    const names = Object.values(r.get(old.id).get().nodes).map((n) => n.name)
    expect(names).toContain('Novo')
    expect(readdirSync(root).filter((f) => f.startsWith('workspace.json.migrado')).length).toBeGreaterThanOrEqual(2)
  })

  it('workspace.json ilegível não é migrado nem apagado; vira aviso', () => {
    rmSync(legacy, { force: true })
    writeFileSync(legacy, '{ quebrado')
    const r = open()
    expect(existsSync(legacy)).toBe(true)
    expect(readFileSync(legacy, 'utf8')).toBe('{ quebrado')
    expect(r.warning).toMatch(/workspace\.json/)
  })
})

describe('WorkspaceRegistry: vários workspaces', () => {
  it('terminais com o mesmo nome em workspaces diferentes resolvem cada um no seu store', () => {
    const r = open(false)
    const a = r.activeId()
    const b = r.create('Outro')
    const ta = r.get(a).addNode(terminal('Alfa'))
    const tb = r.get(b).addNode(terminal('Alfa'))
    expect(r.storeOfNode(ta)).toBe(r.get(a))
    expect(r.storeOfNode(tb)).toBe(r.get(b))
    expect(r.storeOfNode('nada')).toBeUndefined()
    expect(r.node(tb)?.name).toBe('Alfa')
    expect(Object.keys(r.allNodes()).sort()).toEqual([ta, tb].sort())
  })

  it('create grava o arquivo na hora e o nome vale no workspace e na barra', () => {
    const r = open(false)
    const id = r.create('Produto')
    expect(existsSync(join(dir, `${id}.json`))).toBe(true)
    expect(r.get(id).get().name).toBe('Produto')
    expect(r.list().find((w) => w.id === id)?.name).toBe('Produto')
    expect(() => r.create('produto')).toThrow(/já existe/)
    expect(() => r.create('  ')).toThrow()
  })

  it('rename muda a barra e o workspace, e sobrevive a reabrir', () => {
    const r = open(false)
    const id = r.create('A')
    r.rename(id, 'B')
    r.flushAll()
    const again = open(false)
    expect(again.list().find((w) => w.id === id)?.name).toBe('B')
    expect(again.get(id).get().name).toBe('B')
  })

  it('remove devolve os terminais a matar, preserva o arquivo e troca o ativo', () => {
    const r = open(false)
    const first = r.activeId()
    const id = r.create('Temp')
    r.switch(id)
    const t1 = r.get(id).addNode(terminal('Um'))
    r.get(id).addNode({ kind: 'note', floorId: null, name: 'N', content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
    const t2 = r.get(id).addNode(terminal('Dois'))
    expect(r.remove(id).sort()).toEqual([t1, t2].sort())
    expect(r.list().map((w) => w.id)).toEqual([first])
    expect(r.activeId()).toBe(first)
    expect(r.storeOfNode(t1)).toBeUndefined()
    expect(existsSync(join(dir, `${id}.json`))).toBe(false)
    expect(readdirSync(dir).some((f) => f.startsWith(`${id}.json.removido`))).toBe(true)
    expect(() => r.remove(first)).toThrow(/último/)
  })

  it('avisa mudanças de qualquer workspace com o id dele', () => {
    const r = open(false)
    const b = r.create('B')
    const seen: string[] = []
    r.onChange((id) => seen.push(id))
    r.get(b).addNode(terminal('X'))
    expect(seen).toEqual([b])
  })
})

describe('Sidebar: spaces', () => {
  it('mover workspace entre spaces respeita o índice dentro do grupo', () => {
    const r = open(false)
    const w0 = r.activeId()
    const w1 = r.create('Um')
    const w2 = r.create('Dois')
    const s = r.createSpace('Clientes')
    r.move(w1, s, 0)
    r.move(w2, s, 0)
    const side = r.sidebar()
    expect(side.workspaces.find((w) => w.id === w1)?.spaceId).toBe(s)
    const inSpace = side.order.filter((id) => side.workspaces.find((w) => w.id === id)?.spaceId === s)
    expect(inSpace).toEqual([w2, w1])
    expect(side.workspaces.find((w) => w.id === w0)?.spaceId).toBeNull()
    expect(() => r.move(w1, 'nao-existe', 0)).toThrow(/space/)
  })

  it('apagar um space devolve os workspaces dele para a lista solta', () => {
    const r = open(false)
    const w1 = r.create('Um')
    const s = r.createSpace('Temp')
    r.move(w1, s, 0)
    expect(r.removeSpace(s)).toEqual([w1])
    const side = r.sidebar()
    expect(side.spaces).toEqual([])
    expect(side.workspaces.find((w) => w.id === w1)?.spaceId).toBeNull()
  })

  it('toggle recolhe e expande; rename de space; nomes únicos', () => {
    const r = open(false)
    const s = r.createSpace('A')
    r.toggleSpace(s)
    expect(r.sidebar().spaces[0]?.collapsed).toBe(true)
    r.toggleSpace(s)
    expect(r.sidebar().spaces[0]?.collapsed).toBe(false)
    r.renameSpace(s, 'B')
    expect(r.sidebar().spaces[0]?.name).toBe('B')
    expect(() => r.createSpace('b')).toThrow(/já existe/)
  })

  it('a barra persiste e se reconcilia com os arquivos do disco', () => {
    const r = open(false)
    const w1 = r.create('Um')
    const s = r.createSpace('S')
    r.move(w1, s, 0)
    r.switch(w1)
    r.flushAll()
    const again = open(false)
    const side = again.sidebar()
    expect(side.active).toBe(w1)
    expect(side.spaces.map((x) => x.name)).toEqual(['S'])
    expect(side.workspaces.find((w) => w.id === w1)?.spaceId).toBe(s)
    expect(side.order).toHaveLength(2)
  })

  it('sidebar.json corrompido é reconstruído a partir dos arquivos', () => {
    const r = open(false)
    const w1 = r.create('Um')
    r.flushAll()
    writeFileSync(join(root, 'sidebar.json'), 'lixo')
    const again = open(false)
    expect(again.list().map((w) => w.id)).toContain(w1)
    expect(again.list().find((w) => w.id === w1)?.name).toBe('Um')
  })
})
