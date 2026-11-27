import { execFile } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { LandResult } from '../../shared/model'
import { slugFloorName } from '../domain/floor-name'

const run = promisify(execFile)

/** Sempre `execFile` com argv explícito (nunca shell); sem prompts de credencial. */
export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    })
    return stdout.trimEnd()
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    throw new Error((e.stderr ?? '').trim() || e.message)
  }
}

export async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args)
    return true
  } catch {
    return false
  }
}

export const floorsDirOf = (repoRoot: string): string => `${repoRoot}.floors`

const outsideMessage = (repoRoot: string): string => `a pasta do floor está fora de ${floorsDirOf(repoRoot)}`
const symlinkMessage = (path: string): string => `a pasta do floor passa por um link simbólico: ${path}`

/**
 * Raiz autorizada dos floors, já sem links: o pai real do repositório + `<nome>.floors`.
 * `<repo>.floors` em si não pode ser um link, nem apontar para outro lugar.
 */
export function canonicalFloorsRoot(repoRoot: string): string {
  const root = floorsDirOf(resolve(repoRoot))
  const canonical = join(realpathSync(dirname(root)), basename(root))
  let info
  try {
    info = lstatSync(root)
  } catch {
    return canonical // ainda não existe: será criada por nós
  }
  if (info.isSymbolicLink() || !info.isDirectory() || realpathSync(root) !== canonical) throw new Error(symlinkMessage(root))
  return canonical
}

/**
 * A pasta do floor tem de ficar dentro de `<repo>.floors` de verdade (sem `..`, sem links no caminho):
 * é o que impede apagar ou integrar fora da raiz autorizada.
 */
export function assertContained(repoRoot: string, dir: string): void {
  const root = floorsDirOf(resolve(repoRoot))
  if (!resolve(dir).startsWith(root + sep)) throw new Error(outsideMessage(repoRoot))
  const canonical = canonicalFloorsRoot(repoRoot)
  if (existsSync(dir) && realpathSync(dir) !== join(canonical, relative(root, resolve(dir)))) throw new Error(symlinkMessage(dir))
}

/** O diretório é uma worktree registrada deste repositório (e não uma pasta qualquer, nem de outro repo)? */
async function isRegisteredWorktree(repoRoot: string, dir: string): Promise<boolean> {
  const listed = await git(repoRoot, ['worktree', 'list', '--porcelain'])
  const real = realpathSync(dir)
  return listed
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .some((line) => {
      try {
        return realpathSync(line.slice('worktree '.length)) === real
      } catch {
        return false
      }
    })
}

async function assertRegistered(repoRoot: string, dir: string): Promise<void> {
  if (!(await isRegisteredWorktree(repoRoot, dir))) throw new Error(`a pasta não é uma worktree registrada deste repositório: ${dir}`)
}

export const isDirty = async (dir: string): Promise<boolean> => (await git(dir, ['status', '--porcelain'])) !== ''

/** Branch atual do checkout, ou `null` com HEAD solto. */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    return await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
  } catch {
    return null
  }
}

const PENDING_OPERATIONS = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']

/** Operação git iniciada por outra pessoa (ou processo) e ainda não concluída neste checkout. */
export async function pendingOperation(cwd: string): Promise<string | null> {
  for (const name of PENDING_OPERATIONS) {
    const path = resolve(cwd, await git(cwd, ['rev-parse', '--git-path', name]))
    if (existsSync(path)) return name
  }
  return null
}

/** O git precisa de nome e email para o commit de merge; recusamos antes, com uma mensagem que diz o que fazer. */
export async function hasGitIdentity(cwd: string): Promise<boolean> {
  const configured = async (key: string): Promise<string> => (await git(cwd, ['config', '--get', key]).catch(() => '')).trim()
  const name = process.env.GIT_COMMITTER_NAME || (await configured('user.name'))
  const email = process.env.GIT_COMMITTER_EMAIL || (await configured('user.email'))
  return name !== '' && email !== ''
}

export const branchExists = (repoRoot: string, branch: string): Promise<boolean> =>
  gitOk(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])

