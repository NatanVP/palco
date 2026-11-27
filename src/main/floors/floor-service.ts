import type { Floor, FloorState, LandResult, NewFloor, PullRequestDetails } from '../../shared/model'
import { checkCloneRemovable, createFloorClone, landClone, preparePullRequestBranch, pullRequestBranch, reflinkCloner, removeClone, type Cloner } from '../git/floor-clone'
import { slugFloorName } from '../domain/floor-name'
import type { WorkspaceStore } from '../domain/workspace-store'
import { rmdirSync } from 'node:fs'
import { checkFloorRemovable, copyUntracked, createFloorWorktree, floorsDirOf, inspectFolder, landFloor, removeFloorWorktree, repoRootOf } from '../git/worktree'

/** As operações de git que o palco usa (injetável para testes). */
export interface GitOps {
  repoRootOf: typeof repoRootOf
  createFloorWorktree: typeof createFloorWorktree
  landFloor: typeof landFloor
  removeFloorWorktree: typeof removeFloorWorktree
  checkFloorRemovable: typeof checkFloorRemovable
  copyUntracked?: typeof copyUntracked
  inspectFolder?: typeof inspectFolder
}

const realGit: GitOps = { checkFloorRemovable, repoRootOf, createFloorWorktree, landFloor, removeFloorWorktree, copyUntracked, inspectFolder }

/** Erro de uma operação de floor, já com o status HTTP que o servidor deve usar. */
export class FloorError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message)
    this.name = 'FloorError'
  }
}

export interface FloorServiceDeps {
  store: WorkspaceStore
  terminals: { dispose(id: string): void }
  /** Nós portal de um floor removido deixam de ser controláveis. */
  portals?: { unregister(nodeId: string): void }
  git?: GitOps
  /** Cópia instantânea do `--copy` (injetável para testes). */
  cloner?: Cloner
  /** Consulta ao provedor para `--pull-request`. */
  pullRequests?: (repoRoot: string, reference: string) => Promise<PullRequestDetails>
}

/** Pull requests sendo trazidos agora, por repositório: dois pedidos juntos não criam dois andares. */
const arriving = new Set<string>()
/** "#42 Título"; sem letras latinas no título, só o número. */
function pullRequestName(pr: PullRequestDetails): string {
  const full = `#${pr.number} ${pr.title.replace(/\s+/g, ' ').trim()}`.slice(0, 60).trim()
  try { slugFloorName(full); return full } catch { return `#${pr.number}` }
}

/**
 * Ciclo de vida dos floors: worktree git + estado do workspace + processos.
 * Usado pelo servidor do socket (agentes) e pelo IPC (interface), com as mesmas regras.
 */
export class FloorService {
  private readonly git: GitOps

  constructor(private readonly deps: FloorServiceDeps) {
    this.git = deps.git ?? realGit
  }

  /** Floor pelo nome (comparação por slug). */
  byName(name: string): Floor {
    let found: Floor | undefined
    try {
      found = this.deps.store.findFloorByName(name)
    } catch {
      found = undefined
    }
    if (!found) throw new FloorError(404, `floor '${name}' não existe`)
    return found
  }

  byId(id: string): Floor {
    const found = this.deps.store.get().floors[id]
    if (!found) throw new FloorError(404, 'floor inexistente')
    return found
  }

