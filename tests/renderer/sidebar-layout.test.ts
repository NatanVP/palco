import { clampSidebarWidth, filterWorkspaces, countLabel } from '../../src/renderer/src/sidebar/sidebar-layout'

describe('sidebar-layout', () => {
  it('largura entre 200 e 480; valor inválido volta ao padrão 260', () => {
    expect(clampSidebarWidth(100)).toBe(200)
    expect(clampSidebarWidth(300.4)).toBe(300)
    expect(clampSidebarWidth(999)).toBe(480)
    expect(clampSidebarWidth(Number.NaN)).toBe(260)
  })

  it('filtro ignora caixa e acentos', () => {
    const ws = [{ id: 'a', name: 'Loja Ação', spaceId: null }, { id: 'b', name: 'Pesquisa', spaceId: null }]
    expect(filterWorkspaces(ws, 'acao').map((w) => w.id)).toEqual(['a'])
    expect(filterWorkspaces(ws, '  ').map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('contador mostra 99+ acima de 99 e nada com zero', () => {
    expect(countLabel(0)).toBe('')
    expect(countLabel(7)).toBe('7')
    expect(countLabel(140)).toBe('99+')
  })
})

describe('registry.sidebar conta terminais por workspace', () => {
  it('preenche terminals em cada WorkspaceMeta', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs'), { join } = await import('node:path'), { tmpdir } = await import('node:os')
    const { WorkspaceRegistry } = await import('../../src/main/domain/workspace-registry')
    const dir = mkdtempSync(join(tmpdir(), 'palco-sb-'))
    try {
      const reg = new WorkspaceRegistry(join(dir, 'workspaces'))
      const store = reg.active()
      store.addNode({ kind: 'terminal', floorId: null, name: 'A', agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
      store.addNode({ kind: 'note', floorId: null, name: 'N', content: '', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
      expect(reg.sidebar().workspaces.find((w) => w.id === reg.activeId())?.terminals).toBe(1)
      reg.flushAll()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('dropIndex', () => {
  it('calcula a posição na lista completa do grupo, mesmo com o filtro escondendo itens', async () => {
    const { dropIndex } = await import('../../src/renderer/src/sidebar/sidebar-layout')
    // grupo completo: a, x, b, y, c (x e y escondidos pelo filtro); arrasta c para depois de a
    expect(dropIndex(['a', 'x', 'b', 'y', 'c'], 'c', { id: 'a', after: true })).toBe(1)
    expect(dropIndex(['a', 'x', 'b', 'y', 'c'], 'c', { id: 'b', after: false })).toBe(2)
    expect(dropIndex(['a', 'x', 'b'], 'z', undefined)).toBe(3)
  })
})
