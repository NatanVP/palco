import { readdirSync, readFileSync } from 'node:fs'

export interface ProcessMem { pid: number; rssKB: number }
/** `pids[0]` é o shell (a raiz do terminal); os demais são os descendentes dele. */
export interface TerminalMem { id: string; pids: ProcessMem[] }

/** Terminais cuja árvore (shell + filhos) passa do limite, com o uso em MB. */
export function findOverLimit(terminals: readonly TerminalMem[], limitMB: number): Array<{ id: string; usedMB: number }> {
  const out: Array<{ id: string; usedMB: number }> = []
  for (const t of terminals) {
    const usedMB = Math.round(t.pids.reduce((s, p) => s + p.rssKB, 0) / 1024)
    if (usedMB > limitMB) out.push({ id: t.id, usedMB })
  }
  return out
}

export interface MemoryGuardDeps {
  enabled(): boolean
  limitMB(): number
  terminals(): TerminalMem[]
  kill(pid: number): void
}
/** "Limite de memória por terminal": passou do limite, encerra os processos filhos; o shell continua ativo. */
export class MemoryGuard {
  private timer?: ReturnType<typeof setInterval>
  constructor(private readonly deps: MemoryGuardDeps) {}
  check(): string[] {
    if (!this.deps.enabled()) return []
    const terminals = this.deps.terminals(), over = findOverLimit(terminals, this.deps.limitMB())
    for (const o of over) for (const p of terminals.find(t => t.id === o.id)!.pids.slice(1)) { try { this.deps.kill(p.pid) } catch { /* já saiu */ } }
    return over.map(o => o.id)
  }
  /** Quantos terminais estão acima de um limite (aviso ao reduzir o limite). */
  countAbove(limitMB: number): number { return findOverLimit(this.deps.terminals(), limitMB).length }
  start(everyMs = 5000): void { this.stop(); this.timer = setInterval(() => { try { this.check() } catch { /* leitura de /proc falhou: tenta no próximo ciclo */ } }, everyMs); this.timer.unref?.() }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined }
}

/** Linux: o processo e todos os descendentes, com a memória residente de cada um (/proc/<pid>/stat e statm). */
export function readProcessTree(root: number): ProcessMem[] {
  const children = new Map<number, number[]>()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      children.set(ppid, [...(children.get(ppid) ?? []), Number(name)])
    } catch { /* o processo saiu durante a leitura */ }
  }
  const out: ProcessMem[] = [], queue = [root]
  while (queue.length) {
    const pid = queue.shift()!
    try { out.push({ pid, rssKB: Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4 }) } catch { continue }
    queue.push(...(children.get(pid) ?? []))
  }
  return out
}
