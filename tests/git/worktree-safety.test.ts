import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFloorWorktree, landFloor, removeFloorWorktree } from '../../src/main/git/worktree'

let sandbox: string
let repo: string

const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null'
}
const IDENTITY_KEYS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']
const saved: Record<string, string | undefined> = {}

// Os comandos de preparação sempre levam identidade própria; o código sob teste herda a do processo.
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim()

const commitFile = (cwd: string, file: string, content: string, message: string): void => {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-m', message)
}

const forgetIdentity = (): void => {
  for (const k of IDENTITY_KEYS) delete process.env[k]
}

beforeEach(() => {
  for (const [k, v] of Object.entries(IDENTITY)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'palco-safe-')))
  repo = join(sandbox, 'projeto')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  commitFile(repo, 'base.txt', 'base\n', 'inicial')
})
afterEach(() => {
  for (const k of Object.keys(IDENTITY)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(sandbox, { recursive: true, force: true })
})

describe('contenção real: links simbólicos e worktrees registradas', () => {
  it('<repo>.floors que é link simbólico: create recusa e nada nasce fora', async () => {
    const outro = join(sandbox, 'outro')
    mkdirSync(outro)
    symlinkSync(outro, `${repo}.floors`)
    await expect(createFloorWorktree({ repoRoot: repo, name: 'ui' })).rejects.toThrow(/link simbólico/)
    expect(existsSync(join(outro, 'ui'))).toBe(false)
    expect(git(repo, 'worktree', 'list')).not.toContain('floors')
  })

  it('floor criado antes de <repo>.floors virar link: land e remove recusam e preservam o conteúdo real', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'a.txt', 'x', 'a')
    const real = join(sandbox, 'real-floors')
    renameSync(`${repo}.floors`, real)
    symlinkSync(real, `${repo}.floors`)
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toMatchObject({ ok: false, error: expect.stringMatching(/link simbólico/) })
    await expect(removeFloorWorktree({ repoRoot: repo, dir: f.dir, branch: f.branch, force: true })).rejects.toThrow(/link simbólico/)
    expect(existsSync(join(real, 'ui', 'a.txt'))).toBe(true)
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('pasta do floor que é link simbólico para outro lugar não é seguida', async () => {
    const alvo = join(sandbox, 'alvo-importante')
    mkdirSync(alvo)
    writeFileSync(join(alvo, 'dado.txt'), 'x')
    mkdirSync(`${repo}.floors`)
    symlinkSync(alvo, `${repo}.floors/evil`)
    await expect(removeFloorWorktree({ repoRoot: repo, dir: `${repo}.floors/evil`, branch: 'x', force: true })).rejects.toThrow(/link simbólico/)
    expect(await landFloor({ repoRoot: repo, dir: `${repo}.floors/evil`, branch: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/link simbólico/) })
    expect(existsSync(join(alvo, 'dado.txt'))).toBe(true)
  })

  it('pasta dentro de .floors que não é worktree registrada deste repositório nunca é removida', async () => {
    mkdirSync(`${repo}.floors/falsa`, { recursive: true })
    writeFileSync(join(`${repo}.floors/falsa`, 'meu.txt'), 'x')
    await expect(removeFloorWorktree({ repoRoot: repo, dir: `${repo}.floors/falsa`, branch: 'x', force: true })).rejects.toThrow(/worktree registrada/)
    expect(existsSync(join(`${repo}.floors/falsa`, 'meu.txt'))).toBe(true)
    expect(await landFloor({ repoRoot: repo, dir: `${repo}.floors/falsa`, branch: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/worktree registrada/) })
  })

  it('worktree de OUTRO repositório dentro da pasta .floors também não é removida', async () => {
    const outroRepo = join(sandbox, 'outro-repo')
    mkdirSync(outroRepo)
    git(outroRepo, 'init', '-b', 'main')
    commitFile(outroRepo, 'x.txt', 'x', 'x')
    mkdirSync(`${repo}.floors`, { recursive: true })
    git(outroRepo, 'worktree', 'add', '-b', 'b', `${repo}.floors/alheia`)
    await expect(removeFloorWorktree({ repoRoot: repo, dir: `${repo}.floors/alheia`, branch: 'b', force: true })).rejects.toThrow(/worktree registrada/)
    expect(existsSync(`${repo}.floors/alheia/x.txt`)).toBe(true)
  })
})

describe('land: operações pendentes', () => {
  /** MERGE_HEAD do usuário com índice e árvore iguais a HEAD: o checkout "parece" limpo. */
  function userMergeInProgress(): void {
    git(repo, 'checkout', '-q', '-b', 'lado')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'lado')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'main')
    git(repo, 'merge', '--no-commit', '--no-ff', 'lado')
  }

  it('merge pendente do usuário: recusa e NÃO aborta o merge dele', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'a.txt', 'x', 'a')
    userMergeInProgress()
    expect(git(repo, 'status', '--porcelain')).toBe('')
    const r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/operação git pendente.*MERGE_HEAD/) })
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true)
  })

  it.each(['rebase-merge', 'rebase-apply'])('%s pendente no principal recusa', async (name) => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    mkdirSync(join(repo, '.git', name))
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toMatchObject({ ok: false, error: expect.stringContaining(name) })
    expect(existsSync(join(repo, '.git', name))).toBe(true)
  })

  it.each(['CHERRY_PICK_HEAD', 'REVERT_HEAD'])('%s pendente no principal recusa', async (name) => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    writeFileSync(join(repo, '.git', name), `${git(repo, 'rev-parse', 'HEAD')}\n`)
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toMatchObject({ ok: false, error: expect.stringContaining(name) })
    expect(existsSync(join(repo, '.git', name))).toBe(true)
  })

  it('operação pendente dentro do floor também recusa', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    const marker = git(f.dir, 'rev-parse', '--git-path', 'rebase-merge')
    mkdirSync(resolve(f.dir, marker))
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toMatchObject({ ok: false, error: expect.stringMatching(/floor.*operação git pendente/) })
  })

  it('o merge do próprio land com conflito ainda é abortado (repositório limpo)', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'base.txt', 'do floor\n', 'floor')
    commitFile(repo, 'base.txt', 'do main\n', 'main')
    const r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(r).toMatchObject({ ok: false, conflicts: ['base.txt'] })
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })
})

