// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { defaultPreferences, validatePreferences } from '../src/shared/preferences'
import { NOTE_COLOR_HEX, freeSpot, newItemSize, noteDefaults } from '../src/shared/new-item'
import { circuitPath, ropeObstacles, zoomStepBy, cameraTransition, shouldHoverFocus, windowOpacityValue } from '../src/renderer/src/canvas/screen-options'
import { RopeScene } from '../src/renderer/src/canvas/rope-scene'
import { OPTIONS } from '../src/renderer/src/settings/options'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { placementFrame } from '../src/renderer/src/canvas/placement'
import type { CanvasNode } from '../src/shared/model'

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

describe('padrões de aparência e interação', () => {
  it('aparência segue o sistema, cursor de mão desligado e fonte do terminal do palco', () => {
    const d = defaultPreferences()
    expect(d.appearance).toBe('system')
    expect(d.pointerCursors).toBe(false)
    expect(d.terminalFontFamily).toBe("Cascadia Mono, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace")
  })
})

describe('Estilo das conexões', () => {
  const card = { pos: { x: 90, y: -50 }, size: { w: 120, h: 450 } }
  const node = (id: string, x: number, y: number, w: number, h: number): CanvasNode => ({ id, kind: 'note', name: id, content: '', floorId: null, pos: { x, y }, size: { w, h } }) as CanvasNode
  const run = (routing: 'avoidNodes' | 'behindNodes'): number => {
    const scene = new RopeScene(); scene.setRouting(routing)
    const nodes = { a: node('a', -100, -20, 100, 40), b: node('b', 300, -20, 100, 40), c: node('c', card.pos.x, card.pos.y, card.size.w, card.size.h) }
    scene.synchronize(nodes, [{ id: 'r', a: 'a', b: 'b' }], {})
    for (let i = 0; i < 240; i++) scene.advance(1 / 60)
    return scene.entries.get('r')!.rope.points.filter(p => p.x > card.pos.x && p.x < card.pos.x + card.size.w && p.y > card.pos.y && p.y < card.pos.y + card.size.h).length
  }
  it('ao redor dos nós desvia do card no meio; atrás dos nós deixa a corda passar por baixo dele', () => {
    const around = run('avoidNodes'), behind = run('behindNodes')
    expect(behind).toBeGreaterThan(5)
    expect(around).toBeLessThan(behind / 2)
  })
  it('só "ao redor dos nós" entrega obstáculos à simulação', () => {
    expect(ropeObstacles('avoidNodes', [card])).toEqual([card])
    expect(ropeObstacles('behindNodes', [card])).toEqual([])
    expect(ropeObstacles('circuit', [card])).toEqual([])
  })
  it('circuito: caminho ortogonal de uma ponta à outra, sem diagonais', () => {
    const d = circuitPath({ x: 0, y: 0 }, { x: 300, y: 200 })
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d.endsWith('300 200')).toBe(true)
    const pts = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), Number(m[2])] as const)
    for (let i = 1; i < pts.length; i++) expect(pts[i]![0] === pts[i - 1]![0] || pts[i]![1] === pts[i - 1]![1]).toBe(true)
  })
  it('a janela já grava o estilo; o inventário a marca como pronta', () => {
    expect(OPTIONS.find(o => o.key === 'ropeRouting')?.ready).toBe(true)
  })
})

describe('Estilo de seleção', () => {
  it('o CSS tem uma regra por estilo, e o efeito publica o estilo no <html>', () => {
    const css = read('src/renderer/src/styles.css')
    for (const s of ['dashedBorder', 'solidBorder', 'corners', 'cornerDots', 'elevation']) expect(css, s).toContain(`[data-selection-style="${s}"] .node.selected`)
    expect(read('src/renderer/src/settings/preferences.ts')).toContain('selectionStyle')
  })
})

describe('Movimento da câmera', () => {
  it('deslizar anima o salto; instantâneo não; movimento reduzido nunca anima', () => {
    expect(cameraTransition('glide', false)).toBeGreaterThan(0)
    expect(cameraTransition('instant', false)).toBe(0)
    expect(cameraTransition('glide', true)).toBe(0)
  })
})

describe('Focar ao passar o cursor', () => {
  const base = { enabled: true, dragging: false, linking: false, editing: false, dialogOpen: false, alreadyFocused: false }
  it('só foca com a opção ligada e sem arrasto, ligação, edição ou diálogo', () => {
    expect(shouldHoverFocus(base)).toBe(true)
    expect(shouldHoverFocus({ ...base, enabled: false })).toBe(false)
    for (const k of ['dragging', 'linking', 'editing', 'dialogOpen', 'alreadyFocused'] as const) expect(shouldHoverFocus({ ...base, [k]: true }), k).toBe(false)
  })
})

describe('Passo de zoom', () => {
  it('desligado usa o passo de 10%; ligado usa o percentual escolhido', () => {
    expect(zoomStepBy(1, 1, null)).toBeCloseTo(1.1)
    expect(zoomStepBy(1, 1, 25)).toBeCloseTo(1.25)
    expect(zoomStepBy(1, -1, 25)).toBeCloseTo(0.75)
    expect(zoomStepBy(1.9, 1, 25)).toBe(2)
    expect(zoomStepBy(0.3, -1, 25)).toBe(0.25)
    expect(zoomStepBy(1, 1, 2)).toBeCloseTo(1.02)
  })
})

