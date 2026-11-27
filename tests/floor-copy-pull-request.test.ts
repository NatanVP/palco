// `floor create --copy` (clone independente) e `--pull-request`.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs } from '../src/cli/args'
import { canCloneInstantly, createFloorClone, preparePullRequestBranch } from '../src/main/git/floor-clone'
import { FloorService, type GitOps } from '../src/main/floors/floor-service'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { GitHosts } from '../src/main/git-hosts/git-hosts'
import type { PullRequestDetails } from '../src/shared/model'
import http from 'node:http'
import { AskBroker } from '../src/main/ask/ask-broker'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { startServer } from '../src/main/server/http-server'
import { HEADER_TOKEN } from '../src/shared/auth'

// Sempre fora de qualquer repositório: um caso "sem git" nunca pode achar o repositório do próprio projeto.
let dir: string, repo: string, store: WorkspaceStore
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commit = (cwd: string, file: string, text: string): string => { writeFileSync(join(cwd, file), text); sh(cwd, 'add', file); sh(cwd, 'commit', '-qm', file); return sh(cwd, 'rev-parse', 'HEAD') }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'palco-floor-copy-pr-')); repo = join(dir, 'proj'); mkdirSync(repo)
  sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'config', 'user.name', 'T'); sh(repo, 'config', 'user.email', 't@x')
  writeFileSync(join(repo, '.gitignore'), 'dep/\n'); sh(repo, 'add', '.gitignore'); commit(repo, 'a.txt', 'um\n')
  store = new WorkspaceStore(join(dir, 'ws.json'))
})
afterEach(() => { store.dispose(); rmSync(dir, { recursive: true, force: true }) })
// Nos testes a cópia é comum: o que se verifica é o comportamento do andar, não o do sistema de arquivos.
const plainCopy = { supported: async () => true, copy: async (from: string, to: string) => { cpSync(from, to, { recursive: true, verbatimSymlinks: true }) } }
const service = (over: Partial<GitOps> = {}, extra: object = {}) => new FloorService({ store, terminals: { dispose: () => {} }, cloner: plainCopy, ...extra, ...(Object.keys(over).length ? { git: over as GitOps } : {}) })
const copyFloor = async (name = 'Cópia', input: object = {}) => service().create({ name, fromDir: repo, copy: true, ...input })

describe('linha de comando', () => {
  it('aceita --copy e --pull-request, com o nome opcional no pull request', () => {
    expect(parseArgs(['floor', 'create', 'X', '--copy'])).toMatchObject({ cmd: 'floor-create', name: 'X', copy: true })
    expect(parseArgs(['floor', 'create', '--pull-request', '42'])).toMatchObject({ cmd: 'floor-create', pullRequest: '42' })
    expect(parseArgs(['floor', 'create', 'Rev', '--pull-request', '#7', '--copy', '--copy-ground'])).toMatchObject({ name: 'Rev', pullRequest: '#7', copy: true, copyGround: true })
    expect(parseArgs(['floor', 'create', '--pull-request', 'https://github.com/a/b/pull/42'])).toMatchObject({ pullRequest: 'https://github.com/a/b/pull/42' })
  })
  it('recusa combinações que não se aplicam e números ruins', () => {
    for (const args of [['X', '--copy', '--dir', 'd'], ['--pull-request', '1', '--branch', 'b'], ['--pull-request', '1', '--no-git'], ['--pull-request', '1', '--dir', 'd'], ['--pull-request', 'abc'], ['--pull-request', '0'], []]) expect(() => parseArgs(['floor', 'create', ...args]), args.join(' ')).toThrow()
  })
})

