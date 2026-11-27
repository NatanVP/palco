import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs } from '../src/cli/args'
import { helpFor } from '../src/cli/help'
import { AskBroker } from '../src/main/ask/ask-broker'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { removeWorkspace } from '../src/main/domain/workspace-removal'
import { startServer, type ServerDeps } from '../src/main/server/http-server'
import { HEADER_TOKEN } from '../src/shared/auth'
import type { AgentKind } from '../src/shared/model'

let compiled: string, cli: string
beforeAll(async () => {
  compiled = mkdtempSync(join(tmpdir(), 'palco-delete-cli-')); cli = join(compiled, 'palco.cjs')
  await build({ entryPoints: ['src/cli/palco.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: cli, logLevel: 'silent' })
})
afterAll(() => rmSync(compiled, { recursive: true, force: true }))

let root: string, socket: string, project: string, registry: WorkspaceRegistry, current: string, target: string, caller: string
let server: { close(): Promise<void> }, running: Set<string>
const dispose = vi.fn(), unregister = vi.fn()
const token = 'workspace-delete-test-caller'
const terminal = (workspace: string, name: string, agent: AgentKind, live: boolean, maestro = false) => {
  const id = registry.get(workspace).addNode({ kind: 'terminal', floorId: null, name, agent, maestro, command: agent === 'shell' ? '' : agent, cwd: project, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })
  if (live) running.add(id)
  return id
}
const run = (args: string[]) => new Promise<{ code: number; out: string; err: string }>(resolve => {
  execFile(process.execPath, [cli, ...args], {
    env: { PATH: process.env.PATH, HOME: root, PALCO_SOCKET: socket, PALCO_TOKEN: token }, timeout: 10_000
  }, (error, out, err) => resolve({ code: error ? 1 : 0, out, err }))
})
const post = (body: unknown) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const req = http.request({ socketPath: socket, method: 'POST', path: '/workspace/delete', headers: { [HEADER_TOKEN]: token, 'content-type': 'application/json' } }, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode!, body }))
  })
  req.on('error', reject); req.end(JSON.stringify(body))
})
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'palco-workspace-delete-')); socket = join(root, 's.sock')
  project = join(root, 'projeto'); mkdirSync(project); mkdirSync(join(project, '.git')); writeFileSync(join(project, 'trabalho.txt'), 'preservado')
  registry = new WorkspaceRegistry(join(root, 'dados', 'workspaces'))
  current = registry.activeId(); registry.rename(current, 'Atual'); target = registry.create('Outro Projeto'); registry.setWorkspaceDir(target, project)
  running = new Set(); dispose.mockReset(); unregister.mockReset()
  dispose.mockImplementation(id => { running.delete(id) })
  caller = terminal(current, 'Coordenador', 'shell', true, true)
  const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout })
  server = await startServer(socket, {
    registry, broker,
    terminals: { dispose, screenText: () => '', isRunning: id => running.has(id), identify: value => value === token ? { id: caller, gen: 1 } : undefined, agentState: () => 'ready', markReady: () => {}, notePromptHook: () => {} },
    portals: { unregister } as unknown as ServerDeps['portals']
  })
})
afterEach(async () => { await server.close(); registry.flushAll(); rmSync(root, { recursive: true, force: true }) })

