import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { LandResult, PullRequestDetails } from '../../shared/model'
import { slugFloorName } from '../domain/floor-name'
import { assertContained, branchExists, canonicalFloorsRoot, currentBranch, floorsDirOf, git, gitOk, hasGitIdentity, isDirty, mergeIntoGround, pendingOperation } from './worktree'

const run = promisify(execFile)

/** Como o clone é feito (injetável para testes). */
export interface Cloner { supported(dir: string): Promise<boolean>; copy(from: string, to: string): Promise<void> }

/** O disco clona na hora (copy-on-write)? Testa com um arquivo temporário em `dir`. */
export async function canCloneInstantly(dir: string): Promise<boolean> {
  const probe = join(dir, `.palco-cow-probe-${randomUUID()}`), clone = `${probe}-clone`
  try {
    writeFileSync(probe, 'palco', { flag: 'wx' })
    await run('cp', ['--reflink=always', '--', probe, clone])
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { force: true }); rmSync(clone, { force: true })
  }
}
export const reflinkCloner: Cloner = {
  supported: canCloneInstantly,
  copy: async (from, to) => { await run('cp', ['-R', '-P', '--reflink=always', '--', from, to], { maxBuffer: 1024 * 1024 }) }
}

/** Uma cópia do palco: pasta com o próprio `.git` (nunca uma worktree nem uma pasta qualquer). */
const isClone = (dir: string): boolean => { try { return lstatSync(join(dir, '.git')).isDirectory() } catch { return false } }

const validBranch = async (cwd: string, branch: string): Promise<boolean> => !branch.startsWith('-') && gitOk(cwd, ['check-ref-format', '--branch', branch])

/**
 * Clona o repositório "como está agora" para a pasta do andar. `prepare` (pull request) cria a branch dentro do clone;
 * sem ele, a branch é nova (padrão `palco/<nome>`) ou uma existente, inclusive a mesma do térreo.
 */
