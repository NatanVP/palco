import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { parseDrawing, parseNewNode, parseNodePatch } from '../../src/main/validate'

let dir: string
let store: WorkspaceStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'palco-draw-'))
  store = new WorkspaceStore(join(dir, 'ws.json'))
})
afterEach(() => {
  try { store.flush() } catch { /* fixture */ }
  rmSync(dir, { recursive: true, force: true })
})

const base = { floorId: null, name: 'X', pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } }

describe('validação dos nós novos', () => {
  it('aceita texto, arquivo e pasta', () => {
    expect(parseNewNode({ ...base, kind: 'text', text: 'oi', fontSize: 24 })).toEqual({ ...base, kind: 'text', text: 'oi', fontSize: 24 })
    expect(parseNewNode({ ...base, kind: 'file', path: '/tmp/a.png' })).toEqual({ ...base, kind: 'file', path: '/tmp/a.png' })
    expect(parseNewNode({ ...base, kind: 'filetree', root: '/tmp' })).toEqual({ ...base, kind: 'filetree', root: '/tmp' })
  })

  it('recusa caminho relativo e fonte absurda', () => {
    expect(() => parseNewNode({ ...base, kind: 'file', path: 'a.png' })).toThrow()
    expect(() => parseNewNode({ ...base, kind: 'filetree', root: '' })).toThrow()
    expect(() => parseNewNode({ ...base, kind: 'text', text: 'x', fontSize: 0 })).toThrow()
    expect(() => parseNewNode({ ...base, kind: 'text', text: 'x', fontSize: 1000 })).toThrow()
  })

  it('patch de texto só vale para nó de texto', () => {
    expect(parseNodePatch({ text: 'novo', fontSize: 32 }, 'text')).toEqual({ text: 'novo', fontSize: 32 })
    expect(() => parseNodePatch({ text: 'x' }, 'note')).toThrow()
    expect(() => parseNodePatch({ path: '/etc/passwd' }, 'file')).toThrow()
  })

  it('patch de aparência do terminal (Editar da barra contextual): cor, ícone e fonte', () => {
    expect(parseNodePatch({ color: '#FF3B30', icon: 'brain', fontSize: 15 }, 'terminal')).toEqual({ color: '#FF3B30', icon: 'brain', fontSize: 15 })
    expect(parseNodePatch({ icon: '🎸' }, 'terminal')).toEqual({ icon: '🎸' })
    expect(() => parseNodePatch({ color: 'red; x' }, 'terminal')).toThrow()
    expect(() => parseNodePatch({ fontSize: 99 }, 'terminal')).toThrow()
    expect(() => parseNodePatch({ icon: 'nome de ícone grande demais' }, 'terminal')).toThrow()
    // A cor da nota altera o cartão; portal não tem esse campo.
    expect(() => parseNodePatch({ color: '#FF3B30' }, 'portal')).toThrow()
    const id = store.addNode({ ...base, kind: 'terminal', agent: 'shell', command: 'bash', cwd: '/tmp' })
    store.patchNode(id, { color: '#34C759', icon: 'terminal', fontSize: 14 })
    expect(store.get().nodes[id]).toMatchObject({ color: '#34C759', icon: 'terminal', fontSize: 14, command: 'bash' })
  })

  it('store aplica o patch de texto', () => {
    const id = store.addNode({ ...base, kind: 'text', text: 'a', fontSize: 20 })
    store.patchNode(id, { text: 'b', fontSize: 30 })
    expect(store.get().nodes[id]).toMatchObject({ text: 'b', fontSize: 30 })
  })
})

describe('desenhos', () => {
  const stroke = { floorId: null, points: [{ x: 0, y: 0 }, { x: 10, y: 5 }], color: '#ffd24d', width: 3 }

  it('parseDrawing valida pontos, cor e largura', () => {
    expect(parseDrawing(stroke)).toEqual(stroke)
    expect(() => parseDrawing({ ...stroke, points: [] })).toThrow()
    expect(() => parseDrawing({ ...stroke, points: [{ x: 'a', y: 0 }] })).toThrow()
    expect(() => parseDrawing({ ...stroke, color: 'url(javascript:1)' })).toThrow()
    expect(() => parseDrawing({ ...stroke, width: 0 })).toThrow()
    expect(() => parseDrawing({ ...stroke, points: Array.from({ length: 20001 }, () => ({ x: 0, y: 0 })) })).toThrow()
  })

  it('store adiciona, remove e persiste', () => {
    const id = store.addDrawing(stroke)
    expect(store.get().drawings).toEqual([{ ...stroke, id }])
    store.flush()
    expect(new WorkspaceStore(join(dir, 'ws.json')).get().drawings).toEqual([{ ...stroke, id }])
    store.removeDrawing(id)
    expect(store.get().drawings).toEqual([])
  })

  it('desenho em floor inexistente é recusado; remover o floor leva os desenhos dele', () => {
    expect(() => store.addDrawing({ ...stroke, floorId: 'nada' })).toThrow(/floor/)
    const f = store.addFloor({ name: 'ui', repoRoot: '/r', dir: '/r.floors/ui', branch: 'palco/ui', baseRef: 'main' })
    store.addDrawing({ ...stroke, floorId: f })
    const ground = store.addDrawing(stroke)
    store.removeFloor(f)
    expect(store.get().drawings!.map((d) => d.id)).toEqual([ground])
  })
})
