import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalManager } from '../../src/main/pty/terminal-manager'
import type { TerminalNode } from '../../src/shared/model'

const node: TerminalNode = {
  id: 'race', kind: 'terminal', floorId: null, name: 'race', agent: 'shell', command: '',
  cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 600, h: 400 }
}

function sessionMembers(pid: number): number[] {
  const sid = (id: string): string | undefined => {
    try {
      const stat = readFileSync(`/proc/${id}/stat`, 'utf8')
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[3]
    } catch { return undefined }
  }
  const own = sid(String(pid))
  return readdirSync('/proc').filter((id) => /^\d+$/.test(id) && sid(id) === own).map(Number)
}

describe('encerramento: sessão do terminal', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('não sinaliza a sessão do app quando o filho ainda não criou a própria', async () => {
    // Logo depois do forkpty o filho ainda pode estar na sessão do pai: o PTY falso, com o pid
    // deste processo de teste, reproduz esse instante. process.kill é falso: nenhum sinal sai daqui.
    const outsiders = new Set(sessionMembers(process.pid))
    const signalled: number[] = []
    vi.spyOn(process, 'kill').mockImplementation(((pid: number) => { signalled.push(pid); return true }) as never)
    const fake = {
      pid: process.pid, process: 'bash', cols: 80, rows: 24,
      onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
      write() {}, resize() {}, kill() {}, pause() {}, resume() {}, clear() {}
    }
    // pid que não é líder de sessão nenhuma: ninguém além dele pode ser alvo.
    const leader = Number(readFileSync('/proc/self/stat', 'utf8').split(') ')[1]!.split(' ')[3])
    expect(leader).not.toBe(process.pid)
    const manager = new TerminalManager({
      socketPath: '/tmp/palco-shutdown-race.sock', palcoBin: 'palco', spawnPty: (() => fake) as never
    })
    manager.spawn(node)

    await manager.shutdownAll()

    expect(signalled.filter((pid) => pid !== process.pid && outsiders.has(Math.abs(pid)))).toEqual([])
  }, 10000)

  it('não sobe terminal novo depois que o encerramento começou', async () => {
    const spawnPty = vi.fn()
    const manager = new TerminalManager({ socketPath: '/tmp/palco-shutdown-race.sock', palcoBin: 'palco', spawnPty: spawnPty as never })
    await manager.shutdownAll()
    manager.spawn(node)
    expect(spawnPty).not.toHaveBeenCalled()
  })
})
