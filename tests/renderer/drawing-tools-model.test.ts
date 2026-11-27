import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Vec } from '../../src/shared/model'
import {
  clampWidth, DRAW_PALETTE, DRAW_TOOLS, gesturePoints, isAreaShape, keepsDrawing, PATTERN_DASH, SHAPES, WIDTH_MAX, WIDTH_MIN
} from '../../src/renderer/src/canvas/draw/tools'
import { drawingGeometry } from '../../src/renderer/src/canvas/draw/geometry'
import { recognize } from '../../src/renderer/src/canvas/draw/recognize'
import { drawKeyAction } from '../../src/renderer/src/canvas/draw/keys'
import { DrawToolbar } from '../../src/renderer/src/canvas/draw/DrawToolbar'
import { parseDrawing } from '../../src/main/validate'
import { validateWorkspace } from '../../src/main/domain/workspace-schema'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'

const pt = (x: number, y: number): Vec => ({ x, y })
const circle = (cx: number, cy: number, rx: number, ry: number, n = 48): Vec[] =>
  Array.from({ length: n + 1 }, (_, i) => pt(cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)))
const segment = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n }, (_, i) => pt(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n))

describe('ferramentas e estilo', () => {
  it('ordem da barra e formas', () => {
    expect(DRAW_TOOLS).toEqual(['pen', 'brush', 'smart', 'arrow', 'highlighter', 'line'])
    expect(SHAPES.slice(0, 6)).toEqual(['rect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star'])
    expect(isAreaShape('rect')).toBe(true)
    expect(isAreaShape('line')).toBe(false)
    expect(keepsDrawing('pen') && keepsDrawing('brush') && keepsDrawing('highlighter') && keepsDrawing('smart')).toBe(true)
    expect(keepsDrawing('rect')).toBe(false)
  })

  it('paleta de 12 cores começando no preto, vermelho #FF3B30 incluso; espessura 1 a 24', () => {
    expect(DRAW_PALETTE).toHaveLength(12)
    expect(DRAW_PALETTE[0]).toBe('#000000')
    expect(DRAW_PALETTE).toContain('#FF3B30')
    expect([WIDTH_MIN, WIDTH_MAX]).toEqual([1, 24])
    expect(clampWidth(0)).toBe(1)
    expect(clampWidth(30)).toBe(24)
    expect(clampWidth(3.6)).toBe(4)
    expect(PATTERN_DASH).toEqual({ solid: [], dashed: [14, 8], dotted: [2, 6] })
  })
})

describe('pontos do gesto em coordenadas do mundo', () => {
  const raw = [pt(0, 0), pt(5, 1), pt(10, 4), pt(30, 10)]
  it('caneta, pincel, marca-texto e inteligente guardam o traço livre', () => {
    for (const t of ['pen', 'brush', 'highlighter', 'smart'] as const) expect(gesturePoints(t, raw, false)).toEqual(raw)
  })
  it('linha, seta e formas guardam o primeiro e o último ponto', () => {
    for (const t of ['line', 'arrow', 'rect', 'ellipse'] as const) expect(gesturePoints(t, raw, false)).toEqual([pt(0, 0), pt(30, 10)])
  })
  it('Shift: linha/seta em passos de 45°, forma com lados iguais', () => {
    const [, end] = gesturePoints('line', [pt(0, 0), pt(100, 10)], true)
    expect(end!.y).toBeCloseTo(0)
    expect(end!.x).toBeCloseTo(Math.hypot(100, 10))
    const [, diag] = gesturePoints('arrow', [pt(0, 0), pt(100, 90)], true)
    expect(diag!.x).toBeCloseTo(diag!.y)
    expect(gesturePoints('rect', [pt(0, 0), pt(100, -40)], true)).toEqual([pt(0, 0), pt(100, -100)])
  })
})

