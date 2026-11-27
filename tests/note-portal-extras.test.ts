import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseNodePatch } from '../src/main/validate'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { validateWorkspace } from '../src/main/domain/workspace-schema'
import { parseExternalUrl } from '../src/main/domain/node-extras'
import { fileNotes, unfileNote, stackView } from '../src/renderer/src/canvas/note-stack'
import { barContent } from '../src/renderer/src/canvas/contextual'
import type { CanvasNode, NoteNode, Workspace } from '../src/shared/model'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-extras-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const note = (id: string, x: number, extra: Partial<NoteNode> = {}): NoteNode =>
  ({ id, kind: 'note', name: id.toUpperCase(), content: '', floorId: null, pos: { x, y: 100 }, size: { w: 260, h: 120 }, ...extra })
const ws = (nodes: CanvasNode[]): Workspace => ({
  id: 'w', name: 'W', nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 }
}) as unknown as Workspace

describe('patch da nota: cor, fonte, trava e fichário', () => {
  it('aceita valores válidos', () => {
    expect(parseNodePatch({ color: '#FF9500', fontSize: 16, fontFamily: 'serif', locked: true, stackId: 'f-1' }, 'note'))
      .toEqual({ color: '#FF9500', fontSize: 16, fontFamily: 'serif', locked: true, stackId: 'f-1' })
    expect(parseNodePatch({ color: null, stackId: null }, 'note')).toEqual({ color: null, stackId: null })
  })
  it('recusa valores ruins e campos de nota em outros tipos', () => {
    expect(() => parseNodePatch({ color: 'red' }, 'note')).toThrow()
    expect(() => parseNodePatch({ fontSize: 99 }, 'note')).toThrow()
    expect(() => parseNodePatch({ fontFamily: 'comic' }, 'note')).toThrow()
    expect(() => parseNodePatch({ locked: 'sim' }, 'note')).toThrow()
    expect(() => parseNodePatch({ stackId: '../x' }, 'note')).toThrow()
    expect(() => parseNodePatch({ locked: true }, 'portal')).toThrow()
    expect(() => parseNodePatch({ stackId: 'f' }, 'terminal')).toThrow()
  })
  it('store grava e null remove (cor, fichário)', () => {
    const store = new WorkspaceStore(join(dir, 'ws.json'))
    const id = store.addNode({ kind: 'note', floorId: null, name: 'N', content: 'x', pos: { x: 0, y: 0 }, size: { w: 260, h: 120 } })
    store.patchNode(id, { color: '#34C759', fontSize: 15, fontFamily: 'sans', locked: true, stackId: 'f-1' })
    expect(store.get().nodes[id]).toMatchObject({ color: '#34C759', fontSize: 15, fontFamily: 'sans', locked: true, stackId: 'f-1' })
    store.patchNode(id, { color: null, stackId: null, locked: false })
    const n = store.get().nodes[id] as NoteNode
    expect(n.color).toBeUndefined()
    expect(n.stackId).toBeUndefined()
    expect(n.locked).toBe(false)
    expect(n.content).toBe('x')
    store.flush()
  })
})

describe('portal: moldura e navegador externo', () => {
  it('chromeHidden só em portal e booleano', () => {
    expect(parseNodePatch({ chromeHidden: true }, 'portal')).toEqual({ chromeHidden: true })
    expect(() => parseNodePatch({ chromeHidden: 1 }, 'portal')).toThrow()
    expect(() => parseNodePatch({ chromeHidden: true }, 'note')).toThrow()
  })
  it('URL externa só http/https', () => {
    expect(parseExternalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(parseExternalUrl('http://localhost:5173/')).toBe('http://localhost:5173/')
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'about:blank', 'smb://host/x', 'não é url', 42]) {
      expect(() => parseExternalUrl(bad)).toThrow()
    }
  })
})

describe('schema: reparo dos campos novos ao abrir', () => {
  it('campo inválido sai com aviso; válido fica', () => {
    const warnings: string[] = []
    const raw = {
      id: 'w', name: 'W', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, floors: {}, activeFloor: null, connections: [], drawings: [],
      nodes: {
        n: { id: 'n', kind: 'note', name: 'N', content: '', floorId: null, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 }, color: 'roxo', fontSize: 14, locked: 'x', stackId: 'f-1' },
        p: { id: 'p', kind: 'portal', name: 'P', url: 'about:blank', floorId: null, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 }, chromeHidden: 'sim' }
      }
    }
    const fixed = validateWorkspace(raw, (w) => warnings.push(w))!
    expect(fixed.nodes.n).toMatchObject({ fontSize: 14, stackId: 'f-1' })
    expect((fixed.nodes.n as NoteNode).color).toBeUndefined()
    expect((fixed.nodes.n as NoteNode).locked).toBeUndefined()
    expect((fixed.nodes.p as unknown as Record<string, unknown>).chromeHidden).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/color/)
    expect(warnings.join(' ')).toMatch(/chromeHidden/)
  })
})

describe('fichário', () => {
  it('agrupar: um id de fichário novo e todas no frame da primeira (ordem da seleção)', () => {
    const w = ws([note('a', 100), note('b', 500), note('c', 900)])
    const patches = fileNotes(w, ['b', 'a'], 'f-novo')
    expect(patches).toEqual([
      { id: 'b', patch: { stackId: 'f-novo', pos: { x: 500, y: 100 }, size: { w: 260, h: 120 } } },
      { id: 'a', patch: { stackId: 'f-novo', pos: { x: 500, y: 100 }, size: { w: 260, h: 120 } } }
    ])
  })
  it('separar: tira do fichário e desloca para o lado, sem cair em cima', () => {
    const w = ws([note('a', 100, { stackId: 'f' }), note('b', 100, { stackId: 'f' })])
    expect(unfileNote(w, 'b')).toEqual({ id: 'b', patch: { stackId: null, pos: { x: 100 + 260 + 40, y: 100 } } })
  })
  it('vista: um card por fichário (frente = escolhida ou a primeira), abas com os nomes; notas soltas passam direto', () => {
    const w = ws([note('a', 100, { stackId: 'f' }), note('b', 100, { stackId: 'f' }), note('c', 600)])
    const v = stackView(Object.values(w.nodes), {})
    expect(v.hidden).toEqual(new Set(['b']))
    expect(v.tabs.get('a')).toEqual([{ id: 'a', name: 'A', active: true }, { id: 'b', name: 'B', active: false }])
    expect(v.tabs.has('c')).toBe(false)
    const front = stackView(Object.values(w.nodes), { f: 'b' })
    expect(front.hidden).toEqual(new Set(['a']))
    expect(front.tabs.get('b')?.find((t) => t.active)?.id).toBe('b')
  })
  it('fichário com uma nota só (as outras saíram) vira nota comum na vista', () => {
    const v = stackView([note('a', 100, { stackId: 'f' })], {})
    expect(v.hidden.size).toBe(0)
    expect(v.tabs.size).toBe(0)
  })
  it('barra: 2+ notas selecionadas oferecem "Colocar no fichário"', () => {
    const w = ws([note('a', 100), note('b', 500)])
    expect(barContent(w, new Set(['a', 'b']))).toEqual({ kind: 'notes', ids: ['a', 'b'] })
  })
})