describe('--copy', () => {
  it('leva o repositório como está agora: mudanças, arquivos novos e ignorados, numa branch própria, sem tocar no térreo', async () => {
    writeFileSync(join(repo, 'a.txt'), 'mudado\n'); writeFileSync(join(repo, 'novo.txt'), 'n'); mkdirSync(join(repo, 'dep')); writeFileSync(join(repo, 'dep', 'lib'), 'l')
    const floor = await copyFloor('Meu Teste')
    expect(floor).toMatchObject({ copy: true, branch: 'palco/meu-teste', baseRef: 'main', dir: join(`${repo}.floors`, 'meu-teste') })
    expect(statSync(join(floor.dir, '.git')).isDirectory()).toBe(true)
    for (const [f, text] of [['a.txt', 'mudado\n'], ['novo.txt', 'n'], ['dep/lib', 'l']]) expect(readFileSync(join(floor.dir, f!), 'utf8')).toBe(text)
    expect(sh(floor.dir, 'branch', '--show-current')).toBe('palco/meu-teste'); expect(sh(repo, 'branch', '--show-current')).toBe('main'); expect(sh(repo, 'branch', '--list', 'palco/*')).toBe('')
  })
  it('pode usar a mesma branch do térreo', async () => {
    const floor = await copyFloor('Igual', { branch: 'main', existingBranch: true })
    expect(floor.branch).toBe('main'); expect(sh(floor.dir, 'branch', '--show-current')).toBe('main')
  })
  it('é recusado quando o disco não clona na hora, quando o repositório não tem .git próprio e sem git; nada fica para trás', async () => {
    await expect(service({}, { cloner: { ...plainCopy, supported: async () => false } }).create({ name: 'N', fromDir: repo, copy: true })).rejects.toThrow(/clona na hora/)
    sh(repo, 'worktree', 'add', '-q', join(dir, 'wt'), '-b', 'outra')
    await expect(createFloorClone({ repoRoot: join(dir, 'wt'), name: 'N' }, plainCopy)).rejects.toThrow(/\.git próprio/)
    const plain = join(dir, 'solta'); mkdirSync(plain)
    await expect(service().create({ name: 'S', fromDir: plain, copy: true })).rejects.toThrow(/repositório git/)
    expect(existsSync(`${repo}.floors/n`)).toBe(false); expect(store.get().floors).toEqual({})
  })
  it('o clone não herda as worktrees do térreo', async () => {
    sh(repo, 'worktree', 'add', '-q', join(dir, 'wt'), '-b', 'outra')
    const floor = await copyFloor()
    expect(sh(floor.dir, 'worktree', 'list').split('\n')).toHaveLength(1)
  })
  it('apagar o último andar remove só a pasta .floors vazia', async () => {
    const floor = await copyFloor('Unico')
    await service().remove(floor.id)
    expect(existsSync(floor.dir)).toBe(false)
    expect(existsSync(`${repo}.floors`)).toBe(false)

    const keep = join(`${repo}.floors`, 'dados-externos.txt')
    mkdirSync(`${repo}.floors`, { recursive: true }); writeFileSync(keep, 'preservar')
    const second = await copyFloor('Com Reserva')
    await service().remove(second.id)
    expect(readFileSync(keep, 'utf8')).toBe('preservar')
    expect(existsSync(`${repo}.floors`)).toBe(true)
  })
  it('a verificação real do disco responde sem deixar arquivos', async () => {
    const answer = await canCloneInstantly(dir)
    expect(typeof answer).toBe('boolean'); expect(execFileSync('ls', ['-A', dir], { encoding: 'utf8' })).not.toContain('palco-cow')
  })
  it('land traz o trabalho de volta para o térreo, inclusive na mesma branch', async () => {
    const floor = await copyFloor('Um'); commit(floor.dir, 'b.txt', 'dois\n')
    expect(await service().land(floor.id)).toMatchObject({ ok: true, merged: 'palco/um', into: 'main' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('dois\n'); expect(sh(repo, 'branch', '--list', 'palco/um')).toContain('palco/um'); expect(existsSync(floor.dir)).toBe(false); expect(existsSync(`${repo}.floors`)).toBe(false); expect(store.get().floors).toEqual({})
    const same = await copyFloor('Dois', { branch: 'main', existingBranch: true }); commit(same.dir, 'c.txt', 'três\n')
    expect(await service().land(same.id)).toMatchObject({ ok: true, into: 'main' }); expect(readFileSync(join(repo, 'c.txt'), 'utf8')).toBe('três\n')
  })
  it('land recusa com trabalho não commitado, sem mudar nada', async () => {
    const floor = await copyFloor(); writeFileSync(join(floor.dir, 'x'), 'x')
    expect(await service().land(floor.id)).toMatchObject({ ok: false, error: expect.stringContaining('não commitadas') }); expect(existsSync(floor.dir)).toBe(true)
  })
  it('apagar recusa commits que só existem no clone; --keep-branch os leva para o projeto; --force apaga', async () => {
    const a = await copyFloor('A'); const sha = commit(a.dir, 'b.txt', 'b\n')
    await expect(service().remove(a.id)).rejects.toThrow(/não integrados/); expect(existsSync(a.dir)).toBe(true)
    await service().remove(a.id, { keepBranch: true }); expect(existsSync(a.dir)).toBe(false); expect(sh(repo, 'rev-parse', 'palco/a')).toBe(sha)
    const b = await copyFloor('B'); sh(b.dir, 'checkout', '-q', '-b', 'escondida'); commit(b.dir, 'c.txt', 'c\n'); sh(b.dir, 'checkout', '-q', 'palco/b')
    await expect(service().remove(b.id)).rejects.toThrow(/não integrados/)
    await service().remove(b.id, { force: true }); expect(existsSync(b.dir)).toBe(false); expect(existsSync(join(repo, 'a.txt'))).toBe(true)
  })
  it('um andar de cópia sem nada novo é apagado sem --force, e o térreo não é tocado', async () => {
    const f = await copyFloor('Limpo'); await service().remove(f.id); expect(existsSync(f.dir)).toBe(false); expect(sh(repo, 'status', '--porcelain')).toBe('')
  })
})

describe('--pull-request', () => {
  let origin: string, head: string
  const details = (over: Partial<PullRequestDetails> = {}): PullRequestDetails => ({ number: 42, title: 'Corrige o login', state: 'OPEN', url: 'https://github.com/acme/app/pull/42', headBranch: 'fix-login', headSha: head, sameRepository: true, ref: 'refs/pull/42/head', ...over })
  beforeEach(() => {
    origin = join(dir, 'origin.git'); execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]); sh(repo, 'remote', 'add', 'origin', origin); sh(repo, 'push', '-q', 'origin', 'main')
    sh(repo, 'checkout', '-q', '-b', 'tmp'); head = commit(repo, 'pr.txt', 'pr\n'); sh(repo, 'push', '-q', 'origin', 'tmp:fix-login', 'tmp:refs/pull/42/head'); sh(repo, 'checkout', '-q', 'main'); sh(repo, 'branch', '-qD', 'tmp'); sh(repo, 'update-ref', '-d', 'refs/remotes/origin/fix-login')
  })
  const create = (found: PullRequestDetails, input: object = {}) => service({}, { pullRequests: async () => found }).create({ name: '', fromDir: repo, pullRequest: '42', ...input })

  it('no próprio repositório: o andar usa a branch do PR, seguindo a de origem, com o nome do PR', async () => {
    const floor = await create(details())
    expect(floor).toMatchObject({ name: '#42 Corrige o login', branch: 'fix-login', pullRequest: { number: 42, url: 'https://github.com/acme/app/pull/42', title: 'Corrige o login' } })
    expect(sh(floor.dir, 'rev-parse', 'HEAD')).toBe(head); expect(sh(repo, 'rev-parse', '--abbrev-ref', 'fix-login@{upstream}')).toBe('origin/fix-login')
  })
  it('de um fork (ou sem o host dizer): cópia dos commits em pr-42, sem upstream', async () => {
    const floor = await create(details({ sameRepository: false }), { name: 'Revisão' })
    expect(floor).toMatchObject({ name: 'Revisão', branch: 'pr-42' }); expect(() => sh(repo, 'rev-parse', '--abbrev-ref', 'pr-42@{upstream}')).toThrow()
  })
  it('funciona junto com --copy: a branch nasce no clone', async () => {
    const floor = await create(details(), { copy: true })
    expect(floor).toMatchObject({ copy: true, branch: 'fix-login' }); expect(sh(floor.dir, 'rev-parse', 'HEAD')).toBe(head); expect(sh(floor.dir, 'branch', '--show-current')).toBe('fix-login')
  })
  it('título sem letras latinas fica só com o número', async () => { expect((await create(details({ title: 'исправление' }))).name).toBe('#42') })
  it('recusa: não aberto, mudou durante a busca, branch local divergente, branch que envia para outro lugar e PR já num andar', async () => {
    await expect(create(details({ state: 'MERGED' }))).rejects.toThrow(/não está aberto/)
    await expect(create(details({ headSha: '0'.repeat(40) }))).rejects.toThrow(/mudou/)
    sh(repo, 'checkout', '-q', '-b', 'fix-login'); commit(repo, 'local.txt', 'l'); sh(repo, 'checkout', '-q', 'main')
    await expect(create(details())).rejects.toThrow(/outro caminho/)
    sh(repo, 'branch', '-qD', 'fix-login'); sh(repo, 'branch', '-q', 'fix-login', 'main'); sh(repo, 'config', 'branch.fix-login.remote', 'outro'); sh(repo, 'config', 'branch.fix-login.merge', 'refs/heads/fix-login')
    await expect(create(details())).rejects.toThrow(/outro lugar/)
    sh(repo, 'branch', '-qD', 'fix-login')
    await create(details()); await expect(create(details(), { name: 'De novo' })).rejects.toThrow(/já está/)
    expect(Object.keys(store.get().floors)).toHaveLength(1)
  })
  it('um nome de branch malicioso do provedor é recusado', async () => {
    for (const headBranch of ['--upload-pack=x', 'a..b', 'x y']) await expect(preparePullRequestBranch(repo, details({ headBranch }))).rejects.toThrow(/branch inválida/)
  })
})