  async create(input: NewFloor): Promise<Floor> {
    if (input.pullRequest !== undefined) return this.createForPullRequest(input)
    const { store } = this.deps
    let existing: Floor | undefined
    try {
      existing = store.findFloorByName(input.name)
    } catch (err) {
      throw new FloorError(400, (err as Error).message)
    }
    if (existing) throw new FloorError(409, `o floor '${input.name}' já existe`)
    const base = input.baseDir === undefined ? {} : { baseDir: input.baseDir }
    const add = (f: Omit<Floor, 'id' | 'camera' | 'createdAt'>): Floor => {
      try {
        return this.byId(store.addFloor(f))
      } catch (err) {
        throw new FloorError(400, (err as Error).message)
      }
    }

    // Pasta que o usuário já tem: worktree dele vira o checkout; pasta comum é só onde o andar trabalha.
    if (input.dir !== undefined) {
      let found
      try {
        found = await (this.git.inspectFolder ?? inspectFolder)(input.dir)
      } catch (err) {
        throw new FloorError(400, (err as Error).message)
      }
      if (found?.kind === 'repo') throw new FloorError(400, 'a pasta é a raiz de um repositório: use --from para basear um andar nele')
      if (found?.kind === 'worktree') {
        return add({ name: input.name, repoRoot: found.repoRoot, dir: input.dir, branch: found.branch, baseRef: found.branch, external: true })
      }
      return add({ name: input.name, repoRoot: input.dir, dir: input.dir, branch: '', baseRef: '', plain: true, external: true })
    }

    let repoRoot: string | undefined
    if (!input.noGit) {
      try {
        repoRoot = await this.git.repoRootOf(input.fromDir)
      } catch {
        repoRoot = undefined
      }
    }
    if (input.copy) {
      if (repoRoot === undefined) throw new FloorError(400, '--copy precisa de um repositório git')
      return this.addClone({ name: input.name, ...base }, createFloorClone({ repoRoot, name: input.name, branch: input.branch, ...(input.existingBranch ? { existingBranch: true } : {}) }, this.cloner()), repoRoot)
    }
    // Sem git (pedido ou porque a pasta não é repositório): o andar trabalha direto na pasta de base.
    if (repoRoot === undefined) {
      if (input.branch !== undefined || input.existingBranch) throw new FloorError(400, 'a pasta não é um repositório git: --branch não se aplica')
      return add({ name: input.name, repoRoot: input.fromDir, dir: input.fromDir, branch: '', baseRef: '', plain: true, ...base })
    }
    let made: { dir: string; branch: string; baseRef: string }
    try {
      made = await this.git.createFloorWorktree({ repoRoot, name: input.name, branch: input.branch, from: input.from, ...(input.existingBranch ? { existingBranch: true } : {}) })
    } catch (err) {
      const message = (err as Error).message
      throw new FloorError(/já existe/.test(message) ? 409 : 400, message)
    }
    try {
      const id = store.addFloor({ name: input.name, repoRoot, ...made, ...base })
      await this.git.copyUntracked?.(repoRoot, made.dir).catch(() => 0)
      return this.byId(id)
    } catch (err) {
      // Estado e disco não podem divergir: desfaz a worktree que acabou de nascer.
      await this.git.removeFloorWorktree({ repoRoot, dir: made.dir, branch: made.branch, force: true }).catch(() => undefined)
      throw new FloorError(400, (err as Error).message)
    }
  }

  private cloner(): Cloner { return this.deps.cloner ?? reflinkCloner }

  /** Registra o andar de um clone recém-criado; se o registro falhar, o clone sai. */
  private async addClone(extra: { name: string; baseDir?: string; pullRequest?: Floor['pullRequest'] }, creating: ReturnType<typeof createFloorClone>, repoRoot: string): Promise<Floor> {
    let made: Awaited<ReturnType<typeof createFloorClone>>
    try {
      made = await creating
    } catch (err) {
      const message = (err as Error).message
      throw new FloorError(/já existe/.test(message) ? 409 : 400, message)
    }
    try {
      return this.byId(this.deps.store.addFloor({ ...extra, repoRoot, ...made, copy: true }))
    } catch (err) {
      await removeClone({ repoRoot, dir: made.dir, branch: made.branch, force: true }).catch(() => undefined)
      throw new FloorError(400, (err as Error).message)
    }
  }

  private async createForPullRequest(input: NewFloor): Promise<Floor> {
    const { store, pullRequests } = this.deps
    let repoRoot: string
    try { repoRoot = await this.git.repoRootOf(input.fromDir) } catch { throw new FloorError(400, '--pull-request precisa de um repositório git') }
    if (!pullRequests) throw new FloorError(400, 'nenhum provedor de pull requests disponível')
    let pr: PullRequestDetails
    try { pr = await pullRequests(repoRoot, input.pullRequest!) } catch (err) { throw new FloorError(400, (err as Error).message) }
    if (pr.state !== 'OPEN') throw new FloorError(409, `o pull request #${pr.number} não está aberto`)
    const key = `${repoRoot}#${pr.number}`
    const taken = Object.values(store.get().floors).some((f) => f.repoRoot === repoRoot && (f.pullRequest?.number === pr.number || f.branch === pullRequestBranch(pr)))
    if (taken || arriving.has(key)) throw new FloorError(409, `o pull request #${pr.number} já está num andar ou a caminho de um`)
    const name = input.name.trim() || pullRequestName(pr)
    let existing: Floor | undefined
    try { existing = store.findFloorByName(name) } catch (err) { throw new FloorError(400, (err as Error).message) }
    if (existing) throw new FloorError(409, `o floor '${name}' já existe`)
    const extra = { name, ...(input.baseDir === undefined ? {} : { baseDir: input.baseDir }), pullRequest: { number: pr.number, url: pr.url, title: pr.title, sameRepository: pr.sameRepository } }
    arriving.add(key)
    try {
      if (input.copy) return await this.addClone(extra, createFloorClone({ repoRoot, name, prepare: async (dir) => (await preparePullRequestBranch(dir, pr)).branch }, this.cloner()), repoRoot)
      let made: { dir: string; branch: string; baseRef: string }
      try {
        const { branch } = await preparePullRequestBranch(repoRoot, pr)
        made = await this.git.createFloorWorktree({ repoRoot, name, branch, existingBranch: true })
      } catch (err) {
        throw new FloorError(409, (err as Error).message)
      }
      try {
        return this.byId(store.addFloor({ ...extra, repoRoot, ...made }))
      } catch (err) {
        await this.git.removeFloorWorktree({ repoRoot, dir: made.dir, branch: made.branch, force: true, keepBranch: true }).catch(() => undefined)
        throw new FloorError(400, (err as Error).message)
      }
    } finally { arriving.delete(key) }
  }

