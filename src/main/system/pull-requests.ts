import { execFile } from 'node:child_process'
export interface PullRequest { number: number; title: string; state: string; updatedAt: string; url: string }
/** GitHub CLI performs auth itself; the app never reads its credential files. Other Git hosts can supply the same adapter. */
export function readPullRequests(cwd: string): Promise<PullRequest[]> {
  return new Promise((resolve, reject) => execFile('gh', ['pr', 'list', '--state', 'all', '--limit', '30', '--json', 'number,title,state,updatedAt,url'], { cwd, timeout: 15000, maxBuffer: 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }, (error, stdout) => {
    if (error) { reject(new Error('Não foi possível consultar pull requests pela CLI do host.')); return }
    try {
      const value: unknown = JSON.parse(stdout)
      if (!Array.isArray(value)) throw new Error('invalid')
      resolve(value.filter((v): v is PullRequest => !!v && typeof v.number === 'number' && ['title','state','updatedAt','url'].every(k => typeof v[k] === 'string')))
    } catch { reject(new Error('Resposta inválida do provedor de pull requests.')) }
  }))
}
export class PullRequestWatcher {
  private previous = new Map<string, Map<number, string>>()
  private busy = false
  constructor(private readonly d: { enabled(): boolean; roots(): Array<{ workspaceId: string; cwd: string }>; read(cwd: string): Promise<PullRequest[]>; changed(workspaceId: string, pr: PullRequest): void }) {}
  async poll(): Promise<void> {
    if (this.busy || !this.d.enabled()) return
    this.busy = true
    try {
      for (const { workspaceId, cwd } of this.d.roots()) {
        try {
          const list = await this.d.read(cwd), key = `${workspaceId}:${cwd}`, old = this.previous.get(key)
          const next = new Map(list.map(pr => [pr.number, `${pr.state}:${pr.updatedAt}`]))
          if (old) for (const pr of list) if (old.get(pr.number) !== next.get(pr.number)) this.d.changed(workspaceId, pr)
          this.previous.set(key, next)
        } catch { /* unavailable CLI/login/network is retried; never dump provider output */ }
      }
    } finally { this.busy = false }
  }
}