export async function createFloorClone(o: { repoRoot: string; name: string; branch?: string; existingBranch?: boolean; prepare?: (dir: string) => Promise<string> }, cloner: Cloner = reflinkCloner): Promise<{ dir: string; branch: string; baseRef: string }> {
  const slug = slugFloorName(o.name)
  const dir = join(floorsDirOf(o.repoRoot), slug)
  if (!isClone(o.repoRoot)) throw new Error('--copy precisa de um repositório com .git próprio (não uma worktree)')
  canonicalFloorsRoot(o.repoRoot)
  if (existsSync(dir)) throw new Error(`a pasta do floor já existe: ${dir}`)
  let branch = o.branch ?? `palco/${slug}`
  if (!o.prepare) {
    if (!(await validBranch(o.repoRoot, branch))) throw new Error(`branch inválida: ${branch}`)
    const exists = await branchExists(o.repoRoot, branch)
    if (o.existingBranch && !exists) throw new Error(`a branch '${branch}' não existe`)
    if (!o.existingBranch && exists) throw new Error(`a branch '${branch}' já existe`)
  }
  const pending = await pendingOperation(o.repoRoot)
  if (pending || existsSync(join(o.repoRoot, '.git', 'index.lock'))) throw new Error('o checkout principal tem uma operação git em andamento: conclua antes de copiar')
  if (!(await cloner.supported(dirname(o.repoRoot)))) throw new Error('o disco não clona na hora (copy-on-write): crie o andar sem --copy')
  const baseRef = (await currentBranch(o.repoRoot)) ?? (await git(o.repoRoot, ['rev-parse', 'HEAD']))
  mkdirSync(floorsDirOf(o.repoRoot), { recursive: true })
  assertContained(o.repoRoot, dir)
  try {
    await cloner.copy(o.repoRoot, dir)
    // As worktrees do térreo não são desta cópia.
    rmSync(join(dir, '.git', 'worktrees'), { recursive: true, force: true })
    if (o.prepare) { branch = await o.prepare(dir); await git(dir, ['checkout', branch, '--']) }
    else if (o.existingBranch) await git(dir, ['checkout', branch, '--'])
    else await git(dir, ['checkout', '-b', branch])
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  return { dir, branch, baseRef }
}

type CloneTarget = { repoRoot: string; dir: string; branch: string; force?: boolean; keepBranch?: boolean }

/** O commit já está no projeto, alcançável por alguma ref dele. */
const inProject = async (repoRoot: string, sha: string): Promise<boolean> =>
  (await git(repoRoot, ['for-each-ref', '--count=1', '--contains', sha, '--format=%(refname)']).catch(() => '')) !== ''

/** Tudo que pode recusar apagar a cópia, sem mexer em nada: o que só existe nela se perderia. */
export async function checkCloneRemovable(o: CloneTarget): Promise<void> {
  assertContained(o.repoRoot, o.dir)
  if (!existsSync(o.dir)) return
  if (!isClone(o.dir)) throw new Error(`a pasta não é uma cópia do repositório: ${o.dir}`)
  if (o.force) return
  if (await isDirty(o.dir)) throw new Error('o floor tem mudanças não commitadas (use --force)')
  const refs = (await git(o.dir, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/stash'])).split('\n').filter(Boolean)
  const detached = (await currentBranch(o.dir)) === null ? [`${await git(o.dir, ['rev-parse', 'HEAD'])} HEAD`] : []
  for (const line of [...refs, ...detached]) {
    const [sha, ref] = line.split(' ') as [string, string]
    if (o.keepBranch && ref === `refs/heads/${o.branch}`) continue
    if (!(await inProject(o.repoRoot, sha))) throw new Error(`a branch ${ref.replace('refs/heads/', '')} tem commits não integrados (use --force ou --keep-branch)`)
  }
}

export async function removeClone(o: CloneTarget): Promise<void> {
  await checkCloneRemovable(o)
  if (!existsSync(o.dir)) return
  // "Manter a branch" numa cópia é trazê-la para o projeto antes de apagar a pasta; se não der, nada é apagado.
  if (o.keepBranch && !o.force && (await validBranch(o.repoRoot, o.branch)) && (await branchExists(o.dir, o.branch)) && !(await inProject(o.repoRoot, await git(o.dir, ['rev-parse', `refs/heads/${o.branch}`])))) {
    await git(o.repoRoot, ['fetch', '--no-tags', o.dir, `refs/heads/${o.branch}:refs/heads/${o.branch}`])
  }
  rmSync(o.dir, { recursive: true, force: true })
}

/** Land de uma cópia: o térreo busca a branch dela e faz o merge, com as mesmas recusas do land de worktree. */
export async function landClone(o: { repoRoot: string; dir: string; branch: string; into?: string; deleteBranch?: boolean }): Promise<LandResult> {
  const refuse = (error: string): LandResult => ({ ok: false, error })
  try {
    assertContained(o.repoRoot, o.dir)
    if (!isClone(o.dir)) return refuse(`a pasta não é uma cópia do repositório: ${o.dir}`)
    if (!(await validBranch(o.repoRoot, o.branch))) return refuse(`branch inválida: ${o.branch}`)
    const floorBranch = await currentBranch(o.dir)
    if (floorBranch === null) return refuse('o floor está com HEAD solto (nenhuma branch): volte para a branch do floor')
    if (floorBranch !== o.branch) return refuse(`o floor está na branch ${floorBranch}, mas o palco registrou ${o.branch}`)
    const floorPending = await pendingOperation(o.dir)
    if (floorPending) return refuse(`o floor tem uma operação git pendente (${floorPending}): conclua ou aborte antes`)
    const mainPending = await pendingOperation(o.repoRoot)
    if (mainPending) return refuse(`o checkout principal tem uma operação git pendente (${mainPending}): conclua ou aborte antes`)
    if (await isDirty(o.dir)) return refuse('o floor tem mudanças não commitadas')
    if (await isDirty(o.repoRoot)) return refuse('o checkout principal tem mudanças não commitadas')
    const current = await currentBranch(o.repoRoot)
    if (current === null) return refuse('o checkout principal está com HEAD solto (nenhuma branch)')
    const into = o.into ?? current
    if (current !== into) return refuse(`o checkout principal está em ${current}, não em ${into}`)
    if (!(await hasGitIdentity(o.repoRoot))) return refuse('configure user.name e user.email do git')
    // Na mesma branch do térreo não dá para buscar por cima do checkout: o merge parte do que foi buscado.
    const same = o.branch === into
    try { await git(o.repoRoot, ['fetch', '--no-tags', o.dir, same ? `refs/heads/${o.branch}` : `refs/heads/${o.branch}:refs/heads/${o.branch}`]) }
    catch { return refuse(`a branch ${o.branch} do projeto seguiu outro caminho: integre manualmente`) }
    const failed = await mergeIntoGround(o.repoRoot, same ? await git(o.repoRoot, ['rev-parse', 'FETCH_HEAD']) : o.branch, o.branch, into)
    if (failed) return failed
    if (o.deleteBranch && !same) await git(o.repoRoot, ['branch', '-d', o.branch])
    return { ok: true, merged: o.branch, into }
  } catch (err) {
    return refuse((err as Error).message.split('\n')[0] ?? 'falha ao integrar o floor')
  }
}

/** A branch do andar de um pull request: a dele, se é do próprio repositório; senão uma cópia local `pr-N`. */
export const pullRequestBranch = (pr: Pick<PullRequestDetails, 'number' | 'headBranch' | 'sameRepository'>): string => (pr.sameRepository ? pr.headBranch : `pr-${pr.number}`)

/** Traz os commits do pull request e deixa a branch local pronta, sem nunca passar por cima de trabalho do usuário. */
export async function preparePullRequestBranch(repoRoot: string, pr: PullRequestDetails): Promise<{ branch: string }> {
  const branch = pullRequestBranch(pr)
  if (!(await validBranch(repoRoot, branch))) throw new Error(`branch inválida: ${branch}`)
  if (!/^refs\/(pull|merge-requests)\/\d+\/head$/.test(pr.ref)) throw new Error('ref de pull request inválida')
  await git(repoRoot, ['fetch', '--no-tags', 'origin', pr.ref])
  const sha = await git(repoRoot, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
  if (pr.headSha && sha !== pr.headSha) throw new Error(`o pull request #${pr.number} mudou enquanto era buscado: tente de novo`)
  if (await branchExists(repoRoot, branch)) {
    const setting = async (key: string): Promise<string> => (await git(repoRoot, ['config', '--get', `branch.${branch}.${key}`]).catch(() => '')).trim()
    const remote = await setting('remote'), merge = await setting('merge')
    if (pr.sameRepository && ((remote && remote !== 'origin') || (merge && merge !== `refs/heads/${branch}`))) throw new Error(`a sua branch local ${branch} envia para outro lugar`)
    if (!(await gitOk(repoRoot, ['merge-base', '--is-ancestor', branch, sha]))) throw new Error(`a sua branch local ${branch} seguiu outro caminho`)
    if ((await git(repoRoot, ['rev-parse', `refs/heads/${branch}`])) !== sha) await git(repoRoot, ['branch', '-f', branch, sha])
  } else await git(repoRoot, ['branch', '--no-track', branch, sha])
  if (pr.sameRepository) {
    await git(repoRoot, ['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
    await git(repoRoot, ['branch', `--set-upstream-to=origin/${branch}`, branch])
  }
  return { branch }
}
