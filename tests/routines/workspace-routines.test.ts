import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { RoutineStore } from '../../src/main/routines/routine-store'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'
import { workspaceRoutines } from '../../src/main/routines/workspace-routines'
it('isolates names, list/show and every mutation by target workspace, not creator', () => {
  vi.useFakeTimers(); const dir = mkdtempSync(join(process.cwd(), 'tests/routines/.scope-'))
  try {
    const all = new RoutineStore(join(dir, 'routines.json')), a = new WorkspaceStore(join(dir, 'a')), b = new WorkspaceStore(join(dir, 'b'))
    const node = { kind: 'terminal' as const, floorId: null, name: 'Same', agent: 'shell' as const, command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }
    const aid = a.addNode(node), bid = b.addNode(node), sa = workspaceRoutines(all, a), sb = workspaceRoutines(all, b)
    const routine = { name: 'Same', schedule: { kind: 'every' as const, seconds: 5 * 60 }, terminalId: aid, content: 'Only A', enabled: true, createdBy: bid }
    const ra = sa.add(routine), rb = sb.add({ ...routine, terminalId: bid, content: 'Only B' })
    expect(sa.list().map(r => r.content)).toEqual(['Only A'])
    expect(sb.byName('same')?.id).toBe(rb.id)
    expect(sb.byId(ra.id)).toBeUndefined()
    const run = vi.fn(() => 'ok')
    for (const action of [() => sb.patch(ra.id, { enabled: false }), () => sb.remove(ra.id), () => sb.runNow(ra.id, { runNow: run })]) expect(action).toThrow()
    expect(run).not.toHaveBeenCalled()
    expect(() => sb.add({ ...routine, terminalId: aid, name: 'Foreign' })).toThrow()
    expect(() => sa.add(routine)).toThrow(/já existe/)
    // Alvo removido: a rotina continua no workspace onde nasceu (sem órfãs), e B não a vê.
    a.removeNode(aid)
    expect(sa.byName('same')?.id).toBe(ra.id)
    expect(sb.byId(ra.id)).toBeUndefined()
    expect(() => sa.remove(ra.id)).not.toThrow()
  } finally { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})

it('rotina antiga sem workspaceId pertence ao workspace do terminal alvo', () => {
  vi.useFakeTimers(); const dir = mkdtempSync(join(process.cwd(), 'tests/routines/.scope-'))
  try {
    const all = new RoutineStore(join(dir, 'routines.json')), a = new WorkspaceStore(join(dir, 'a')), b = new WorkspaceStore(join(dir, 'b'))
    const aid = a.addNode({ kind: 'terminal', floorId: null, name: 'T', agent: 'shell', command: '', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })
    const legacy = all.add({ name: 'velha', schedule: { kind: 'every', seconds: 5 * 60 }, terminalId: aid, content: 'x', enabled: true, createdBy: aid })
    expect(legacy.workspaceId).toBeUndefined()
    expect(workspaceRoutines(all, a).byId(legacy.id)?.id).toBe(legacy.id)
    expect(workspaceRoutines(all, b).byId(legacy.id)).toBeUndefined()
  } finally { vi.clearAllTimers(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})
