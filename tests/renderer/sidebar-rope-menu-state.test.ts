import { readSidebarHidden, writeSidebarHidden, SIDEBAR_HIDDEN_KEY } from '../../src/renderer/src/sidebar/sidebar-layout'
import { isConnectShortcut, isPartiturasShortcut } from '../../src/renderer/src/shortcuts'
import { viewOnAdopt } from '../../src/renderer/src/focus'
import type { CanvasNode, Workspace } from '../../src/shared/model'

/** Storage em memória (o mesmo contrato do localStorage). */
function memory(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k)
  }
}

describe('barra lateral oculta persiste', () => {
  it('padrão visível; grava e relê; valor estranho conta como visível', () => {
    const s = memory()
    expect(readSidebarHidden(s)).toBe(false)
    writeSidebarHidden(s, true)
    expect(s.getItem(SIDEBAR_HIDDEN_KEY)).toBe('1')
    expect(readSidebarHidden(s)).toBe(true)
    writeSidebarHidden(s, false)
    expect(readSidebarHidden(s)).toBe(false)
    s.setItem(SIDEBAR_HIDDEN_KEY, 'talvez')
    expect(readSidebarHidden(s)).toBe(false)
  })
  it('storage que lança (modo privado, cota) não derruba', () => {
    const broken = { ...memory(), getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } } as Storage
    expect(readSidebarHidden(broken)).toBe(false)
    expect(() => writeSidebarHidden(broken, true)).not.toThrow()
  })
})

describe('atalhos: escopo explícito', () => {
  const key = (over: Partial<KeyboardEvent>): KeyboardEvent => ({ key: 'l', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over }) as KeyboardEvent
  it('Ctrl+Shift+L (ou Cmd) é Partituras, inclusive com o foco no terminal', () => {
    expect(isPartiturasShortcut(key({ key: 'L', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isPartiturasShortcut(key({ key: 'l', metaKey: true, shiftKey: true }))).toBe(true)
    expect(isPartiturasShortcut(key({ key: 'L', ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false)
    expect(isPartiturasShortcut(key({ key: 'l', ctrlKey: true }))).toBe(false)
  })
  it('Ctrl+L é Conectar só fora do terminal (no shell é limpar a tela)', () => {
    expect(isConnectShortcut(key({ key: 'l', ctrlKey: true }))).toBe(true)
    expect(isConnectShortcut(key({ key: 'L', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isConnectShortcut(key({ key: 'k', ctrlKey: true }))).toBe(false)
  })
})

describe('focar conexão em outro andar', () => {
  const term = (id: string, floorId: string | null, x: number): CanvasNode =>
    ({ id, kind: 'terminal', name: id, agent: 'shell', command: '', cwd: '/', floorId, pos: { x, y: 100 }, size: { w: 400, h: 200 } }) as CanvasNode
  const ws = (activeFloor: string | null): Workspace => ({
    id: 'w', name: 'W', connections: [], activeFloor,
    nodes: { a: term('a', null, 0), z: term('z', 'f1', 5000) },
    camera: { offset: { x: 0, y: 0 }, zoom: 1 },
    floors: { f1: { id: 'f1', name: 'ui', branch: 'palco/ui', worktree: '/x', createdAt: 1, camera: { offset: { x: 10, y: 20 }, zoom: 2 } } }
  }) as unknown as Workspace

  it('sem foco pendente: câmera salva do andar e seleção vazia', () => {
    expect(viewOnAdopt(ws('f1'), null, { w: 1000, h: 800 })).toEqual({ camera: { offset: { x: 10, y: 20 }, zoom: 2 }, selection: [] })
  })
  it('foco pendente no andar que chegou: centraliza o alvo (fora da câmera salva) e o seleciona', () => {
    const v = viewOnAdopt(ws('f1'), 'z', { w: 1000, h: 800 })
    expect(v.selection).toEqual(['z'])
    expect(v.camera.zoom).toBe(2)
    // Centro do nó (5200, 200) × 2 no meio da tela.
    expect(v.camera.offset).toEqual({ x: 500 - 5200 * 2, y: 400 - 200 * 2 })
  })
  it('foco pendente de outro andar (troca ainda não chegou ou foi recusada) não muda nada além do padrão', () => {
    expect(viewOnAdopt(ws(null), 'z', { w: 1000, h: 800 })).toEqual({ camera: { offset: { x: 0, y: 0 }, zoom: 1 }, selection: [] })
  })
})
