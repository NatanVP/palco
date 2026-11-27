import { removeWorkspace } from '../domain/workspace-removal'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { HOME_PAGE_ID, type TerminalNode } from '../../shared/model'
import { resolveColor } from '../../shared/colors'
import { cloneWorkspaceLayout } from '../domain/workspace-clone'
import type { WorkspaceRegistry } from '../domain/workspace-registry'
import type { WorkspaceStore } from '../domain/workspace-store'
import { requireMaestro, RouteError } from './route-error'

type Ctx = { caller: TerminalNode; url: URL; body: Record<string, unknown> }
type Reply = { status: number; body: string; type?: 'application/json' }

const ok = (body = 'OK'): Reply => ({ status: 200, body })
const json = (value: unknown): Reply => ({ status: 200, body: JSON.stringify(value), type: 'application/json' })

function optStr(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new RouteError(400, `campo '${key}' deve ser texto`)
  return v.trim() === '' ? undefined : v
}
function reqStr(body: Record<string, unknown>, key: string): string {
  const v = optStr(body, key)
  if (v === undefined) throw new RouteError(400, `campo '${key}' ausente`)
  return v
}
/** Erros do domínio viram 409 (já existe), 404 (inexistente) ou 400. */
function checked<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof RouteError) throw err
    const message = err instanceof Error ? err.message : String(err)
    if (/já existe/.test(message)) throw new RouteError(409, message)
    if (/inexistente/.test(message)) throw new RouteError(404, message)
    throw new RouteError(400, message)
  }
}
const isDir = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }
/** `~` e caminho relativo (à pasta do chamador). */
export function expandPath(p: string, base: string): string {
  const home = homedir()
  if (p === '~') return home
  if (p.startsWith('~/')) return resolve(home, p.slice(2))
  return resolve(base, p)
}

/**
 * `palco workspace` e `palco space` (skill palco-workspace). Na skill, "espaço" é a página do rodapé
 * (no código, `SidebarPage`) e "grupo" é o agrupamento dentro dela (no código, `Space`).
 */