  async land(id: string, opts: { into?: string; deleteBranch?: boolean; keepFloor?: boolean } = {}): Promise<LandResult> {
    const floor = this.byId(id)
    if (floor.plain) throw new FloorError(400, `o floor '${floor.name}' não tem git: não há o que integrar (use floor delete)`)
    const result = await (floor.copy ? landClone : this.git.landFloor)({
      repoRoot: floor.repoRoot,
      dir: floor.dir,
      branch: floor.branch,
      ...(floor.external ? { external: true } : {}),
      ...(opts.into === undefined ? {} : { into: opts.into }),
      ...(opts.deleteBranch === undefined ? {} : { deleteBranch: opts.deleteBranch })
    })
    if (!result.ok || opts.keepFloor) return result
    try {
      await this.drop(floor, { keepBranch: !opts.deleteBranch })
    } catch (err) {
      throw new FloorError(409, `integrado, mas o floor não foi removido: ${(err as Error).message}`)
    }
    return result
  }

  async remove(id: string, opts: { force?: boolean; keepBranch?: boolean; keepFolder?: boolean } = {}): Promise<void> {
    const floor = this.byId(id)
    try {
      await this.drop(floor, opts)
    } catch (err) {
      throw new FloorError(409, (err as Error).message)
    }
  }

  setStatus(id: string, status: Floor["status"] | null): void {
    this.byId(id)
    this.deps.store.setFloorStatus(id, status)
  }

  /**
   * Ordem da exclusão: (1) todas as checagens que podem recusar, sem mexer em nada; (2) mata os PTYs, para que
   * ninguém grave na pasta que vai sumir; (3) remove a worktree; (4) só então apaga o estado.
   */
  private async drop(floor: Floor, opts: { force?: boolean; keepBranch?: boolean; keepFolder?: boolean }): Promise<void> {
    const { store, terminals, portals } = this.deps
    // Sem git, pasta do usuário ou --keep-folder: só o andar sai do canvas; a pasta (e a branch) ficam.
    if (floor.plain || floor.external || opts.keepFolder) {
      const nodes = Object.values(store.get().nodes).filter((n) => n.floorId === floor.id)
      for (const node of nodes) if (node.kind === 'terminal') terminals.dispose(node.id)
      store.removeFloor(floor.id)
      for (const node of nodes) if (node.kind === 'portal') portals?.unregister(node.id)
      return
    }
    const target = {
      repoRoot: floor.repoRoot,
      dir: floor.dir,
      branch: floor.branch,
      ...(opts.force === undefined ? {} : { force: opts.force }),
      ...(opts.keepBranch === undefined ? {} : { keepBranch: opts.keepBranch })
    }
    await (floor.copy ? checkCloneRemovable : this.git.checkFloorRemovable)(target)
    const nodes = Object.values(store.get().nodes).filter((n) => n.floorId === floor.id)
    for (const node of nodes) if (node.kind === 'terminal') terminals.dispose(node.id)
    await (floor.copy ? removeClone : this.git.removeFloorWorktree)(target)
    try { rmdirSync(floorsDirOf(floor.repoRoot)) } catch { /* preserva a pasta se houver qualquer conteúdo */ }
    store.removeFloor(floor.id)
    for (const node of nodes) if (node.kind === 'portal') portals?.unregister(node.id)
  }
}