describe('geometria SVG de cada ferramenta', () => {
  const base = { id: 'd', floorId: null, color: '#FF3B30', width: 3 }
  it('caneta: traço sem preenchimento, pontas redondas, padrão do traço', () => {
    const g = drawingGeometry({ ...base, points: [pt(0, 0), pt(10, 10), pt(20, 0)], pattern: 'dashed' })
    expect(g.fill).toBe('none')
    expect(g.strokeWidth).toBe(3)
    expect(g.dash).toBe('14 8')
    expect(g.opacity).toBe(1)
    expect(g.d.startsWith('M 0 0')).toBe(true)
  })
  it('pincel: contorno preenchido com a cor, sem traço nem padrão', () => {
    const g = drawingGeometry({ ...base, tool: 'brush', points: [pt(0, 0), pt(10, 0), pt(20, 0)], pattern: 'dotted' })
    expect(g.fill).toBe('#FF3B30')
    expect(g.strokeWidth).toBe(0)
    expect(g.dash).toBeUndefined()
    expect(g.d.endsWith('Z')).toBe(true)
  })
  it('marca-texto: 4× a espessura e opacidade 0,3', () => {
    const g = drawingGeometry({ ...base, tool: 'highlighter', points: [pt(0, 0), pt(10, 0)] })
    expect(g.strokeWidth).toBe(12)
    expect(g.opacity).toBe(0.3)
  })
  it('linha e seta: segmento; a seta tem cabeça', () => {
    expect(drawingGeometry({ ...base, tool: 'line', points: [pt(0, 0), pt(100, 0)] }).d).toBe('M 0 0 L 100 0')
    const arrow = drawingGeometry({ ...base, tool: 'arrow', points: [pt(0, 0), pt(100, 0)] }).d
    expect(arrow.startsWith('M 0 0 L 100 0')).toBe(true)
    expect(arrow.match(/M /g)).toHaveLength(2)
  })
  it('formas: caixa pelos dois cantos, sem preenchimento', () => {
    const rect = drawingGeometry({ ...base, tool: 'rect', points: [pt(10, 20), pt(0, 0)] })
    expect(rect.d).toBe('M 0 0 L 10 0 L 10 20 L 0 20 Z')
    expect(rect.fill).toBe('none')
    expect(drawingGeometry({ ...base, tool: 'ellipse', points: [pt(0, 0), pt(20, 10)] }).d).toContain('A 10 5')
    for (const s of ['triangle', 'diamond', 'hexagon', 'star'] as const) expect(drawingGeometry({ ...base, tool: s, points: [pt(0, 0), pt(40, 40)] }).d.endsWith('Z')).toBe(true)
  })
  it('desenho antigo (sem ferramenta) é caneta sólida', () => {
    const g = drawingGeometry({ ...base, points: [pt(0, 0), pt(5, 5)] })
    expect(g.fill).toBe('none')
    expect(g.dash).toBeUndefined()
  })
})

describe('desenho inteligente (reconhecimento próprio)', () => {
  it('reta → linha', () => {
    expect(recognize(segment(pt(0, 0), pt(200, 50)))).toEqual({ tool: 'line', points: [pt(0, 0), pt(200 * 19 / 20, 50 * 19 / 20)] })
  })
  it('reta com gancho no fim → seta', () => {
    const shaft = segment(pt(0, 0), pt(200, 0), 30)
    const hook = [pt(200, 0), pt(185, -12), pt(178, -18), pt(200, 0), pt(186, 13), pt(180, 18)]
    const r = recognize([...shaft, ...hook])
    expect(r?.tool).toBe('arrow')
    expect(r?.points[0]).toEqual(pt(0, 0))
    expect(r?.points[1]!.x).toBeCloseTo(200, 0)
  })
  it('contorno fechado redondo → elipse; com cantos → retângulo', () => {
    expect(recognize(circle(100, 100, 80, 40))?.tool).toBe('ellipse')
    const box = [...segment(pt(0, 0), pt(150, 0)), ...segment(pt(150, 0), pt(150, 100)), ...segment(pt(150, 100), pt(0, 100)), ...segment(pt(0, 100), pt(0, 2)), pt(0, 2)]
    const r = recognize(box)
    expect(r?.tool).toBe('rect')
    expect(r?.points).toEqual([pt(0, 0), pt(150, 100)])
  })
  it('rabisco → null (cai para a caneta)', () => {
    const scribble = [pt(0, 0), pt(40, 30), pt(5, 60), pt(70, 10), pt(20, 90), pt(90, 70), pt(60, 0), pt(100, 100)]
    expect(recognize(scribble)).toBeNull()
    expect(recognize([pt(0, 0)])).toBeNull()
  })
})

