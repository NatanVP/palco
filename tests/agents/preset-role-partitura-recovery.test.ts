import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RoleStore } from '../../src/main/agents/roles'
import { PresetStore } from '../../src/main/agents/presets'
import { AgentCatalog } from '../../src/main/agents/presets'
import { createAgentRoutes } from '../../src/main/agents/routes'
import { PartituraStore } from '../../src/main/partituras/partitura-store'
import { WorkspaceRegistry } from '../../src/main/domain/workspace-registry'
import { writeEnvelopeAtomic } from '../../src/main/domain/envelope'
import type { TerminalNode } from '../../src/shared/model'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(process.cwd(), 'tests/agents/.data-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('PresetStore nunca derruba o boot', () => {
  it('arquivo ilegível abre vazio, somente leitura, com aviso, e não é sobrescrito', () => {
    const file = join(dir, 'presets.json')
    writeFileSync(file, '{ "type": "presets", vírgula,, }')
    const presets = new PresetStore(file, new RoleStore(join(dir, 'roles')))
    expect(presets.list()).toEqual([])
    expect(presets.warning).toMatch(/presets\.json/)
    expect(() => presets.create({ name: 'x', agent: 'claude', command: '' })).toThrow(/somente leitura/)
    expect(readFileSync(file, 'utf8')).toBe('{ "type": "presets", vírgula,, }')
  })

  it('payload que não é lista: somente leitura com aviso', () => {
    const file = join(dir, 'presets.json')
    writeEnvelopeAtomic(file, 'presets', 1, { nada: true })
    const presets = new PresetStore(file, new RoleStore(join(dir, 'roles')))
    expect(presets.list()).toEqual([])
    expect(presets.warning).toBeTruthy()
  })

  it('entradas inválidas são descartadas com aviso e preservadas no arquivo ao salvar', () => {
    const file = join(dir, 'presets.json')
    const bad = [{ name: 'ruim', agent: 'claude', command: 'claude; rm -rf /' }, { name: 7 }]
    writeEnvelopeAtomic(file, 'presets', 1, [{ name: 'bom', agent: 'codex', command: 'codex' }, ...bad])
    const presets = new PresetStore(file, new RoleStore(join(dir, 'roles')))
    expect(presets.list().map((p) => p.name)).toEqual(['bom'])
    expect(presets.warning).toMatch(/2 preset/)
    presets.create({ name: 'novo', agent: 'shell', command: '' })
    const saved = JSON.parse(readFileSync(file, 'utf8')).payload as unknown[]
    expect(saved).toHaveLength(4)
    expect(saved).toEqual(expect.arrayContaining(bad))
    expect(new PresetStore(file, new RoleStore(join(dir, 'roles'))).list().map((p) => p.name)).toEqual(['bom', 'novo'])
  })
})

describe('RoleStore e PartituraStore ignoram o que não conseguem ler', () => {
  it('role ilegível some da lista com aviso', () => {
    const roles = new RoleStore(join(dir, 'roles'))
    roles.create('bom', 'texto')
    mkdirSync(join(dir, 'roles', 'pasta.md'))
    expect(roles.list().map((r) => r.name)).toEqual(['bom'])
    expect(roles.warning).toMatch(/pasta\.md/)
  })

  it('partitura inválida é ignorada na lista e no usesRole, com aviso', () => {
    const lib = new PartituraStore(join(dir, 'partituras'))
    lib.save({ name: 'Boa', nodes: [{ key: 't', kind: 'terminal', floorId: null, name: 'Rev', agent: 'claude', command: 'claude', role: 'rev', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } }], connections: [], bands: [], createdAt: new Date().toISOString() })
    writeFileSync(join(dir, 'partituras', 'quebrada.json'), 'lixo')
    writeEnvelopeAtomic(join(dir, 'partituras', 'invalida.json'), 'partitura', 1, { name: 'Invalida' })
    expect(lib.list().map((p) => p.name)).toEqual(['Boa'])
    expect(lib.warning).toMatch(/quebrada/)
    expect(lib.warning).toMatch(/invalida/)
    expect(lib.usesRole('rev')).toBe(true)
    expect(lib.usesRole('outro')).toBe(false)
  })
})

describe('role delete olha todos os workspaces', () => {
  it('role usado por terminal de outro workspace não é apagado', () => {
    const roles = new RoleStore(join(dir, 'roles'))
    roles.create('revisor', 'revise')
    const catalog = new AgentCatalog(new PresetStore(join(dir, 'presets.json'), roles), roles)
    const registry = new WorkspaceRegistry(join(dir, 'workspaces'))
    const a = registry.activeId(), b = registry.create('B')
    const term = (role?: string) => ({ kind: 'terminal' as const, floorId: null, name: 'T', agent: 'codex' as const, command: 'codex', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 }, ...(role ? { role } : {}) })
    registry.get(a).addNode(term('revisor'))
    const callerId = registry.get(b).addNode(term())
    const caller = registry.get(b).get().nodes[callerId] as TerminalNode
    const routes = createAgentRoutes(catalog, registry.get(b), undefined, () => registry.allNodes())
    const ctx = { caller, body: { name: 'revisor' }, url: new URL('http://palco/role/delete') }
    expect(() => routes['POST /role/delete']!(ctx)).toThrow(/em uso/)
    expect(roles.list().map((r) => r.name)).toEqual(['revisor'])
    registry.flushAll()
  })
})
