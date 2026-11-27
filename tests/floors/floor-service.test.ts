import { describe, expect, it, vi } from 'vitest'
import { FloorService, type GitOps } from '../../src/main/floors/floor-service'

/** Store mínimo: um floor com dois terminais e um portal. */
function setup(over: { check?: () => Promise<void>; remove?: () => Promise<void> } = {}) {
  const log: string[] = []
  const floor = { id: 'f1', name: 'ui', repoRoot: '/r', dir: '/r.floors/ui', branch: 'palco/ui', baseRef: 'main' }
  let nodes: Record<string, { id: string; kind: string; floorId: string | null }> = {
    t1: { id: 't1', kind: 'terminal', floorId: 'f1' },
    t2: { id: 't2', kind: 'terminal', floorId: 'f1' },
    p1: { id: 'p1', kind: 'portal', floorId: 'f1' },
    g1: { id: 'g1', kind: 'terminal', floorId: null }
  }
  const store = {
    get: () => ({ floors: { f1: floor }, nodes }),
    removeFloor: vi.fn(() => {
      log.push('store.removeFloor')
      const gone = Object.values(nodes).filter((n) => n.floorId === 'f1')
      nodes = Object.fromEntries(Object.entries(nodes).filter(([, n]) => n.floorId !== 'f1'))
      return gone.filter((n) => n.kind === 'terminal').map((n) => n.id)
    })
  }
  const git = {
    checkFloorRemovable: vi.fn(over.check ?? (async () => void log.push('git.check'))),
    removeFloorWorktree: vi.fn(over.remove ?? (async () => void log.push('git.remove'))),
    landFloor: vi.fn(async () => ({ ok: true as const, merged: 'palco/ui', into: 'main' }))
  }
  const terminals = { dispose: vi.fn((id: string) => void log.push(`dispose ${id}`)) }
  const portals = { unregister: vi.fn((id: string) => void log.push(`unregister ${id}`)) }
  const service = new FloorService({ store: store as never, terminals, portals, git: git as unknown as GitOps })
  return { service, log, git, terminals, store }
}

describe('FloorService: exclusão ordenada', () => {
  it('checagens antes de mexer em qualquer coisa, depois os PTYs, depois a worktree, por fim o estado', async () => {
    const { service, log } = setup()
    await service.remove('f1')
    expect(log).toEqual(['git.check', 'dispose t1', 'dispose t2', 'git.remove', 'store.removeFloor', 'unregister p1'])
  })

  it('se a checagem recusar, nenhum PTY é morto e nada é removido', async () => {
    const { service, log, terminals, git, store } = setup({ check: async () => { throw new Error('o floor tem mudanças não commitadas (use --force)') } })
    await expect(service.remove('f1')).rejects.toThrow(/mudanças não commitadas/)
    expect(terminals.dispose).not.toHaveBeenCalled()
    expect(git.removeFloorWorktree).not.toHaveBeenCalled()
    expect(store.removeFloor).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })

  it('se a remoção falhar depois de matar os PTYs, o floor continua no estado e o erro é explícito', async () => {
    const { service, store } = setup({ remove: async () => { throw new Error('git travou') } })
    await expect(service.remove('f1')).rejects.toThrow('git travou')
    expect(store.removeFloor).not.toHaveBeenCalled()
  })

  it('o land que remove o floor segue a mesma ordem', async () => {
    const { service, log } = setup()
    expect(await service.land('f1')).toMatchObject({ ok: true })
    expect(log).toEqual(['git.check', 'dispose t1', 'dispose t2', 'git.remove', 'store.removeFloor', 'unregister p1'])
  })

  it('land com keepFloor não mexe em processos nem na worktree', async () => {
    const { service, log } = setup()
    await service.land('f1', { keepFloor: true })
    expect(log).toEqual([])
  })
})