describe('atalhos do desenho', () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}, target: Partial<HTMLElement> = { tagName: 'DIV' }) =>
    ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra, target: { closest: () => null, isContentEditable: false, ...target } }) as unknown as KeyboardEvent
  it('b arma o retângulo só sem seleção; colchetes mudam a espessura; Escape cancela o gesto ou sai', () => {
    expect(drawKeyAction(key('b'), { drawing: false, gesture: false, hasSelection: false })).toEqual({ kind: 'arm-rect' })
    expect(drawKeyAction(key('b'), { drawing: false, gesture: false, hasSelection: true })).toBeNull()
    expect(drawKeyAction(key('b', { ctrlKey: true }), { drawing: false, gesture: false, hasSelection: false })).toBeNull()
    expect(drawKeyAction(key('['), { drawing: true, gesture: false, hasSelection: false })).toEqual({ kind: 'width', delta: -1 })
    expect(drawKeyAction(key(']'), { drawing: true, gesture: false, hasSelection: false })).toEqual({ kind: 'width', delta: 1 })
    expect(drawKeyAction(key('Escape'), { drawing: true, gesture: true, hasSelection: false })).toEqual({ kind: 'cancel-gesture' })
    expect(drawKeyAction(key('Escape'), { drawing: true, gesture: false, hasSelection: false })).toEqual({ kind: 'exit' })
    expect(drawKeyAction(key('Escape'), { drawing: false, gesture: false, hasSelection: false })).toBeNull()
  })
  it('tecla já tratada (ex.: o Escape que cancelou o arrasto) não faz mais nada', () => {
    const e = { ...key('Escape'), defaultPrevented: true } as KeyboardEvent
    expect(drawKeyAction(e, { drawing: true, gesture: false, hasSelection: false })).toBeNull()
  })
  it('campo de texto, terminal e portal ficam com as teclas deles', () => {
    const state = { drawing: true, gesture: false, hasSelection: false }
    expect(drawKeyAction(key(']', {}, { tagName: 'INPUT' }), state)).toBeNull()
    expect(drawKeyAction(key(']', {}, { tagName: 'TEXTAREA' }), state)).toBeNull()
    expect(drawKeyAction(key(']', {}, { tagName: 'DIV', isContentEditable: true }), state)).toBeNull()
    expect(drawKeyAction(key(']', {}, { tagName: 'DIV', closest: ((s: string) => (s.includes('.xterm') ? {} : null)) as never }), state)).toBeNull()
    expect(drawKeyAction(key('b', {}, { tagName: 'WEBVIEW' }), { ...state, drawing: false })).toBeNull()
  })
})

