import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { validateWorkspace } from '../src/main/domain/workspace-schema'
import { parseDockState } from '../src/main/validate'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-dock-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const dock = { dockedId: 'a', edge: 'leading' as const, memory: ['a', 'b'], liftedId: null }

describe('dockState: validação', () => {
  it('aceita o estado válido e normaliza', () => { expect(parseDockState(dock)).toEqual(dock); expect(parseDockState({ dockedId: null, edge: 'trailing', memory: [], liftedId: 'x' })).toMatchObject({ liftedId: 'x' }) })
  it('recusa borda desconhecida, ids que não são texto, memória grande e campo estranho', () => {
    expect(() => parseDockState({ ...dock, edge: 'top' })).toThrow(); expect(() => parseDockState({ ...dock, dockedId: 3 })).toThrow()
    expect(() => parseDockState({ ...dock, memory: Array.from({ length: 101 }, (_, i) => String(i)) })).toThrow(); expect(() => parseDockState({ ...dock, memory: [1] })).toThrow(); expect(() => parseDockState(null)).toThrow()
  })
})
describe('dockState: persistência por andar', () => {
  it('no Ground grava no workspace; num andar grava no andar; sobrevive a fechar e abrir', () => {
    const s = new WorkspaceStore(join(dir, 'w.json'))
    s.setDockState(dock); expect(s.get().dockState).toEqual(dock)
    const f = s.addFloor({ name: 'F', dir: '/tmp', branch: '', baseRef: '', repoRoot: '/tmp', plain: true }); s.setActiveFloor(f)
    s.setDockState({ dockedId: null, edge: 'trailing', memory: [], liftedId: 'z' }); expect(s.get().floors[f]!.dockState).toMatchObject({ liftedId: 'z' }); expect(s.get().dockState).toEqual(dock)
    s.flush(); s.dispose()
    const again = new WorkspaceStore(join(dir, 'w.json'))
    expect(again.get().dockState).toEqual(dock); expect(again.get().floors[f]!.dockState).toMatchObject({ liftedId: 'z' }); again.dispose()
  })
  it('arquivo com dockState inválido mantém o workspace e descarta só o campo', () => {
    const ws = validateWorkspace({ id: 'w', name: 'W', version: 1, nodes: {}, connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 }, drawings: [], dockState: { dockedId: 5, edge: 'x' } } as never) as unknown as Record<string, unknown>
    expect(ws.id).toBe('w'); expect(ws).not.toHaveProperty('dockState')
  })
})
