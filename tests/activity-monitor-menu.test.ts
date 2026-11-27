// "Monitorar Atividade" desmarcado no menu cala o aviso de turno concluído daquele terminal.
import { describe, expect, it, vi } from 'vitest'
import { wireSystemSources } from '../src/main/system/runtime'

describe('Monitorar Atividade', () => {
  it.each([[undefined, 1], [true, 1], [false, 0]])('monitor=%s publica %i aviso de turno', (monitor, expected) => {
    const publish = vi.fn(), working = vi.fn()
    const node = { id: 't', kind: 'terminal', name: 'A', agent: 'claude', floorId: null, ...(monitor === undefined ? {} : { monitor }) }
    const sources = wireSystemSources({
      controller: { publish, working, forget: vi.fn(), refresh: vi.fn() } as never, sessions: { remember: vi.fn() } as never,
      registry: { node: () => node, storeOfNode: () => undefined, list: () => [], onChange: () => () => {} } as never,
      terminals: { onData: () => () => {}, onExit: () => () => {} } as never, preferences: { onChange: () => () => {}, get: () => ({ notifyOnPullRequests: false }) } as never,
      pullRequests: async () => []
    })
    sources.agentEvent('t', 'turn')
    expect(publish.mock.calls.filter((c) => c[0].kind === 'turn')).toHaveLength(expected)
    expect(working).toHaveBeenCalledWith('t', false)
    sources.dispose()
  })
})
