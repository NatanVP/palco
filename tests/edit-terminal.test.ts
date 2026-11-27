import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IPty } from 'node-pty'
import { parseTerminalConfig } from '../src/main/validate'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { TerminalManager, type TerminalManagerOptions } from '../src/main/pty/terminal-manager'
import { agentForCommand } from '../src/shared/agent-command'
import type { TerminalNode } from '../src/shared/model'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-edit-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('agente sai do comando (regra única, main e renderer)', () => {
  it('vazio é shell; claude/codex pelo binário; resto é other', () => {
    expect(agentForCommand('')).toBe('shell')
    expect(agentForCommand('  claude ')).toBe('claude')
    expect(agentForCommand('/usr/local/bin/codex')).toBe('codex')
    expect(agentForCommand('opencode')).toBe('other')
  })
})

describe('parseTerminalConfig: comando e pasta do Editar', () => {
  const ctx = (): { home: string; defaultDir: string } => ({ home: dir, defaultDir: dir })

  it('troca comando e pasta; o agente acompanha o comando', () => {
    const work = join(dir, 'proj'); mkdirSync(work)
    expect(parseTerminalConfig({ command: 'codex', cwd: work }, ctx())).toEqual({ command: 'codex', cwd: work, agent: 'codex' })
    expect(parseTerminalConfig({ command: '', cwd: work }, ctx())).toEqual({ command: '', cwd: work, agent: 'shell' })
  })

  it('uma escolha explícita substitui a inferência automática', () => {
    const work = join(dir, 'proj'); mkdirSync(work)
    expect(parseTerminalConfig({ command: 'clauded', cwd: work, agent: 'claude' }, ctx()).agent).toBe('claude')
    expect(parseTerminalConfig({ command: 'claude', cwd: work, agent: 'other' }, ctx()).agent).toBe('other')
  })

  it('pasta vazia usa a padrão; ~/ vira a pasta pessoal', () => {
    mkdirSync(join(dir, 'sub'))
    expect(parseTerminalConfig({ command: 'claude', cwd: '' }, ctx()).cwd).toBe(dir)
    expect(parseTerminalConfig({ command: 'claude', cwd: '~/sub' }, ctx()).cwd).toBe(join(dir, 'sub'))
  })

  it('recusa pasta inexistente, arquivo, caminho relativo e comando com metacaractere', () => {
    writeFileSync(join(dir, 'arquivo'), 'x')
    expect(() => parseTerminalConfig({ command: 'claude', cwd: join(dir, 'nao-existe') }, ctx())).toThrow(/não existe/)
    expect(() => parseTerminalConfig({ command: 'claude', cwd: join(dir, 'arquivo') }, ctx())).toThrow(/não é uma pasta/)
    expect(() => parseTerminalConfig({ command: 'claude', cwd: 'relativa' }, ctx())).toThrow(/absoluto/)
    expect(() => parseTerminalConfig({ command: 'claude; rm -rf ~', cwd: dir }, ctx())).toThrow(/fora de aspas/)
    expect(() => parseTerminalConfig({ command: 'claude', cwd: dir, extra: 1 }, ctx())).toThrow()
    expect(() => parseTerminalConfig('x', ctx())).toThrow()
  })
})

describe('store: reconfigurar terminal', () => {
  it('grava comando, pasta e agente; troca de agente derruba role e conta que não servem mais', () => {
    const store = new WorkspaceStore(join(dir, 'ws.json'))
    const id = store.addNode({ kind: 'terminal', floorId: null, name: 'T', agent: 'claude', command: 'claude', cwd: '/tmp', role: 'revisor', accountId: 'c2', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })
    store.reconfigureTerminal(id, { command: 'claude', cwd: dir, agent: 'claude' })
    expect(store.get().nodes[id]).toMatchObject({ command: 'claude', cwd: dir, agent: 'claude', role: 'revisor', accountId: 'c2' })
    store.reconfigureTerminal(id, { command: 'opencode', cwd: dir, agent: 'other' })
    const node = store.get().nodes[id] as TerminalNode
    expect(node).toMatchObject({ command: 'opencode', agent: 'other' })
    expect(node.role).toBeUndefined()
    expect(node.accountId).toBeUndefined()
    store.flush()
  })
})

describe('TerminalManager.restart: reinicia com a configuração nova', () => {
  it('encerra o processo atual (saída confirmada e avisada) e sobe outro na pasta nova, geração nova', async () => {
    const spawned: Array<{ cwd: string; exit(code: number): void }> = []
    const spawnPty = vi.fn<NonNullable<TerminalManagerOptions['spawnPty']>>((_file, _args, options) => {
      let onExit: ((e: { exitCode: number }) => void) | undefined
      spawned.push({ cwd: String(options.cwd), exit: (code) => onExit?.({ exitCode: code }) })
      return { pid: 4242, onData: () => ({ dispose() {} }), onExit: (cb: typeof onExit) => { onExit = cb; return { dispose() {} } }, kill() {}, write() {}, resize() {} } as unknown as IPty
    })
    const signals: string[] = []
    const manager = new TerminalManager({ socketPath: '/fake/socket', palcoBin: '/fake/palco', spawnPty, signalProcess: (_pid, sig) => { signals.push(sig); spawned.at(-1)!.exit(143) } })
    const exits: Array<[string, number]> = []
    manager.onExit((id, code) => exits.push([id, code]))
    const node: TerminalNode = { id: 't', kind: 'terminal', name: 'T', agent: 'shell', command: '', floorId: null, cwd: '/antiga', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }
    try {
      manager.spawn(node)
      const gen1 = manager.snapshot('t').gen
      await manager.restart({ ...node, cwd: '/nova' })
      expect(spawned.map((s) => s.cwd)).toEqual(['/antiga', '/nova'])
      expect(signals).toEqual(['SIGTERM'])
      expect(exits).toEqual([['t', 143]])
      expect(manager.isRunning('t')).toBe(true)
      expect(manager.snapshot('t').gen).toBe(gen1 + 1)
    } finally { manager.killAll() }
  })
})
