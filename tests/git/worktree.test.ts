import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFloorWorktree, landFloor, removeFloorWorktree, repoRootOf } from '../../src/main/git/worktree'

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
const saved: Record<string, string | undefined> = {}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim()

const commitFile = (cwd: string, file: string, content: string, message: string): void => {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-m', message)
}

beforeEach(() => {
  // O código sob teste herda a identidade do processo: o merge do land precisa de autor.
  for (const [k, v] of Object.entries(IDENTITY)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'palco-git-')))
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

describe('repoRootOf', () => {
  it('acha a raiz a partir de uma subpasta e a do checkout principal a partir de uma worktree', async () => {
    mkdirSync(join(repo, 'sub/dir'), { recursive: true })
    expect(await repoRootOf(join(repo, 'sub/dir'))).toBe(repo)
    const floor = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    expect(await repoRootOf(floor.dir)).toBe(repo)
  })

  it('fora de um repositório (ou pasta inexistente) lança erro claro', async () => {
    await expect(repoRootOf(sandbox)).rejects.toThrow('não é um repositório git')
    await expect(repoRootOf(join(sandbox, 'nao-existe'))).rejects.toThrow('não é um repositório git')
  })
})

describe('createFloorWorktree', () => {
  it('cria <repo>.floors/<slug> numa branch palco/<slug> e não troca a branch do principal', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    expect(f).toEqual({ dir: `${repo}.floors/ui`, branch: 'palco/ui', baseRef: 'main' })
    expect(existsSync(join(f.dir, 'base.txt'))).toBe(true)
    expect(git(f.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('palco/ui')
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(git(repo, 'worktree', 'list')).toContain(`${repo}.floors/ui`)
  })

  it('aceita branch e ref de origem próprios', async () => {
    git(repo, 'branch', 'dev')
    commitFile(repo, 'so-main.txt', 'x', 'so no main')
    const f = await createFloorWorktree({ repoRoot: repo, name: 'api', branch: 'feature/api', from: 'dev' })
    expect(f.branch).toBe('feature/api')
    expect(f.baseRef).toBe('dev')
    expect(existsSync(join(f.dir, 'so-main.txt'))).toBe(false)
  })

  it('o nome vira slug: acentos, espaços e ../ não escapam da pasta .floors', async () => {
    const a = await createFloorWorktree({ repoRoot: repo, name: 'Ação ../x' })
    expect(a.dir).toBe(`${repo}.floors/acao-x`)
    expect(a.branch).toBe('palco/acao-x')
    expect(existsSync(join(sandbox, 'x'))).toBe(false)
  })

  it('recusa pasta ou branch que já existem, inclusive colisão depois do slug', async () => {
    await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    await expect(createFloorWorktree({ repoRoot: repo, name: 'UI' })).rejects.toThrow(/já existe/)
    await expect(createFloorWorktree({ repoRoot: repo, name: 'u i' })).resolves.toBeDefined() // 'u-i' é outro slug
    git(repo, 'branch', 'palco/outro')
    await expect(createFloorWorktree({ repoRoot: repo, name: 'outro' })).rejects.toThrow(/branch .* já existe/)
  })

  it('recusa nome inválido, branch inválida e ref de origem inexistente ou com cara de opção', async () => {
    await expect(createFloorWorktree({ repoRoot: repo, name: '../..' })).rejects.toThrow('nome de floor inválido')
    await expect(createFloorWorktree({ repoRoot: repo, name: 'a', branch: '-x' })).rejects.toThrow(/branch inválida/)
    await expect(createFloorWorktree({ repoRoot: repo, name: 'a', branch: 'a..b' })).rejects.toThrow(/branch inválida/)
    await expect(createFloorWorktree({ repoRoot: repo, name: 'a', from: 'nao-existe' })).rejects.toThrow(/ref .* não existe/)
    await expect(createFloorWorktree({ repoRoot: repo, name: 'a', from: '--help' })).rejects.toThrow(/ref .* não existe/)
    expect(existsSync(`${repo}.floors/a`)).toBe(false)
  })

  it('usa execFile: metacaracteres de shell na branch ficam literais e nada é executado', async () => {
    const marker = join(sandbox, 'pwned')
    const branch = `feat;touch$IFS${marker}`
    const f = await createFloorWorktree({ repoRoot: repo, name: 'sh', branch })
    expect(f.branch).toBe(branch)
    expect(existsSync(marker)).toBe(false)
    expect(git(repo, 'rev-parse', '--verify', `refs/heads/${branch}`)).toMatch(/^[0-9a-f]{40}$/)
  })

  it('sem branch atual (HEAD solto) parte do commit e registra o baseRef', async () => {
    git(repo, 'checkout', '--detach')
    const f = await createFloorWorktree({ repoRoot: repo, name: 'solto' })
    expect(f.baseRef).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('landFloor', () => {
  it('integra com merge --no-ff e mensagem do palco, sem trocar a branch do principal', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'ui.txt', 'tela\n', 'tela nova')
    const r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(r).toEqual({ ok: true, merged: 'palco/ui', into: 'main' })
    expect(readFileSync(join(repo, 'ui.txt'), 'utf8')).toBe('tela\n')
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('palco: land palco/ui')
    expect(git(repo, 'log', '--merges', '--format=%s')).toBe('palco: land palco/ui')
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('deleteBranch apaga a branch integrada e mantém a pasta do floor (solta)', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'ui.txt', 'x', 'x')
    const r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch, deleteBranch: true })
    expect(r.ok).toBe(true)
    expect(git(repo, 'branch', '--list', 'palco/ui')).toBe('')
    expect(existsSync(f.dir)).toBe(true)
    await expect(removeFloorWorktree({ repoRoot: repo, dir: f.dir, branch: f.branch })).resolves.toBeUndefined()
    expect(existsSync(f.dir)).toBe(false)
  })

  it('floor sem nada novo também conta como integrado', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'vazio' })
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toEqual({ ok: true, merged: 'palco/vazio', into: 'main' })
  })

  it('conflito: aborta o merge, devolve os arquivos e deixa o repositório limpo', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'base.txt', 'versao do floor\n', 'floor mexe')
    commitFile(f.dir, 'so-floor.txt', 'x', 'outro')
    commitFile(repo, 'base.txt', 'versao do main\n', 'main mexe')
    const head = git(repo, 'rev-parse', 'HEAD')
    const r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.conflicts).toEqual(['base.txt'])
      expect(r.error).toMatch(/conflito/)
    }
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(readFileSync(join(repo, 'base.txt'), 'utf8')).toBe('versao do main\n')
  })

  it('recusa floor com mudanças (rastreadas ou novas) e checkout principal com mudanças', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    writeFileSync(join(f.dir, 'novo.txt'), 'x')
    let r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/floor.*mudanças não commitadas/) })
    rmSync(join(f.dir, 'novo.txt'))
    writeFileSync(join(f.dir, 'base.txt'), 'mudou')
    r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(r.ok).toBe(false)
    git(f.dir, 'checkout', '--', 'base.txt')
    writeFileSync(join(repo, 'sujo.txt'), 'x')
    r = await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/checkout principal.*mudanças não commitadas/) })
  })

  it('recusa quando o principal está em outra branch que a pedida', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    git(repo, 'checkout', '-b', 'trabalho')
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch, into: 'main' })).toEqual({
      ok: false,
      error: 'o checkout principal está em trabalho, não em main'
    })
    // sem `into`, integra na branch atual
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toEqual({ ok: true, merged: 'palco/ui', into: 'trabalho' })
  })

  it('recusa checkout principal com HEAD solto e pasta fora de .floors', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    expect(await landFloor({ repoRoot: repo, dir: repo, branch: f.branch })).toMatchObject({ ok: false, error: expect.stringMatching(/fora de/) })
    git(repo, 'checkout', '--detach')
    expect(await landFloor({ repoRoot: repo, dir: f.dir, branch: f.branch })).toMatchObject({ ok: false, error: expect.stringMatching(/HEAD solto|nenhuma branch/) })
  })
})

