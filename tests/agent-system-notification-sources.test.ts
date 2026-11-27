import { it, expect, vi } from 'vitest'
import { PullRequestWatcher } from '../src/main/system/pull-requests'
import { hookSessionId, codexTurn } from '../src/cli/hooks'
import { resumeCommand } from '../src/main/system/sessions'
it('PR: baseline silenciosa, criação e mudança notificadas; desligado não consulta', async () => {
 let enabled = true, list = [{ number: 1, state: 'OPEN', updatedAt: 'a', title: 'A', url: 'https://example.test/1' }]
 const changed = vi.fn(), read = vi.fn(async () => list)
 const watcher = new PullRequestWatcher({ enabled: () => enabled, roots: () => [{ workspaceId: 'w', cwd: '/tmp' }], read, changed })
 await watcher.poll(); expect(changed).not.toHaveBeenCalled()
 list = [...list, { ...list[0]!, number: 2 }]; await watcher.poll(); expect(changed).toHaveBeenCalledTimes(1)
 list = list.map(p => ({ ...p, state: 'MERGED' })); await watcher.poll(); expect(changed).toHaveBeenCalledTimes(3)
 enabled = false; await watcher.poll(); expect(read).toHaveBeenCalledTimes(3)
})
it('hooks capturam só ids válidos e nunca escolhem --last', () => {
 expect(hookSessionId('{"session_id":"abc-123"}')).toBe('abc-123')
 expect(hookSessionId('{"thread-id":"codex_1"}')).toBe('codex_1')
 expect(hookSessionId('{"session_id":"bad;command"}')).toBeUndefined()
 expect(resumeCommand('claude --model sonnet', 'claude', 'abc')).toContain('--resume')
 expect(resumeCommand('codex --model x', 'codex', 'abc')).not.toContain('--last')
})

import { wireSystemSources } from '../src/main/system/runtime'
it('busy explícito mantém bloqueio durante silêncio; turn libera; status do andar tem consumidor', async () => {
 vi.useFakeTimers()
 let onData: (id: string) => void = () => {}, onRegistry: (id: string) => void = () => {}
 const terminal = { id: 't', kind: 'terminal', agent: 'claude', name: 'T', floorId: null }
 let ws = { id: 'w', name: 'W', groundStatus: { state: 'working', text: '' }, floors: {}, nodes: { t: terminal } }
 const publish = vi.fn(), working = vi.fn(), dependencies = {
  controller: { publish, working, forget: vi.fn(), refresh: vi.fn() }, sessions: { remember: vi.fn() },
  registry: { node: () => terminal, storeOfNode: () => ({ get: () => ws }), get: () => ({ get: () => ws }), list: () => [{ id: 'w', name: 'W' }], onChange: (fn: typeof onRegistry) => { onRegistry = fn; return () => {} } },
  terminals: { onData: (fn: typeof onData) => { onData = fn; return () => {} }, onExit: () => () => {} }, preferences: { get: () => ({ notifyOnPullRequests: false }), onChange: () => () => {} }
 } as unknown as Parameters<typeof wireSystemSources>[0]
 const runtime = wireSystemSources(dependencies)
 runtime.agentEvent('t', 'busy'); onData('t'); working.mockClear(); await vi.advanceTimersByTimeAsync(10000)
 expect(working).not.toHaveBeenCalledWith('t', false)
 runtime.agentEvent('t', 'turn'); expect(working).toHaveBeenCalledWith('t', false); expect(publish).toHaveBeenCalledWith(expect.objectContaining({ kind: 'turn' }))
 ws = { ...ws, groundStatus: { state: 'blocked', text: 'Preciso de você' } }; onRegistry('w'); expect(publish).toHaveBeenCalledWith(expect.objectContaining({ kind: 'floor', body: 'Preciso de você' }))
 runtime.dispose(); vi.useRealTimers()
})