describe('consulta ao provedor', () => {
  const hosts = (remote: string, view: unknown) => {
    const run = vi.fn(async (command: string, args: string[]) => (command === 'git' ? remote : JSON.stringify(view)))
    const service = new GitHosts(join(dir, 'hosts'), run); service.ensure()
    return { run, service }
  }
  it('GitHub: pede os campos do PR e monta o ref', async () => {
    const { run, service } = hosts('git@github.com:acme/app.git\n', { number: 42, title: 'T', state: 'OPEN', url: 'https://github.com/acme/app/pull/42', headRefName: 'fix', headRefOid: 'a'.repeat(40), isCrossRepository: false })
    expect(await service.pullRequest(repo, 'https://github.com/acme/app/pull/42')).toEqual({ number: 42, title: 'T', state: 'OPEN', url: 'https://github.com/acme/app/pull/42', headBranch: 'fix', headSha: 'a'.repeat(40), sameRepository: true, ref: 'refs/pull/42/head' })
    expect(run.mock.calls.at(-1)!.slice(0, 2)).toEqual(['gh', ['pr', 'view', '42', '--json', 'number,title,state,url,headRefName,headRefOid,isCrossRepository']])
  })
  it('GitLab: mesmo contrato; sem o projeto de origem, trata como outro repositório', async () => {
    const { service } = hosts('https://gitlab.com/acme/app.git\n', { iid: 7, title: 'M', state: 'opened', web_url: 'https://gitlab.com/acme/app/-/merge_requests/7', source_branch: 'f', sha: 'b'.repeat(40) })
    expect(await service.pullRequest(repo, '#7')).toMatchObject({ number: 7, state: 'OPEN', headBranch: 'f', sameRepository: false, ref: 'refs/merge-requests/7/head' })
  })
  it('recusa link de outro repositório, host sem provedor e resposta sem os campos', async () => {
    const { service } = hosts('git@github.com:acme/app.git\n', {})
    await expect(service.pullRequest(repo, 'https://github.com/outro/app/pull/1')).rejects.toThrow(/outro repositório/)
    await expect(service.pullRequest(repo, '1')).rejects.toThrow(/resposta/)
    await expect(hosts('git@meu.servidor:a/b.git\n', {}).service.pullRequest(repo, '1')).rejects.toThrow(/provedor/)
  })
})