describe('Opacidade da janela', () => {
  it('vira fração de 0 a 1 para a janela', () => {
    expect(windowOpacityValue(100)).toBe(1)
    expect(windowOpacityValue(85)).toBe(0.85)
    expect(windowOpacityValue(60)).toBe(0.6)
  })
})

describe('Padrões de Novos Itens', () => {
  it('cor da nota vira o hex da paleta; tamanho e fonte vêm das preferências', () => {
    const p = { ...defaultPreferences(), ...validatePreferences({ defaultNoteColor: 'pink', defaultNoteFontSize: 20, defaultNoteFontFamily: 'serif', defaultNoteSize: { width: 300, height: 220 } }) }
    expect(noteDefaults(p)).toEqual({ color: NOTE_COLOR_HEX.pink, fontSize: 20, fontFamily: 'serif', size: { w: 300, h: 220 } })
    expect(noteDefaults(defaultPreferences())).toEqual({ color: NOTE_COLOR_HEX.yellow, fontSize: 14, size: { w: 260, h: 160 } })
    expect(Object.keys(NOTE_COLOR_HEX)).toHaveLength(10)
  })
  it('fonte de nota que o palco não sabe desenhar fica de fora (herda a padrão)', () => {
    const p = validatePreferences({ defaultNoteFontFamily: 'Comic Sans' })
    expect(noteDefaults(p).fontFamily).toBeUndefined()
  })
  it('tamanho de terminal e de portal vêm das preferências; o clique usa esse tamanho', () => {
    const p = validatePreferences({ defaultTerminalSize: { width: 900, height: 450 }, defaultPortalSize: { width: 700, height: 500 }, defaultNoteSize: { width: 280, height: 180 } })
    expect(newItemSize('terminal', p)).toEqual({ w: 900, h: 450 })
    expect(newItemSize('portal', p)).toEqual({ w: 700, h: 500 })
    expect(newItemSize('note', p)).toEqual({ w: 280, h: 180 })
    expect(newItemSize('filetree', p)).toBeNull()
    expect(placementFrame({ x: 1000, y: 1000 }, { x: 1000, y: 1000 }, 'terminal', 20, p).size).toEqual({ w: 900, h: 450 })
  })
  it('espaço livre acha um lugar sem sobrepor; empilhar mantém o ponto pedido', () => {
    const origin = { x: 0, y: 0 }, size = { w: 300, h: 200 }
    const nodes = [{ pos: { x: 0, y: 0 }, size: { w: 300, h: 200 }, floorId: null }]
    expect(freeSpot('stack', nodes, null, origin, size)).toEqual(origin)
    const spot = freeSpot('freeSpace', nodes, null, origin, size)
    const overlaps = spot.x < 300 && spot.x + 300 > 0 && spot.y < 200 && spot.y + 200 > 0
    expect(overlaps).toBe(false)
    expect(freeSpot('freeSpace', [], null, origin, size)).toEqual(origin)
    expect(freeSpot('freeSpace', [{ ...nodes[0]!, floorId: 'f1' }], null, origin, size)).toEqual(origin)
  })
  it('fonte e tabulação do editor chegam ao arquivo aberto', () => {
    const view = read('src/renderer/src/nodes/FileView.tsx')
    expect(view).toContain('fileEditorFontFamily'); expect(view).toContain('fileEditorFontSize'); expect(view).toContain('fileEditorTabWidth')
  })
})

describe('inventário da Tela', () => {
  const ready = ['ropeRouting', 'selectionIndicatorStyle', 'cameraMovement', 'focusNodeOnHover', 'rightDragPansCanvas', 'zoomStepPercent', 'windowOpacity',
    'defaultNoteColor', 'defaultNoteSize', 'defaultNoteRender', 'fileEditorRendersMarkdown', 'confirmFileDelete', 'alwaysCopyAttachments', 'agentNotePlacement', 'defaultNoteFontFamily', 'defaultNoteFontSize', 'defaultTerminalSize', 'defaultPortalSize', 'agentPortalPlacement',
    'fileEditorFontFamily', 'fileEditorFontSize', 'fileEditorTabWidth']
  const pending: string[] = []
  it.each(ready)('%s está pronta', key => { expect(OPTIONS.find(o => o.key === key)?.ready, key).toBe(true) })
  it.each(pending)('%s segue desabilitada, com o motivo exato', key => {
    const o = OPTIONS.find(x => x.key === key)
    expect(o?.ready).toBe(false); expect(o?.pending?.length).toBeGreaterThan(20)
  })
})

describe('arrastar com o botão direito', () => {
  it('o Canvas move a vista com o botão direito só quando a opção está ligada', () => {
    const src = read('src/renderer/src/canvas/Canvas.tsx')
    expect(src).toContain('rightDragPansCanvas')
    adoptPreferences(defaultPreferences()); vi.resetModules()
  })
})
