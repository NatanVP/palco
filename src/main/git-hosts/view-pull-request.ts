import type { PullRequestDetails } from '../../shared/model'
import type { GitHostSpec, GitRunner } from './git-hosts'

/** `git@host:dono/repo.git` ou URL → host e caminho do repositório, sem `.git`. */
function remoteAddress(remote: string): { host: string; path: string } | null {
  const scp = /^(?:[^@\s/]+@)?([^:\s/]+):(?!\/\/)(.+)$/.exec(remote)
  const parts = scp ? { host: scp[1]!, path: scp[2]! } : (() => { try { const u = new URL(remote); return { host: u.hostname, path: u.pathname } } catch { return null } })()
  return parts && { host: parts.host.toLowerCase(), path: parts.path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').toLowerCase() }
}

function requestNumber(reference: string, remote: { host: string; path: string }): number {
  const plain = /^#?([1-9]\d{0,8})$/.exec(reference.trim())
  if (plain) return Number(plain[1])
  let url: URL
  try { url = new URL(reference.trim()) } catch { throw new Error('informe o número (42, #42) ou o link do pull request') }
  const found = /^\/(.+?)\/(?:pull|-\/merge_requests)\/([1-9]\d{0,8})\/?$/.exec(url.pathname)
  if (!found) throw new Error('o link não é de um pull request')
  if (url.hostname.toLowerCase() !== remote.host || found[1]!.toLowerCase() !== remote.path) throw new Error('o link é de outro repositório')
  return Number(found[2])
}

/** Pergunta um pull request ao provedor do `origin`. Só os formatos do `gh` e do `glab` sabem mostrar um. */
export async function viewPullRequest(specs: GitHostSpec[], run: GitRunner, cwd: string, reference: string): Promise<PullRequestDetails> {
  let remote: { host: string; path: string } | null = null
  try { remote = remoteAddress((await run('git', ['remote', 'get-url', 'origin'], cwd)).trim()) } catch { /* sem origin */ }
  if (!remote) throw new Error('o repositório não tem um origin: nenhum provedor para consultar')
  const spec = specs.find((p) => p.protocol !== 'json' && p.hosts.includes(remote!.host))
  if (!spec) throw new Error('nenhum provedor de pull requests para este repositório')
  const number = requestNumber(reference, remote), github = spec.protocol === 'github'
  let raw: unknown
  try {
    raw = JSON.parse(await run(spec.command, github ? ['pr', 'view', String(number), '--json', 'number,title,state,url,headRefName,headRefOid,isCrossRepository'] : ['mr', 'view', String(number), '--output', 'json'], cwd))
  } catch { throw new Error(`o provedor não mostrou o pull request #${number} (a CLI está instalada e autenticada?)`) }
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const found = github
    ? { number: v.number, title: v.title, state: v.state, url: v.url, headBranch: v.headRefName, headSha: v.headRefOid, sameRepository: v.isCrossRepository === false }
    : { number: v.iid, title: v.title, state: v.state === 'opened' ? 'OPEN' : v.state, url: v.web_url, headBranch: v.source_branch, headSha: v.sha, sameRepository: typeof v.source_project_id === 'number' && v.source_project_id === v.target_project_id }
  if (found.number !== number || typeof found.title !== 'string' || typeof found.state !== 'string' || typeof found.url !== 'string' || !/^https?:\/\//.test(found.url) || typeof found.headBranch !== 'string' || typeof found.headSha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(found.headSha)) {
    throw new Error('a resposta do provedor veio sem os campos do pull request')
  }
  return { number, title: found.title.slice(0, 500), state: found.state.toUpperCase(), url: found.url, headBranch: found.headBranch, headSha: found.headSha.toLowerCase(), sameRepository: found.sameRepository, ref: `refs/${github ? 'pull' : 'merge-requests'}/${number}/head` }
}