describe('land: branch real do floor', () => {
  it('branch trocada na worktree: recusa, não integra a antiga e não mexe em nada', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    git(f.dir, 'checkout', '-q', '-b', 'feature/ui-nova')
    commitFile(f.dir, 'nova.txt', 'x', 'nova')
    const head = git(repo, 'rev-parse', 'HEAD')
    const r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch, deleteBranch: true })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/feature\/ui-nova.*palco\/ui/) })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(f.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/ui-nova')
    expect(git(repo, 'branch', '--list', 'palco/ui')).toContain('palco/ui')
  })

  it('HEAD destacado no floor: recusa com mensagem clara', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    git(f.dir, 'checkout', '-q', '--detach')
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toMatchObject({ ok: false, error: expect.stringMatching(/floor.*HEAD solto/) })
  })
})

describe('land: identidade do git', () => {
  it('sem user.name/user.email recusa com mensagem clara, antes de tentar o merge', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'a.txt', 'x', 'a')
    const head = git(repo, 'rev-parse', 'HEAD')
    forgetIdentity()
    const r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(r).toEqual({ ok: false, error: 'configure user.name e user.email do git' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  })

  it('só o nome configurado também não basta; nome e email na config bastam', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'a.txt', 'x', 'a')
    forgetIdentity()
    git(repo, 'config', 'user.name', 'Fulano')
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toEqual({ ok: false, error: 'configure user.name e user.email do git' })
    git(repo, 'config', 'user.email', 'f@f')
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toMatchObject({ ok: true })
  })
})

describe('land: limpeza parcial com deleteBranch', () => {
  it('branch que não pôde ser excluída vira erro explícito e o floor volta à branch', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'a.txt', 'x', 'a')
    // A mesma branch registrada numa segunda worktree (--force): o `branch -d` vai recusar.
    git(repo, 'worktree', 'add', '--force', join(sandbox, 'dup'), f.branch)
    const r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch, deleteBranch: true })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/integrado em main.*branch palco\/ui não foi excluída/) })
    expect(git(f.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('palco/ui')
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('palco: land palco/ui')
  })
})