describe('removeFloorWorktree', () => {
  it('remove a pasta e a branch integrada', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    await removeFloorWorktree({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(existsSync(f.dir)).toBe(false)
    expect(git(repo, 'branch', '--list', 'palco/ui')).toBe('')
    expect(git(repo, 'worktree', 'list')).not.toContain('.floors')
  })

  it('floor com mudanças recusa sem force e nada é tocado; com force remove', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    writeFileSync(join(f.dir, 'rascunho.txt'), 'x')
    await expect(removeFloorWorktree({ repoRoot: repo, dir: f.dir, branch: f.branch })).rejects.toThrow(/mudanças não commitadas/)
    expect(existsSync(join(f.dir, 'rascunho.txt'))).toBe(true)
    expect(git(repo, 'branch', '--list', 'palco/ui')).toContain('palco/ui')
    await removeFloorWorktree({ repoRoot: repo, dir: f.dir, branch: f.branch, force: true })
    expect(existsSync(f.dir)).toBe(false)
    expect(git(repo, 'branch', '--list', 'palco/ui')).toBe('')
  })

  it('branch com commits não integrados recusa sem force (nada é removido); force usa -D; keepBranch preserva', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    commitFile(f.dir, 'trabalho.txt', 'x', 'trabalho')
    await expect(removeFloorWorktree({ repoRoot: repo, dir: f.dir, branch: f.branch })).rejects.toThrow(/não integrados/)
    expect(existsSync(f.dir)).toBe(true)
    await removeFloorWorktree({ repoRoot: repo, dir: f.dir, branch: f.branch, keepBranch: true })
    expect(existsSync(f.dir)).toBe(false)
    expect(git(repo, 'branch', '--list', 'palco/ui')).toContain('palco/ui')

    const g = await createFloorWorktree({ repoRoot: repo, name: 'api' })
    commitFile(g.dir, 'a.txt', 'x', 'a')
    await removeFloorWorktree({ repoRoot: repo, dir: g.dir, branch: g.branch, force: true })
    expect(git(repo, 'branch', '--list', 'palco/api')).toBe('')
  })

  it('pasta do floor já apagada à mão: poda a worktree e segue', async () => {
    const f = await createFloorWorktree({ repoRoot: repo, name: 'ui' })
    rmSync(f.dir, { recursive: true, force: true })
    await removeFloorWorktree({ repoRoot: repo, dir: f.dir, branch: f.branch })
    expect(git(repo, 'worktree', 'list')).not.toContain('.floors')
    expect(git(repo, 'branch', '--list', 'palco/ui')).toBe('')
  })

  it('só remove pastas dentro de <repo>.floors', async () => {
    await expect(removeFloorWorktree({ repoRoot: repo, dir: repo, branch: 'main', force: true })).rejects.toThrow(/fora de/)
    await expect(removeFloorWorktree({ repoRoot: repo, dir: sandbox, branch: 'x', force: true })).rejects.toThrow(/fora de/)
    expect(existsSync(join(repo, 'base.txt'))).toBe(true)
  })
})
