// Monta o App inteiro em happy-dom com um `window.palco` de mentira: o que o teste não define responde vazio.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { App } from '../../src/renderer/src/App'
import { defaultPreferences } from '../../src/shared/preferences'
import type { Sidebar, Workspace } from '../../src/shared/model'

export interface Harness { host: HTMLElement; workspace(next: Workspace): Promise<void>; unmount(): Promise<void> }
export const emptyWorkspace = (over: Partial<Workspace> = {}): Workspace => ({ id: 'ws1', name: 'Palco', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, nodes: {}, connections: [], floors: {}, activeFloor: null, ...over }) as Workspace

/** `api` substitui métodos por caminho (`'partitura.list'`). */
export async function mountApp(opts: { workspace?: Workspace; warning?: string; api?: Record<string, (...args: never[]) => unknown> } = {}): Promise<Harness> {
  // Sem animações: o cancelamento delas no happy-dom rejeita promessas soltas depois do teste.
  MotionGlobalConfig.skipAnimations = true
  const ws = opts.workspace ?? emptyWorkspace()
  const sidebar: Sidebar = { pages: [], activePage: 'home', spaces: [], workspaces: [], order: [], active: ws.id } as unknown as Sidebar
  let changed: ((next: Workspace) => void) | undefined
  const defaults: Record<string, (...args: never[]) => unknown> = {
    'workspace.get': async () => ws,
    'workspace.onChange': ((cb: (next: Workspace) => void) => { changed = cb; return () => {} }) as never,
    'workspaces.sidebar': async () => sidebar,
    'preferences.get': async () => defaultPreferences(),
    'partitura.list': async () => [], 'accounts.list': async () => [], 'usage.get': async () => [], 'presets.list': async () => [], 'routine.list': async () => [], 'links.list': async () => [],
    ...opts.api
  }
  const at = (path: string): unknown => new Proxy(function () {}, {
    get: (_t, key) => (typeof key !== 'string' || key === 'then' ? undefined : at(path ? `${path}.${key}` : key)),
    apply: (_t, _this, args: never[]) => {
      if (defaults[path]) return defaults[path](...args)
      return path.split('.').pop()!.startsWith('on') ? () => {} : Promise.resolve(undefined)
    }
  })
  Object.assign(window, { palco: at(''), palcoMeta: { warning: async () => opts.warning ?? null, onWarning: () => () => {} } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  await act(async () => root.render(createElement(App))); await settle(); await settle()
  return {
    host,
    workspace: async (next) => { await act(async () => changed?.(next)); await settle() },
    unmount: async () => { await act(async () => root.unmount()); host.remove() }
  }
}
