import { describe, expect, it } from 'vitest'
import { parseCamera, parseData, parseDims, parseId, parseNewNode, parseNodePatch } from '../../src/main/validate'

const term = { kind: 'terminal', floorId: null, name: 'T', agent: 'shell', command: '', cwd: '', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }
const note = { kind: 'note', floorId: null, name: 'N', content: 'x', pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } }

describe('validate', () => {
  it('parseId aceita string curta e recusa o resto', () => {
    expect(parseId('abc')).toBe('abc')
    for (const bad of [undefined, null, 1, '', {}, 'x'.repeat(201)]) expect(() => parseId(bad)).toThrow()
  })

  it('parseNewNode aceita terminal e nota válidos', () => {
    expect(parseNewNode(term)).toEqual(term)
    expect(parseNewNode(note)).toEqual(note)
  })

  it('parseNewNode sem floorId (renderer antigo) vai para o Ground', () => {
    const { floorId: _, ...semFloor } = term
    expect(parseNewNode(semFloor)).toEqual(term)
  })

  it('parseNewNode recusa estruturas inválidas', () => {
    const bad: unknown[] = [
      null, 'x', [], {},
      { ...term, kind: 'outro' },
      { ...term, agent: 'bash' },
      { ...term, name: '' },
      { ...term, name: 'n'.repeat(201) },
      { ...term, command: 'c'.repeat(5000) },
      { ...term, pos: null },
      { ...term, pos: { x: NaN, y: 0 } },
      { ...term, pos: { x: 1e9, y: 0 } },
      { ...term, size: { w: 0, h: 10 } },
      { ...term, size: { w: Infinity, h: 10 } },
      { ...note, content: 'x'.repeat(1_000_001) },
      { ...note, content: 5 }
    ]
    for (const b of bad) expect(() => parseNewNode(b), JSON.stringify(b)).toThrow()
  })

  it('parseNewNode descarta campos extras (inclusive id)', () => {
    const parsed = parseNewNode({ ...term, id: 'forjado', extra: 1 }) as unknown as Record<string, unknown>
    expect(parsed.id).toBeUndefined()
    expect(parsed.extra).toBeUndefined()
  })

  it('parseNodePatch só permite name/pos/size e content em nota', () => {
    expect(parseNodePatch({ name: 'x', pos: { x: 1, y: 2 } }, 'terminal')).toEqual({ name: 'x', pos: { x: 1, y: 2 } })
    expect(parseNodePatch({ content: 'novo' }, 'note')).toEqual({ content: 'novo' })
    expect(() => parseNodePatch({ content: 'x' }, 'terminal')).toThrow()
    expect(() => parseNodePatch({ command: 'rm -rf /' }, 'terminal')).toThrow()
    expect(() => parseNodePatch({ agent: 'claude' }, 'terminal')).toThrow()
    expect(() => parseNodePatch({ size: { w: -1, h: 5 } }, 'note')).toThrow()
    expect(() => parseNodePatch('x', 'note')).toThrow()
  })

  it('parseCamera exige números finitos e zoom entre 0.25 e 2', () => {
    const ok = { offset: { x: 10, y: -5 }, zoom: 1.5 }
    expect(parseCamera(ok)).toEqual(ok)
    for (const zoom of [0, 0.2, 2.1, NaN, Infinity, '1']) expect(() => parseCamera({ ...ok, zoom })).toThrow()
    expect(() => parseCamera({ offset: { x: NaN, y: 0 }, zoom: 1 })).toThrow()
    expect(() => parseCamera({ zoom: 1 })).toThrow()
    expect(() => parseCamera(null)).toThrow()
  })

  it('parseDims exige inteiros entre 2 e 500', () => {
    expect(parseDims(80, 24)).toEqual({ cols: 80, rows: 24 })
    expect(parseDims(2, 500)).toEqual({ cols: 2, rows: 500 })
    for (const [c, r] of [[NaN, 32], [80, Infinity], [1, 24], [501, 24], [80.5, 24], ['80', 24], [80, null]]) {
      expect(() => parseDims(c, r)).toThrow()
    }
  })

  it('parseData aceita texto até 1 MB', () => {
    expect(parseData('ls\r')).toBe('ls\r')
    expect(() => parseData(5)).toThrow()
    expect(() => parseData('x'.repeat(1_000_001))).toThrow()
  })
})