describe('workspace delete pelo CLI', () => {
  it('remove o workspace, encerra terminais, fecha portais e retira as notas do canvas sem apagar o projeto', async () => {
    const shell = terminal(target, 'Shell', 'shell', true), stopped = terminal(target, 'Agente parado', 'codex', false)
    const portal = registry.get(target).addNode({ kind: 'portal', floorId: null, name: 'Web', url: 'about:blank', pos: { x: 0, y: 0 }, size: { w: 500, h: 400 } })
    const note = registry.get(target).addNode({ kind: 'note', floorId: null, name: 'Nota', content: 'texto', pos: { x: 0, y: 0 }, size: { w: 200, h: 160 } })
    registry.switch(target)
    const result = await run(['workspace', 'delete', 'Outro Projeto'])
    expect(result.code).toBe(0); expect(result.out).toContain('removido'); expect(result.err).toBe('')
    expect(registry.list().map(w => w.id)).toEqual([current]); expect(registry.activeId()).toBe(current)
    for (const id of [shell, stopped, portal, note]) expect(registry.node(id)).toBeUndefined()
    expect(dispose.mock.calls.map(([id]) => id).sort()).toEqual([shell, stopped].sort()); expect(unregister).toHaveBeenCalledExactlyOnceWith(portal)
    expect(running.has(shell)).toBe(false); expect(running.has(caller)).toBe(true)
    expect(readFileSync(join(project, 'trabalho.txt'), 'utf8')).toBe('preservado'); expect(existsSync(join(project, '.git'))).toBe(true)
  })
  it('lista todos os agentes em execução e não modifica nada sem --force', async () => {
    const a = terminal(target, 'Revisor', 'codex', true), b = terminal(target, 'Analista', 'other', true)
    terminal(target, 'Shell livre', 'shell', true); terminal(target, 'Agente encerrado', 'claude', false)
    const result = await run(['workspace', 'delete', 'Outro Projeto'])
    expect(result.code).toBe(1); expect(result.err).toContain('Revisor'); expect(result.err).toContain('Analista'); expect(result.err).toContain('--force')
    expect(result.err).not.toContain('Shell livre'); expect(result.err).not.toContain('Agente encerrado')
    expect(registry.get(target).hasNode(a)).toBe(true); expect(running.has(b)).toBe(true); expect(dispose).not.toHaveBeenCalled(); expect(unregister).not.toHaveBeenCalled()
  })
  it('--force encerra agentes em execução e preserva o projeto', async () => {
    const agent = terminal(target, 'Revisor', 'codex', true)
    const result = await run(['workspace', 'delete', 'Outro Projeto', '--force'])
    expect(result.code).toBe(0); expect(running.has(agent)).toBe(false); expect(dispose).toHaveBeenCalledExactlyOnceWith(agent)
    expect(registry.list().some(w => w.id === target)).toBe(false); expect(readFileSync(join(project, 'trabalho.txt'), 'utf8')).toBe('preservado')
  })
  it.each([false, true])('recusa o workspace do chamador mesmo com outro workspace na tela: %j', async force => {
    registry.switch(target)
    const result = await run(['workspace', 'delete', 'Atual', ...(force ? ['--force'] : [])])
    expect(result.code).toBe(1); expect(result.err).toContain('terminal chamador'); expect(registry.list()).toHaveLength(2); expect(dispose).not.toHaveBeenCalled()
  })
  it.each([false, true])('recusa o último workspace: %j', async force => {
    registry.remove(target)
    const result = await run(['workspace', 'delete', 'Atual', ...(force ? ['--force'] : [])])
    expect(result.code).toBe(1); expect(result.err).toContain('último workspace'); expect(registry.list()).toHaveLength(1); expect(dispose).not.toHaveBeenCalled()
  })
  it('exige Modo Maestro e mantém os dados quando o workspace não existe', async () => {
    const coordinator = caller; caller = terminal(current, 'Sem permissão', 'shell', true)
    expect((await post({ name: 'Outro Projeto', force: true })).status).toBe(403)
    caller = coordinator
    expect((await post({ name: 'Inexistente' })).status).toBe(404)
    expect(registry.list()).toHaveLength(2); expect(dispose).not.toHaveBeenCalled()
  })
  it.each(['true', 1, null])('recusa --force com valor inválido no protocolo: %j', async force => {
    expect((await post({ name: 'Outro Projeto', force })).status).toBe(400); expect(registry.list()).toHaveLength(2)
  })
  it('não encerra recursos se o registro recusar a remoção compartilhada', () => {
    terminal(target, 'Shell', 'shell', true)
    vi.spyOn(registry, 'remove').mockImplementationOnce(() => { throw new Error('gravação recusada') })
    expect(() => removeWorkspace(registry, target, { disposeTerminal: dispose, unregisterPortal: unregister })).toThrow('gravação recusada')
    expect(dispose).not.toHaveBeenCalled(); expect(unregister).not.toHaveBeenCalled(); expect(registry.list()).toHaveLength(2)
  })
})

describe('sintaxe e ajuda de workspace delete', () => {
  it('aceita nome com espaços e --force', () => {
    expect(parseArgs(['workspace', 'delete', 'Outro Projeto'])).toEqual({ cmd: 'workspace-delete', name: 'Outro Projeto' })
    expect(parseArgs(['workspace', 'delete', 'Outro Projeto', '--force'])).toEqual({ cmd: 'workspace-delete', name: 'Outro Projeto', force: true })
  })
  it('preserva o comando de exclusão de andar', () => {
    expect(parseArgs(['floor', 'delete', 'Interface', '--force'])).toEqual({ cmd: 'floor-delete', name: 'Interface', force: true })
  })
  it.each([[], ['--force'], ['A', 'B'], ['A', '--unknown'], ['A', '--force', 'true']])('recusa argumentos inválidos: %j', async (...args) => {
    expect(() => parseArgs(['workspace', 'delete', ...args])).toThrow()
  })
  it('documenta remoção e --force na ajuda real do CLI', async () => {
    const result = await run(['workspace', '--help'])
    expect(result.code).toBe(0); expect(result.out).toContain('workspace delete <nome> [--force]'); expect(result.out).toContain('preserva a pasta do projeto')
    expect(helpFor(['workspace', 'delete', '--help'])).toContain('--force')
  })
})