describe('persistência', () => {
  const base = { floorId: null, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#FF3B30', width: 3 }
  it('o main aceita ferramenta e padrão válidos e recusa os outros', () => {
    expect(parseDrawing({ ...base, tool: 'arrow', pattern: 'dotted' })).toEqual({ ...base, tool: 'arrow', pattern: 'dotted' })
    expect(parseDrawing(base)).toEqual(base)
    expect(() => parseDrawing({ ...base, tool: 'laser' })).toThrow()
    expect(() => parseDrawing({ ...base, pattern: 'zigzag' })).toThrow()
  })
  it('o schema tira ferramenta ou padrão desconhecidos de um arquivo antigo sem perder o traço', () => {
    const ws = validateWorkspace({ id: 'w', name: 'W', nodes: {}, connections: [], camera: { offset: { x: 0, y: 0 }, zoom: 1 }, floors: {}, activeFloor: null,
      drawings: [{ id: 'a', ...base, tool: 'laser', pattern: 'x' }, { id: 'b', ...base, tool: 'star', pattern: 'dashed' }] }, () => {})
    expect(ws.drawings).toEqual([{ id: 'a', ...base }, { id: 'b', ...base, tool: 'star', pattern: 'dashed' }])
  })
  it('o store grava e relê ferramenta e padrão', () => {
    const dir = mkdtempSync(join(tmpdir(), 'palco-draw-'))
    try {
      const store = new WorkspaceStore(join(dir, 'ws.json'))
      const id = store.addDrawing({ ...base, tool: 'hexagon', pattern: 'dashed' })
      store.flush(); store.dispose()
      const again = new WorkspaceStore(join(dir, 'ws.json'))
      expect(again.get().drawings?.find((d) => d.id === id)).toMatchObject({ tool: 'hexagon', pattern: 'dashed' })
      again.dispose()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('barra de desenho', () => {
  it('sete ferramentas, cor, − N pt + e estilo do traço', () => {
    const html = renderToStaticMarkup(createElement(DrawToolbar, {
      style: { tool: 'smart', shape: 'rect', color: '#FF3B30', width: 3, pattern: 'solid', fill: 'none', radius: 6 }, onStyle: () => {}
    }))
    for (const label of ['Caneta', 'Pincel', 'Desenho inteligente', 'Seta', 'Marca-texto', 'Linha', 'Formas', 'Cor', 'Diminuir espessura', 'Aumentar espessura', 'Estilo do traço']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html).toMatch(/aria-label="Desenho inteligente"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Desenho inteligente"/)
    expect(html).toContain('3pt')
  })
  it('limites: − desabilitado em 1, + desabilitado em 24', () => {
    const at = (width: number) => renderToStaticMarkup(createElement(DrawToolbar, { style: { tool: 'pen', shape: 'rect', color: '#000000', width, pattern: 'solid', fill: 'none', radius: 6 }, onStyle: () => {} }))
    expect(at(1)).toMatch(/<button[^>]*aria-label="Diminuir espessura"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Diminuir espessura"/)
    expect(at(24)).toMatch(/<button[^>]*aria-label="Aumentar espessura"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Aumentar espessura"/)
  })
})

describe("histórico do traço", () => {
  it('cada traço confirmado é uma transação: um commit com um drawing.add', async () => {
    const { commitDrawing } = await import('../../src/renderer/src/canvas/draw/commit')
    const calls: unknown[] = []
    const api = { commit: async (ws: string, ops: unknown[]) => { calls.push([ws, ops]); return ['id-1'] } }
    const drawing = { floorId: null, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#000000', width: 3, tool: 'line' as const }
    await expect(commitDrawing(api, 'w1', drawing)).resolves.toBe('id-1')
    expect(calls).toEqual([['w1', [{ type: 'drawing.add', drawing }]]])
  })
})

import { shapeOutline, snapToShapes, nearestOnPolyline } from '../../src/renderer/src/canvas/draw/geometry'
import { TOOL_LABEL, DEFAULT_DRAW_STYLE } from '../../src/renderer/src/canvas/draw/tools'

describe("formas extras, preenchimento, raio e seta curva", () => {
  const box = (tool: string, extra: Record<string, unknown> = {}) => drawingGeometry({ floorId: null, color: '#FF3B30', width: 3, tool, points: [pt(0, 0), pt(100, 60)], ...extra } as never)
  it('o seletor de formas tem as 16 formas do palco, todas com área e rótulo', () => {
    expect([...SHAPES]).toEqual(['rect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'oval', 'parallelogram', 'cloud', 'heart', 'boxX', 'checkbox', 'arrowLeft', 'arrowUp', 'arrowDown', 'arrowRight'])
    for (const s of SHAPES) { expect(isAreaShape(s)).toBe(true); expect(TOOL_LABEL[s]).toBeTruthy() }
    expect(DEFAULT_DRAW_STYLE).toMatchObject({ fill: 'none', radius: 6 })
  })
  it('toda forma vira um caminho fechado não vazio dentro da caixa', () => {
    for (const s of SHAPES) { const g = box(s); expect(g.d.length).toBeGreaterThan(10); expect(g.d).toMatch(/Z\s*$/); expect(g.d).not.toContain('NaN') }
  })
  it('preenchimento: nenhum, tom (cor a 20%), sólido e hachuras (padrão por cor)', () => {
    expect(box('rect').fill).toBe('none')
    expect(box('rect', { fill: 'solid' })).toMatchObject({ fill: '#FF3B30' })
    expect(box('rect', { fill: 'tint' })).toMatchObject({ fill: '#FF3B30', fillOpacity: 0.2 })
    expect(box('rect', { fill: 'hatch' })).toMatchObject({ fill: 'none', hatch: 'hatch' })
    expect(box('rect', { fill: 'cross' })).toMatchObject({ hatch: 'cross' })
  })
  it('raio: o retângulo arredonda os cantos (limitado à metade do menor lado; 0 ou ausente = reto, como os desenhos antigos)', () => {
    expect(box('rect', { radius: 6 }).d).toContain('A 6 6'); expect(box('rect', { radius: 0 }).d).not.toContain('A '); expect(box('rect').d).not.toContain('A ')
    expect(box('rect', { radius: 999 }).d).toContain('A 30 30')
  })
  it('seta curva: com ponto de controle vira curva quadrática e a cabeça segue a tangente; sem ele continua reta', () => {
    const reta = drawingGeometry({ floorId: null, color: '#000', width: 3, tool: 'arrow', points: [pt(0, 0), pt(100, 0)] })
    expect(reta.d).not.toContain('Q')
    const curva = drawingGeometry({ floorId: null, color: '#000', width: 3, tool: 'arrow', points: [pt(0, 0), pt(100, 0)], control: pt(50, 80) })
    expect(curva.d.startsWith('M 0 0 Q 50 80 100 0')).toBe(true)
  })
  it('caixa X e checkbox têm o detalhe (X e visto) como traço à parte', () => { expect(box('boxX').detail).toContain('L'); expect(box('checkbox').detail).toContain('L'); expect(box('rect').detail).toBeUndefined() })
  it('encaixe: a ponta de linha/seta perto da borda de uma forma gruda nela; longe, não mexe', () => {
    const rect = { id: 'r', floorId: null, color: '#000', width: 3, tool: 'rect', points: [pt(100, 100), pt(200, 200)] } as never
    expect(snapToShapes(pt(150, 94), [rect], 12)).toEqual(pt(150, 100))
    expect(snapToShapes(pt(96, 150), [rect], 12)).toEqual(pt(100, 150))
    expect(snapToShapes(pt(150, 150), [rect], 12)).toEqual(pt(150, 150))
    expect(snapToShapes(pt(50, 50), [rect], 12)).toEqual(pt(50, 50))
  })
  it('contorno: elipse amostrada passa pelas quatro pontas; ponto mais próximo numa polilinha', () => {
    const o = shapeOutline('ellipse', [pt(0, 0), pt(100, 60)]); expect(o.length).toBeGreaterThan(24)
    expect(Math.max(...o.map(p => p.x))).toBeCloseTo(100); expect(Math.min(...o.map(p => p.y))).toBeCloseTo(0)
    expect(nearestOnPolyline(pt(5, 5), [pt(0, 0), pt(10, 0)])).toEqual({ point: pt(5, 0), distance: 5 })
  })
})
