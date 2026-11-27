import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ shell: { openPath: vi.fn(async () => '') } }))
import { agentLibrariesArea, attachLibraries } from '../src/main/ipc/agent-libraries'
import { LIBRARY_CH as CH } from '../src/shared/agent-libraries'
import { PromptStore } from '../src/main/prompts/prompt-store'
import { RoleLibrary } from '../src/main/agents/role-library'
import { RoleStore } from '../src/main/agents/roles'
import { SkillBases } from '../src/main/skill-bases'
import type { IpcAreaContext } from '../src/main/ipc/area'
let dir: string, off: () => void
afterEach(() => { off?.(); if (dir) rmSync(dir, { recursive: true, force: true }) })
it('contrato list/read entrega texto ao compositor, escopos inválidos não escrevem e pastas vêm do main', async () => {
 dir = mkdtempSync(join(tmpdir(), 'palco-library-ipc-')); const registry = {}, channels = new Map<string, (...args: unknown[]) => unknown>()
 const prompts = new PromptStore(join(dir, 'prompts'))
 off = attachLibraries(registry, { prompts, roles: new RoleLibrary(new RoleStore(join(dir, 'roles'))), skills: new SkillBases(join(dir, 'skills.json'), join(dir, 'resources/skills'), dir), hasWorkspace: id => id === 'w', root: id => { if (id !== 'w') throw new Error('workspace inválido'); return dir } })
 agentLibrariesArea({ handle: (c: string, fn: (...args: unknown[]) => unknown) => channels.set(c, fn), deps: { registry } } as unknown as IpcAreaContext)
 const call = (channel: string, ...args: unknown[]) => channels.get(channel)!(...args)
 expect(() => call(CH.promptSave, { name: 'A', body: 'B', workspaceId: '/tmp/other' })).toThrow()
 const saved = call(CH.promptSave, { name: 'A', body: 'Texto @sem-expandir', workspaceId: 'w' }) as { id: string }
 expect(call(CH.promptList, 'w')).toMatchObject({ items: [{ id: saved.id, name: 'A' }], problems: [] })
 expect(call(CH.promptRead, saved.id)).toMatchObject({ body: 'Texto @sem-expandir' })
 expect(() => call(CH.promptRead, '../outside')).toThrow(); expect(() => call(CH.roleDiscover, '/tmp/arbitrary')).toThrow()
 await call(CH.promptFolder)
})