describe('rota do floor create', () => {
  let server: { close(): Promise<void> }, registry: WorkspaceRegistry, socket: string, me: string
  const inputs: object[] = []
  const post = (body: unknown): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/floor/create', headers: { [HEADER_TOKEN]: 'tok', 'content-type': 'application/json' } }, (res) => { let data = ''; res.setEncoding('utf8'); res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data })) })
    req.on('error', reject); req.end(JSON.stringify(body))
  })
  beforeEach(async () => {
    inputs.length = 0; socket = join(dir, 's.sock'); registry = new WorkspaceRegistry(join(dir, 'workspaces'))
    me = registry.active().addNode({ kind: 'terminal', floorId: null, name: 'Eu', agent: 'claude', command: '', cwd: repo, maestro: true, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } } as never)
    const broker = new AskBroker({ deliver: () => {}, screenText: () => '', agentOf: () => 'shell', setTimeout, clearTimeout }, { shellIdleMs: 60000, settleMs: 0 })
    const floors = { create: async (input: object) => { inputs.push(input); return { name: '#42 T', dir: '/r.floors/x', branch: 'pr-42', copy: true, pullRequest: { number: 42, url: 'https://github.com/a/b/pull/42', title: 'T', sameRepository: false } } } }
    server = await startServer(socket, { registry, broker, floors: floors as never, terminals: { spawn: () => {}, dispose: () => {}, screenText: () => '', markReady: () => {}, notePromptHook: () => {}, isRunning: () => true, hasSession: () => true, agentState: () => 'ready', identify: () => ({ id: me, gen: 1 }) } } as never)
  })
  afterEach(async () => { await server.close(); registry.flushAll() })
  it('leva --copy e --pull-request ao serviço, sem exigir nome, e avisa quando os commits não chegam ao PR', async () => {
    const r = await post({ pullRequest: '42', copy: true })
    expect(r.status).toBe(200); expect(inputs[0]).toMatchObject({ name: '', pullRequest: '42', copy: true })
    expect(JSON.parse(r.body)).toMatchObject({ name: '#42 T', branch: 'pr-42', copy: true, pullRequest: 'https://github.com/a/b/pull/42', note: expect.stringContaining('não chega ao pull request') })
  })
  it('recusa combinações que não se aplicam e pedido sem nome nem pull request', async () => {
    for (const body of [{ name: 'X', copy: true, noGit: true }, { pullRequest: '1', branch: 'b' }, { pullRequest: '1', dir: '/x' }, { copy: true }]) expect((await post(body)).status, JSON.stringify(body)).toBe(400)
    expect(inputs).toEqual([])
  })
})