/** Raiz do checkout principal, mesmo quando `dir` está dentro de uma worktree de floor. */
export async function repoRootOf(dir: string): Promise<string> {
  try {
    const common = realpathSync(await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
    if (basename(common) === '.git') return dirname(common)
    return realpathSync(await git(dir, ['rev-parse', '--show-toplevel']))
  } catch {
    throw new Error('não é um repositório git')
  }
}

export async function createFloorWorktree(o: {
  repoRoot: string
  name: string
  branch?: string
  from?: string
  /** Checkout de uma branch que já existe (em vez de criar). */
  existingBranch?: boolean
}): Promise<{ dir: string; branch: string; baseRef: string }> {
  const slug = slugFloorName(o.name)
  const dir = join(floorsDirOf(o.repoRoot), slug)
  canonicalFloorsRoot(o.repoRoot) // recusa `<repo>.floors` que seja link, antes de criar qualquer coisa
  if (existsSync(dir)) throw new Error(`a pasta do floor já existe: ${dir}`)

  const branch = o.branch ?? `palco/${slug}`
  if (branch.startsWith('-') || !(await gitOk(o.repoRoot, ['check-ref-format', '--branch', branch]))) {
    throw new Error(`branch inválida: ${branch}`)
  }
  if (o.existingBranch) {
    if (!(await branchExists(o.repoRoot, branch))) throw new Error(`a branch '${branch}' não existe`)
    if ((await currentBranch(o.repoRoot)) === branch) throw new Error(`a branch '${branch}' está em checkout no térreo: uma worktree não pode pegá-la (use --copy)`)
    mkdirSync(floorsDirOf(o.repoRoot), { recursive: true })
    assertContained(o.repoRoot, dir)
    await git(o.repoRoot, ['worktree', 'add', dir, branch])
    return { dir, branch, baseRef: branch }
  }
  if (await branchExists(o.repoRoot, branch)) throw new Error(`a branch '${branch}' já existe`)

  let baseRef: string
  if (o.from !== undefined) {
    if (o.from.startsWith('-') || !(await gitOk(o.repoRoot, ['rev-parse', '--verify', '--quiet', `${o.from}^{commit}`]))) {
      throw new Error(`a ref '${o.from}' não existe`)
    }
    baseRef = o.from
  } else {
    baseRef = (await currentBranch(o.repoRoot)) ?? (await git(o.repoRoot, ['rev-parse', 'HEAD']))
  }

  mkdirSync(floorsDirOf(o.repoRoot), { recursive: true })
  assertContained(o.repoRoot, dir)
  await git(o.repoRoot, ['worktree', 'add', '-b', branch, dir, baseRef])
  return { dir, branch, baseRef }
}

/** Merge de `ref` no checkout do térreo; em caso de conflito aborta só o merge que começou aqui. `null` = integrou. */
export async function mergeIntoGround(repoRoot: string, ref: string, branch: string, into: string): Promise<Extract<LandResult, { ok: false }> | null> {
  try {
    await git(repoRoot, ['merge', '--no-ff', '--no-edit', '-m', `palco: land ${branch}`, ref])
    return null
  } catch (err) {
    // Só um merge iniciado agora (sem pendência antes) pode estar em andamento: aquele é nosso e é o único que abortamos.
    const startedByUs = await pendingOperation(repoRoot)
    if (startedByUs === 'MERGE_HEAD') {
      const conflicts = (await git(repoRoot, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
        .split('\n')
        .filter((line) => line !== '')
      try {
        await git(repoRoot, ['merge', '--abort'])
      } catch {
        return { ok: false, error: 'repositório ficou em merge: resolva manualmente' }
      }
      if (conflicts.length > 0) return { ok: false, error: `conflito no merge de ${branch} em ${into}`, conflicts }
    }
    return { ok: false, error: (err as Error).message.split('\n')[0] ?? 'o merge falhou' }
  }
}

export async function landFloor(o: {
  repoRoot: string
  dir: string
  branch: string
  into?: string
  deleteBranch?: boolean
  /** Worktree do usuário adotada com `floor create --dir` (fora de `<repo>.floors`): basta estar registrada. */
  external?: boolean
}): Promise<LandResult> {
  try {
    if (!o.external) assertContained(o.repoRoot, o.dir)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  if (o.branch.startsWith('-')) return { ok: false, error: `branch inválida: ${o.branch}` }
  try {
    await assertRegistered(o.repoRoot, o.dir)

    // A branch que vale é a que a worktree tem de verdade, não a dos metadados.
    const floorBranch = await currentBranch(o.dir)
    if (floorBranch === null) return { ok: false, error: 'o floor está com HEAD solto (nenhuma branch): volte para a branch do floor' }
    if (floorBranch !== o.branch) return { ok: false, error: `o floor está na branch ${floorBranch}, mas o palco registrou ${o.branch}` }

    // Operação de outra pessoa em andamento: nunca mexemos (e nunca abortamos o que não iniciamos).
    const floorPending = await pendingOperation(o.dir)
    if (floorPending) return { ok: false, error: `o floor tem uma operação git pendente (${floorPending}): conclua ou aborte antes` }
    const mainPending = await pendingOperation(o.repoRoot)
    if (mainPending) return { ok: false, error: `o checkout principal tem uma operação git pendente (${mainPending}): conclua ou aborte antes` }

    if (await isDirty(o.dir)) return { ok: false, error: 'o floor tem mudanças não commitadas' }
    if (await isDirty(o.repoRoot)) return { ok: false, error: 'o checkout principal tem mudanças não commitadas' }
    const current = await currentBranch(o.repoRoot)
    if (current === null) return { ok: false, error: 'o checkout principal está com HEAD solto (nenhuma branch)' }
    const into = o.into ?? current
    if (current !== into) return { ok: false, error: `o checkout principal está em ${current}, não em ${into}` }
    if (!(await hasGitIdentity(o.repoRoot))) return { ok: false, error: 'configure user.name e user.email do git' }

    const failed = await mergeIntoGround(o.repoRoot, o.branch, o.branch, into)
    if (failed) return failed

    if (o.deleteBranch) {
      // A branch está em uso pela worktree do floor: solta o HEAD dela (a pasta continua) e então apaga.
      try {
        await git(o.dir, ['checkout', '--detach'])
        await git(o.repoRoot, ['branch', '-d', o.branch])
      } catch (err) {
        // O merge já foi feito: devolve o floor à branch e diz exatamente o que ficou por fazer.
        await git(o.dir, ['checkout', '--ignore-other-worktrees', o.branch]).catch(() => undefined)
        return {
          ok: false,
          error: `integrado em ${into}, mas a branch ${o.branch} não foi excluída: ${(err as Error).message.split('\n')[0] ?? 'falha ao excluir'}`
        }
      }
    }
    return { ok: true, merged: o.branch, into }
  } catch (err) {
    return { ok: false, error: (err as Error).message.split('\n')[0] ?? 'falha ao integrar o floor' }
  }
}

type RemoveOptions = {
  repoRoot: string
  dir: string
  branch: string
  force?: boolean
  keepBranch?: boolean
}

/**
 * Tudo que pode recusar a remoção, sem mexer em nada: contenção, worktree registrada, mudanças e commits não integrados.
 * Quem precisa parar processos antes de remover chama isto primeiro.
 */
export async function checkFloorRemovable(o: RemoveOptions): Promise<void> {
  assertContained(o.repoRoot, o.dir)
  // Só removemos o que o git conhece como worktree deste repositório; qualquer outra pasta fica intacta.
  if (existsSync(o.dir)) await assertRegistered(o.repoRoot, o.dir)
  if (o.force) return
  if (existsSync(o.dir) && (await isDirty(o.dir))) throw new Error('o floor tem mudanças não commitadas (use --force)')
  const hasBranch = !o.keepBranch && !o.branch.startsWith('-') && (await branchExists(o.repoRoot, o.branch))
  if (hasBranch && !(await gitOk(o.repoRoot, ['merge-base', '--is-ancestor', o.branch, 'HEAD']))) {
    throw new Error(`a branch ${o.branch} tem commits não integrados (use --force ou --keep-branch)`)
  }
}

export async function removeFloorWorktree(o: RemoveOptions): Promise<void> {
  await checkFloorRemovable(o)
  const hasDir = existsSync(o.dir)
  const hasBranch = !o.keepBranch && !o.branch.startsWith('-') && (await branchExists(o.repoRoot, o.branch))
  if (hasDir) await git(o.repoRoot, ['worktree', 'remove', ...(o.force ? ['--force'] : []), o.dir])
  else await git(o.repoRoot, ['worktree', 'prune'])
  if (hasBranch) await git(o.repoRoot, ['branch', o.force ? '-D' : '-d', o.branch])
}

/**
 * Copia para a worktree nova os arquivos não rastreados do térreo (os que o git não ignora): o andar já nasce
 * com o trabalho em andamento. Ignorados (dependências, arquivos de ambiente, saída de build) ficam de fora.
 */
export async function copyUntracked(repoRoot: string, dir: string): Promise<number> {
  const listed = (await git(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => '')).split('\0').filter(Boolean)
  let copied = 0
  for (const rel of listed) {
    const from = join(repoRoot, rel), to = join(dir, rel)
    if (!resolve(to).startsWith(resolve(dir) + sep) || existsSync(to)) continue
    try {
      if (lstatSync(from).isSymbolicLink()) continue
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
      copied++
    } catch { /* arquivo sumiu no meio: segue */ }
  }
  return copied
}

/**
 * O que é a pasta para `floor create --dir`: worktree ligada (vira o checkout do andar), raiz de um repositório
 * (recusada: use `--from`) ou pasta comum (`null`).
 */
export async function inspectFolder(dir: string): Promise<{ kind: 'worktree'; repoRoot: string; branch: string } | { kind: 'repo' } | null> {
  let top: string
  try {
    top = realpathSync(await git(dir, ['rev-parse', '--show-toplevel']))
  } catch {
    return null
  }
  if (top !== realpathSync(dir)) return null
  const root = await repoRootOf(dir)
  if (root === top) return { kind: 'repo' }
  const branch = await currentBranch(dir)
  if (branch === null) throw new Error('a worktree está com HEAD solto (nenhuma branch)')
  return { kind: 'worktree', repoRoot: root, branch }
}
