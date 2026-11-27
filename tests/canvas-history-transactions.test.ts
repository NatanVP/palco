import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { CanvasHistory } from '../src/main/history/canvas-history'
import type { NewNode } from '../src/shared/model'

const dirs: string[] = [], stores: WorkspaceStore[] = []
const make = () => {
  const dir = mkdtempSync(join(tmpdir(), 'palco-history-')); dirs.push(dir)
  const store = new WorkspaceStore(join(dir, 'workspace.json')); stores.push(store); return store
}
const note = (name = 'N'): NewNode => ({ kind: 'note', name, content: '', floorId: null, pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } })
afterEach(() => { stores.splice(0).forEach(s => s.dispose()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })) })
describe('histórico do canvas', () => {
  it('criar, mover, redimensionar, editar nota, ligar/desligar e apagar são reversíveis', () => {
    const s = make(), h = new CanvasHistory(), id = h.transact(s, () => s.addNode(note()))
    expect(h.canUndo(s)).toBe(true)
    h.transact(s, () => s.patchNode(id, { pos: { x: 20, y: 30 }, size: { w: 500, h: 400 }, content: 'novo' }))
    expect(h.undo(s)).toBe(true); expect(s.get().nodes[id]).toMatchObject({ content: '', pos: { x: 0, y: 0 } })
    h.redo(s); expect(s.get().nodes[id]).toMatchObject({ content: 'novo', size: { w: 500 } })
    const b = h.transact(s, () => s.addNode(note('B')))
    const c = h.transact(s, () => s.connect(id, b))
    h.transact(s, () => s.disconnect(c.id)); h.undo(s); expect(s.get().connections).toEqual([c])
    h.transact(s, () => s.removeNode(id)); h.undo(s); expect(s.get().nodes[id]).toBeDefined(); expect(s.get().connections).toEqual([c])
  })
  it('limite 50, edição invalida redo, no-op não cria nível e workspaces são independentes', () => {
    const s = make(), other = make(), h = new CanvasHistory()
    for (let i = 0; i < 51; i++) h.transact(s, () => s.addNode(note()))
    for (let i = 0; i < 50; i++) expect(h.undo(s)).toBe(true)
    expect(h.undo(s)).toBe(false); expect(Object.keys(s.get().nodes)).toHaveLength(1)
    expect(h.canUndo(other)).toBe(false)
    h.transact(s, () => {}); expect(h.canRedo(s)).toBe(true)
    h.transact(s, () => s.addNode(note())); expect(h.canRedo(s)).toBe(false)
  })
  it('lote misto é um nível, falha reverte documento sem registrar, câmera não é desfeita', () => {
    const s = make(), h = new CanvasHistory(), a = s.addNode(note()), b = s.addNode(note())
    const d = s.addDrawing({ floorId: null, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#ffffff', width: 3 })
    h.transact(s, () => { s.removeNode(a); s.removeNode(b); s.removeDrawing(d) })
    s.setCamera({ offset: { x: 99, y: 88 }, zoom: 2 })
    h.undo(s); expect(Object.keys(s.get().nodes)).toHaveLength(2); expect(s.get().drawings).toHaveLength(1)
    expect(s.get().camera.zoom).toBe(2); expect(h.canUndo(s)).toBe(false)
    expect(() => h.transact(s, () => { s.removeNode(a); throw new Error('falha') })).toThrow('falha')
    expect(s.get().nodes[a]).toBeDefined(); expect(h.canUndo(s)).toBe(false)
  })
  it('terminal removido é encerrado; undo relança configuração com mesmo id/cordas; undo de criação encerra', () => {
    const s = make(), spawn = vi.fn(), dispose = vi.fn(), h = new CanvasHistory({ spawn, dispose, unregister: vi.fn() })
    const id = h.transact(s, () => s.addNode({ ...note(), kind: 'terminal', agent: 'shell', command: 'bash', cwd: '/tmp' } as NewNode))
    const b = s.addNode(note()), edge = s.connect(id, b)
    expect(spawn).toHaveBeenCalledTimes(1)
    h.transact(s, () => s.removeNode(id)); expect(dispose).toHaveBeenCalledWith(id)
    h.undo(s); expect(spawn).toHaveBeenCalledTimes(2); expect(spawn.mock.calls[1]![0]).toMatchObject({ id, command: 'bash', cwd: '/tmp' }); expect(s.get().connections).toEqual([edge])
    h.redo(s); expect(dispose).toHaveBeenCalledTimes(2)
    h.undo(s); h.undo(s); expect(s.get().nodes[id]).toBeUndefined(); expect(dispose).toHaveBeenCalledTimes(3)
  })
})
it('publica só o estado final do lote e não expõe documento parcial em rollback', () => {
  const s = make(), h = new CanvasHistory(), a = s.addNode(note()), b = s.addNode(note())
  const observed: number[] = []
  s.onChange(ws => observed.push(Object.keys(ws.nodes).length))
  h.transact(s, () => { s.removeNode(a); s.removeNode(b) })
  expect(observed).toEqual([0])
  h.undo(s); observed.length = 0
  expect(() => h.transact(s, () => { s.removeNode(a); throw new Error('falha') })).toThrow()
  expect(observed.every(n => n === 2)).toBe(true)
})
it('mudança externa invalida snapshots, câmera preserva redo e trocar andar limpa histórico', () => {
  const s = make(), h = new CanvasHistory()
  s.onChange(() => h.observe(s))
  const a = h.transact(s, () => s.addNode(note()))
  h.undo(s); s.setCamera({ offset: { x: 1, y: 2 }, zoom: 2 }); expect(h.canRedo(s)).toBe(true)
  h.redo(s); s.patchNode(a, { content: 'agente alterou' }); expect(h.canUndo(s)).toBe(false)
  h.transact(s, () => s.patchNode(a, { content: 'ui' }))
  const f = s.addFloor({ name: 'F', dir: '/tmp', branch: '', baseRef: '', repoRoot: '/tmp', plain: true })
  s.setActiveFloor(f); s.setActiveFloor(null); expect(h.canUndo(s)).toBe(false)
})
it("undo/redo não inicia autoStart false nem terminais de andar fora da tela", () => {
  const s = make(), spawn = vi.fn(), h = new CanvasHistory({ spawn, dispose: vi.fn(), unregister: vi.fn() })
  const stopped = s.addNode({ ...note(), kind: 'terminal', agent: 'shell', command: 'agent', cwd: '/tmp', autoStart: false } as NewNode)
  h.transact(s, () => s.removeNode(stopped)); h.undo(s)
  expect(spawn).not.toHaveBeenCalled()
  const created = h.transact(s, () => s.addNode({ ...note(), kind: 'terminal', agent: 'shell', command: 'agent', cwd: '/tmp', autoStart: false } as NewNode))
  h.undo(s); h.redo(s); expect(s.get().nodes[created]).toBeDefined(); expect(spawn).not.toHaveBeenCalled()
  const floor = s.addFloor({ name: 'Offscreen', dir: '/tmp', branch: '', baseRef: '', repoRoot: '/tmp', plain: true })
  const hidden = s.addNode({ ...note(), kind: 'terminal', agent: 'shell', command: 'agent', cwd: '/tmp', floorId: floor } as NewNode)
  h.transact(s, () => s.removeNode(hidden)); h.undo(s)
  expect(spawn).not.toHaveBeenCalled()
})
it.each(['transact', 'undo', 'redo'] as const)("falha de spawn em %s preserva processos antigos e limpa só as tentativas novas", action => {
  const s = make(), live = new Set<string>(), spawn = vi.fn((n: { id: string }) => { live.add(n.id) }), dispose = vi.fn((id: string) => { live.delete(id) })
  const h = new CanvasHistory({ spawn, dispose, unregister: vi.fn() })
  const terminal = (name: string): NewNode => ({ ...note(name), kind: 'terminal', agent: 'shell', command: name, cwd: '/tmp' } as NewNode)
  // The replacement and the two originals are documents before/after one reversible action.
  const replacement = s.addNode(terminal('replacement'))
  live.add(replacement)
  let a!: string, b!: string
  const replace = () => { s.removeNode(replacement); a = s.addNode(terminal('A')); b = s.addNode(terminal('B')) }
  if (action === 'transact') {
    const failure = new Error('spawn B falhou')
    spawn.mockImplementation(n => { live.add(n.id); if (n.id === b) throw failure })
    const before = s.get()
    expect(() => h.transact(s, replace)).toThrow(failure)
    expect(s.get().nodes).toEqual(before.nodes)
    expect(live).toEqual(new Set([replacement])); expect(dispose).not.toHaveBeenCalledWith(replacement)
    expect(h.canUndo(s)).toBe(false)
  } else {
    h.transact(s, replace)
    if (action === 'redo') h.undo(s)
    const originals = new Set(live), before = s.get(), failure = new Error('spawn falhou')
    const failId = action === 'undo' ? replacement : b
    spawn.mockImplementation(n => { live.add(n.id); if (n.id === failId) throw failure })
    dispose.mockClear(); spawn.mockClear()
    expect(() => h[action](s)).toThrow(failure)
    expect(s.get().nodes).toEqual(before.nodes); expect(live).toEqual(originals)
    for (const id of originals) { expect(dispose).not.toHaveBeenCalledWith(id); expect(spawn.mock.calls.some(c => c[0].id === id)).toBe(false) }
    expect(action === 'undo' ? h.canUndo(s) : h.canRedo(s)).toBe(true)
  }
})
it("restore recusado antes de mutar mantém o erro original e não tenta restaurar de novo", () => {
  const s = make(), h = new CanvasHistory(), id = h.transact(s, () => s.addNode(note()))
  const original = new Error('workspace somente leitura'), secondary = new Error('erro secundário')
  const restore = vi.spyOn(s, 'restoreCanvas').mockImplementationOnce(() => { throw original }).mockImplementation(() => { throw secondary })
  let received: unknown
  try { h.undo(s) } catch (error) { received = error }
  expect(received).toBe(original); expect(restore).toHaveBeenCalledOnce()
  expect(s.get().nodes[id]).toBeDefined(); expect(h.canUndo(s)).toBe(true)
})
