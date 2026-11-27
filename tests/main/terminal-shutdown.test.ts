import { readdirSync, readFileSync } from 'node:fs'
import { TerminalManager } from '../../src/main/pty/terminal-manager'
import { wireSystemSources } from '../../src/main/system/runtime'
import type { TerminalNode } from '../../src/shared/model'

const node: TerminalNode = {
  id: 'shutdown-test', kind: 'terminal', floorId: null, name: 'shutdown-test', agent: 'shell', command: '',
  cwd: process.cwd(), pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }
}

function sessionOf(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
    return Number(fields[3])
  } catch { return undefined }
}

function liveSessionPids(sid: number): number[] {
  const found: number[] = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
      if (Number(fields[3]) === sid && fields[0] !== 'Z') found.push(Number(entry))
    } catch { /* processo terminou durante a enumeração */ }
  }
  return found
}

async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('tempo esgotado esperando o processo de teste')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('encerramento de terminais', () => {
  it('cancela preparações de ambiente antes de sair', async () => {
    let aborted = false
    const spawnPty = () => { throw new Error('não deve iniciar um PTY') }
    const manager = new TerminalManager({
      socketPath: '/tmp/palco-shutdown-test.sock', palcoBin: 'palco', spawnPty: spawnPty as never,
      environments: { prepare: ({ signal }) => new Promise(resolve => signal?.addEventListener('abort', () => { aborted = true; resolve({ error: 'cancelado' }) })) }
    })
    manager.spawn({ ...node, id: 'pending', environment: { kind: 'ssh', host: 'example', user: 'u', port: 22 } })
    await manager.shutdownAll()
    await Promise.resolve()
    expect(aborted).toBe(true)
    expect(manager.isShuttingDown()).toBe(true)
  })

  it('mata processos restantes da sessão e preserva a sessão armazenada', async () => {
    const manager = new TerminalManager({ socketPath: '/tmp/palco-shutdown-test.sock', palcoBin: 'palco', env: { SHELL: '/bin/bash', PS1: '$ ' } })
    const forgotten: string[] = []
    const off = wireSystemSources({
      controller: { working() {}, forget: (id: string) => forgotten.push(id), publish() {}, refresh() {} } as never,
      sessions: { forget: (id: string) => forgotten.push(id), remember() {} } as never,
      registry: { list: () => [], node: () => undefined, storeOfNode: () => undefined, onChange: () => () => {} } as never,
      terminals: manager,
      preferences: { get: () => ({ notifyOnPullRequests: false }), onChange: () => () => {} } as never
    })
    try {
      manager.spawn(node)
      await waitFor(() => manager.isRunning(node.id))
      manager.write(node.id, "(trap '' HUP TERM; while :; do sleep 5; done) & echo CHILD_PID=$!\r")
      await waitFor(() => /CHILD_PID=(\d+)/.test(manager.screenText(node.id)))
      const childPid = Number(manager.screenText(node.id).match(/CHILD_PID=(\d+)/)?.[1])
      const sid = sessionOf(manager.livePids()[0]!.pid)
      expect(sid).toBeDefined()
      expect(sessionOf(childPid)).toBe(sid)

      await manager.shutdownAll()

      expect(liveSessionPids(sid!)).toEqual([])
      expect(forgotten).toEqual([])
    } finally {
      off.dispose()
      if (typeof manager.shutdownAll === 'function') await manager.shutdownAll()
      else manager.killAll()
    }
  }, 10000)
})
