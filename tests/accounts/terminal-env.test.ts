import type { IPty } from 'node-pty'
import { TerminalManager, type TerminalManagerOptions } from '../../src/main/pty/terminal-manager'
import type { Account, TerminalNode } from '../../src/shared/model'

it('spawn injeta conta escolhida, remove auth herdada e avisa no fallback sem spawn real', () => {
  const captured: Array<Record<string, string>> = []
  const spawnPty = vi.fn<NonNullable<TerminalManagerOptions['spawnPty']>>((_file, _args, options) => {
    captured.push(options.env as Record<string, string>)
    return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill() {}, write() {} } as unknown as IPty
  })
  const warning = vi.fn()
  const account: Account = { id: 'c2', name: 'Claude 2', agent: 'claude', configDir: '/fake/claude-work' }
  const manager = new TerminalManager({ socketPath: '/fake/socket', palcoBin: '/fake/palco', resolveAccount: id => id === 'c2' ? account : undefined, onWarning: warning, spawnPty,
    env: { CLAUDE_CONFIG_DIR: '/fake/inherited', CODEX_HOME: '/fake/inherited-codex', ANTHROPIC_API_KEY: 'test-placeholder' } })
  const node: TerminalNode = { id: 't', kind: 'terminal', name: 'T', agent: 'claude', command: 'claude', accountId: 'c2', floorId: null, cwd: '/fake', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }
  try {
    manager.spawn(node)
    expect(captured.length).toBe(1)
    expect(captured[0]?.CLAUDE_CONFIG_DIR).toBe('/fake/claude-work')
    expect(Boolean(captured[0]?.ANTHROPIC_API_KEY)).toBe(false)
    expect(Boolean(captured[0]?.CODEX_HOME)).toBe(false)
    manager.spawn({ ...node, id: 'missing', accountId: 'removed' })
    expect(Boolean(captured[1]?.CLAUDE_CONFIG_DIR)).toBe(false)
    expect(warning).toHaveBeenCalledWith('missing', expect.stringMatching(/padrão/))
  } finally { manager.killAll() }
})

it('terminal sem conta não herda CLAUDE_CONFIG_DIR nem CODEX_HOME do processo do palco', () => {
  const captured: Array<Record<string, string>> = []
  const spawnPty = vi.fn<NonNullable<TerminalManagerOptions['spawnPty']>>((_file, _args, options) => {
    captured.push(options.env as Record<string, string>)
    return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill() {}, write() {} } as unknown as IPty
  })
  const manager = new TerminalManager({ socketPath: '/fake/socket', palcoBin: '/fake/palco', spawnPty,
    env: { CLAUDE_CONFIG_DIR: '/fake/claude-sonnet', CODEX_HOME: '/fake/codex-outro', HOME: '/fake/home' } })
  const node: TerminalNode = { id: 'p', kind: 'terminal', name: 'P', agent: 'claude', command: 'claude', floorId: null, cwd: '/fake', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }
  try {
    manager.spawn(node)
    expect(captured[0]?.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(captured[0]?.CODEX_HOME).toBeUndefined()
    expect(captured[0]?.HOME).toBe('/fake/home')
  } finally { manager.killAll() }
})
