// Cópia do layout de workspace e sincronização incremental de notas e portais.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { cloneWorkspaceLayout } from '../src/main/domain/workspace-clone'
import { LinkedNotes } from '../src/main/notes/linked-notes'
import { portalCensus } from '../src/main/portal/isolated-storage'
import { floorGroups } from '../src/shared/groups'
import type { NewNode, NoteNode } from '../src/shared/model'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-layout-sync-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const note = (name: string, extra: object = {}): NewNode => ({ kind: 'note', floorId: null, name, content: 'c', pos: { x: 0, y: 0 }, size: { w: 200, h: 100 }, ...extra }) as NewNode

it('workspace criado a partir de outro leva grupos e nomes de fichário, e a nota ligada vira cópia solta', () => {
  const source = new WorkspaceStore(join(dir, 'a.json')), target = new WorkspaceStore(join(dir, 'b.json'))
  const file = join(dir, 'n.md'); writeFileSync(file, 'do arquivo')
  const a = source.addNode(note('A', { stackId: 's1' })), b = source.addNode(note('B', { stackId: 's1' })), c = source.addNode(note('C', { linkedFile: file }))
  source.setStackName('s1', 'Pesquisa'); const g = source.groupNodes([a, c])!; source.renameGroup(g, 'Entrada'); source.setGroupColor(g, '#bbdefb'); void b
  cloneWorkspaceLayout(source.get(), target, undefined, dir)
  const copy = target.get()
  expect(floorGroups(copy, null).map((x) => [x.group, x.members.map((m) => m.name).sort()])).toEqual([[{ name: 'Entrada', color: '#bbdefb' }, ['A', 'C']]])
  expect(copy.stackNames).toEqual({ s1: 'Pesquisa' })
  const linked = Object.values(copy.nodes).find((n) => n.name === 'C') as NoteNode
  expect(linked.linkedFile).toBeUndefined(); expect(linked.content).toBe('c')
  source.dispose(); target.dispose()
})

it('sincronizar notas ligadas e anotar portais isolados não clona os workspaces inteiros', () => {
  const registry = new WorkspaceRegistry(join(dir, 'ws')), store = registry.active()
  const file = join(dir, 'l.md'); writeFileSync(file, 'x')
  store.addNode(note('L', { linkedFile: file })); const portal = store.addNode({ kind: 'portal', floorId: null, name: 'P', url: 'https://e.com', storage: 'isolated', pos: { x: 0, y: 0 }, size: { w: 200, h: 100 } } as NewNode)
  const links = new LinkedNotes(() => registry.openStores())
  // A primeira sincronização muda o conteúdo (e a mudança avisa a todos com o workspace inteiro); o que se mede é a rotina.
  links.sync()
  const whole = vi.spyOn(store, 'get'), all = vi.spyOn(registry, 'allNodes')
  links.sync(); links.sync()
  expect(portalCensus(registry).ids).toEqual([portal])
  expect(whole).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled()
  links.dispose(); registry.flushAll()
})