export function createWorkspaceRoutes(registry: WorkspaceRegistry | undefined, store: WorkspaceStore, processes?: { isRunning(id: string): boolean; stop?(id: string): Promise<void>; dispose?(id: string): void; unregister?(id: string): void }): Record<string, (ctx: Ctx) => Reply | Promise<Reply>> {
  const reg = (): WorkspaceRegistry => {
    if (!registry) throw new RouteError(501, 'workspaces indisponíveis')
    return registry
  }
  const workspaceByName = (name: string) => {
    const found = reg().workspaceByName(name)
    if (!found) throw new RouteError(404, `workspace '${name}' não existe; válidos: ${reg().list().map((w) => w.name).join(', ')}`)
    return found
  }
  const pageByName = (name: string) => {
    const found = reg().pageByName(name)
    if (!found) throw new RouteError(404, `espaço '${name}' não existe; válidos: ${reg().sidebar().pages.map((p) => p.name).join(', ')}`)
    return found
  }
  /** Página de `--space`, criada se faltar. */
  const pageOrCreate = (name: string): string => reg().pageByName(name)?.id ?? checked(() => reg().createPage({ name }))
  /** Grupo de `--group`: procurado em todos os espaços (ou só em `pageId`); criado se faltar. */
  const groupOrCreate = (name: string, pageId: string | undefined): string => {
    const found = reg().groupsByName(name, pageId)
    if (found.length > 1) throw new RouteError(409, `há ${found.length} grupos chamados '${name}' em espaços diferentes: acrescente --space`)
    if (found.length === 1) return found[0]!.id
    return checked(() => reg().createSpace(name, pageId ?? reg().sidebar().activePage))
  }
  /** Destino na barra: `{ group, page }` segundo as regras da skill. */
  const destination = (body: Record<string, unknown>, root: boolean): { groupId: string | null; pageId: string | undefined } => {
    const space = optStr(body, 'space')
    const group = optStr(body, 'group')
    const pageId = space === undefined ? undefined : pageOrCreate(space)
    if (group !== undefined && !root) return { groupId: groupOrCreate(group, pageId), pageId: undefined }
    return { groupId: null, pageId }
  }
  const place = (id: string, dest: { groupId: string | null; pageId: string | undefined }, keepPage: boolean): void => {
    const r = reg()
    const side = r.sidebar()
    const meta = side.workspaces.find((w) => w.id === id)!
    const page = dest.groupId !== null ? undefined : (dest.pageId ?? (keepPage ? meta.pageId ?? HOME_PAGE_ID : side.activePage))
    const end = side.workspaces.filter((w) => w.id !== id && w.spaceId === dest.groupId && (dest.groupId !== null || (w.pageId ?? HOME_PAGE_ID) === page)).length
    checked(() => r.move(id, dest.groupId, end, page))
  }

  return {
    'GET /workspace/list': (ctx) => {
      requireMaestro(ctx.caller)
      const r = reg()
      const side = r.sidebar()
      const current = r.idOf(store)
      const asleep = (id: string): boolean => { const terms = r.get(id).terminalIds(); return !!processes && terms.length > 0 && terms.every((t) => !processes.isRunning(t)) }
      const item = (w: (typeof side.workspaces)[number]) => ({
        name: w.name,
        ...(asleep(w.id) ? { unloaded: true } : {}),
        dir: w.dir ?? null,
        floors: Object.keys(r.get(w.id).get().floors).length,
        ...(w.id === current ? { current: true } : {}),
        ...(w.id === side.active ? { active: true } : {})
      })
      return json(side.pages.map((p) => {
        const inPage = side.workspaces.filter((w) => (w.pageId ?? HOME_PAGE_ID) === p.id)
        return {
          space: p.name,
          ...(p.id === side.activePage ? { onScreen: true } : {}),
          workspaces: inPage.filter((w) => w.spaceId === null).map(item),
          groups: side.spaces.filter((g) => (g.pageId ?? HOME_PAGE_ID) === p.id).map((g) => ({
            name: g.name,
            workspaces: inPage.filter((w) => w.spaceId === g.id).map(item)
          }))
        }
      }))
    },

    'POST /workspace/create': (ctx) => {
      requireMaestro(ctx.caller)
      const r = reg()
      const name = reqStr(ctx.body, 'name')
      const dir = expandPath(reqStr(ctx.body, 'dir'), ctx.caller.cwd)
      if (!isDir(dir)) throw new RouteError(400, `a pasta não existe: ${dir} (crie a pasta antes)`)
      const fromName = optStr(ctx.body, 'from')
      const source = fromName === undefined ? undefined : workspaceByName(fromName)
      const dest = destination(ctx.body, false)
      const id = checked(() => r.create(name, null))
      try {
        r.setWorkspaceDir(id, dir)
        place(id, dest, false)
        if (source) checked(() => cloneWorkspaceLayout(r.get(source.id).get(), r.get(id), source.dir, dir))
      } catch (err) {
        // Nada pela metade: o workspace recém-criado sai da barra.
        try { r.remove(id) } catch { /* fica para o usuário remover */ }
        throw err
      }
      return ok(`OK: workspace ${name} criado em ${dir}${source ? ` a partir de ${source.name}` : ''}`)
    },

    'POST /workspace/delete': (ctx) => {
      requireMaestro(ctx.caller)
      const r = reg(), w = workspaceByName(reqStr(ctx.body, 'name')), target = r.get(w.id)
      if (ctx.body.force !== undefined && typeof ctx.body.force !== 'boolean') throw new RouteError(400, 'force deve ser booleano')
      if (r.list().length === 1) throw new RouteError(409, 'não dá para remover o último workspace')
      if (target === store) throw new RouteError(409, 'não dá para remover o workspace do terminal chamador')
      const nodes = Object.values(target.get().nodes)
      const running = nodes.filter(n => n.kind === 'terminal' && n.agent !== 'shell' && processes?.isRunning(n.id))
      if (!ctx.body.force && running.length) throw new RouteError(409, `agentes em execução em ${w.name}: ${running.map(n => JSON.stringify(n.name)).join(', ')}; use --force para encerrar e remover`)
      if (nodes.some(n => n.kind === 'terminal') && !processes?.dispose) throw new RouteError(501, 'encerramento indisponível')
      if (nodes.some(n => n.kind === 'portal') && !processes?.unregister) throw new RouteError(501, 'encerramento de portais indisponível')
      checked(() => removeWorkspace(r, w.id, {
        disposeTerminal: id => processes!.dispose!(id), unregisterPortal: id => processes!.unregister!(id)
      }))
      return ok(`OK: workspace ${w.name} removido; a pasta do projeto foi preservada`)
    },

    'POST /workspace/unload': async (ctx) => {
      requireMaestro(ctx.caller)
      const w = workspaceByName(reqStr(ctx.body, 'name'))
      if (reg().get(w.id) === store) throw new RouteError(409, 'não dá para descarregar o seu próprio workspace')
      // O workspace na tela subiria de novo na hora.
      if (reg().activeId() === w.id) throw new RouteError(409, `o workspace ${w.name} está na tela: troque antes`)
      if (!processes?.stop) throw new RouteError(501, 'encerramento indisponível')
      const live = reg().get(w.id).terminalIds().filter((id) => processes.isRunning(id))
      if (!live.length) throw new RouteError(409, `nada rodando em ${w.name}`)
      await Promise.all(live.map((id) => processes.stop!(id)))
      return ok(`OK: ${w.name} descarregado (${live.length} terminal(is)); os agentes voltam na próxima visita`)
    },

    'POST /workspace/rename': (ctx) => {
      requireMaestro(ctx.caller)
      const w = workspaceByName(reqStr(ctx.body, 'old'))
      checked(() => reg().rename(w.id, reqStr(ctx.body, 'new')))
      return ok()
    },

    'POST /workspace/move': (ctx) => {
      requireMaestro(ctx.caller)
      const w = workspaceByName(reqStr(ctx.body, 'name'))
      const root = ctx.body.root === true
      if (root && optStr(ctx.body, 'group') !== undefined) throw new RouteError(400, '--group e --root são exclusivos')
      if (!root && optStr(ctx.body, 'group') === undefined && optStr(ctx.body, 'space') === undefined) throw new RouteError(400, 'workspace move precisa de --group, --root ou --space')
      place(w.id, destination(ctx.body, root), true)
      return ok()
    },

    'GET /space/list': (ctx) => {
      requireMaestro(ctx.caller)
      const side = reg().sidebar()
      return json(side.pages.map((p, i) => ({
        position: i + 1,
        name: p.name,
        icon: p.icon,
        ...(p.color ? { color: p.color } : {}),
        ...(p.id === side.activePage ? { onScreen: true } : {}),
        groups: side.spaces.filter((g) => (g.pageId ?? HOME_PAGE_ID) === p.id).map((g) => g.name),
        workspaces: side.workspaces.filter((w) => (w.pageId ?? HOME_PAGE_ID) === p.id).map((w) => w.name)
      })))
    },

    'POST /space/create': (ctx) => {
      requireMaestro(ctx.caller)
      const name = reqStr(ctx.body, 'name')
      if (reg().pageByName(name)) throw new RouteError(409, `espaço '${name}' já existe`)
      const color = optStr(ctx.body, 'color')
      const hex = color === undefined ? undefined : checked(() => resolveColor(color))
      const icon = optStr(ctx.body, 'icon')
      checked(() => reg().createPage({ name, ...(icon === undefined ? {} : { icon }), ...(hex ? { color: hex } : {}) }))
      return ok(`OK: espaço ${name} criado`)
    },

    'POST /space/edit': (ctx) => {
      requireMaestro(ctx.caller)
      const page = pageByName(reqStr(ctx.body, 'name'))
      const newName = optStr(ctx.body, 'newName')
      if (newName !== undefined) {
        const other = reg().pageByName(newName)
        if (other && other.id !== page.id) throw new RouteError(409, `espaço '${newName}' já existe`)
      }
      const icon = optStr(ctx.body, 'icon')
      const color = optStr(ctx.body, 'color')
      if (newName === undefined && icon === undefined && color === undefined) throw new RouteError(400, 'space edit precisa de --name, --icon ou --color')
      checked(() => reg().editPage(page.id, {
        ...(newName === undefined ? {} : { name: newName }),
        ...(icon === undefined ? {} : { icon }),
        ...(color === undefined ? {} : { color: resolveColor(color) })
      }))
      return ok()
    },

    'POST /space/move': (ctx) => {
      requireMaestro(ctx.caller)
      const r = reg()
      const page = pageByName(reqStr(ctx.body, 'name'))
      const pages = r.sidebar().pages
      const at = pages.findIndex((p) => p.id === page.id)
      const to = ctx.body.to
      let index: number
      if (to !== undefined) {
        if (!Number.isInteger(to) || (to as number) < 1) throw new RouteError(400, '--to precisa de uma posição ≥ 1')
        index = (to as number) - 1
      } else if (ctx.body.left === true) index = at - 1
      else if (ctx.body.right === true) index = at + 1
      else throw new RouteError(400, 'space move precisa de --to N, --left ou --right')
      checked(() => r.movePage(page.id, Math.max(0, index)))
      return ok()
    },

    'POST /space/delete': (ctx) => {
      requireMaestro(ctx.caller)
      const page = pageByName(reqStr(ctx.body, 'name'))
      checked(() => reg().removePage(page.id))
      return ok(`OK: espaço ${page.name} apagado; os workspaces dele foram para o espaço inicial`)
    }
  }
}
