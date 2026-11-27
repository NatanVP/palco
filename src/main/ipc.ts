import { removeWorkspace } from './domain/workspace-removal'
import { MAX_GROUP_NAME } from '../shared/groups'
import { isNoteFilePath } from '../shared/note-file'
import type { PreferencesStore } from './preferences/preferences-store'
import { CanvasHistory } from './history/canvas-history'
import { accountInput } from './accounts/routes'
import type { AccountStore } from './accounts/account-store'
import type { UsageService } from './usage/usage-service'
import type { AgentUsage, CrossLinkView } from '../shared/model'
import type { PartituraStore } from './partituras/partitura-store'
import { previewUpdate, savePartitura, startPartitura, updatePartitura } from './partituras/routes'
import { reviewPartitura } from './partituras/partitura-store'
import { wakeNode } from './node-state'
import type { AgentCatalog } from './agents/presets'
import { resolveAgentForCommand } from './agents/command-resolution'
import type { MemoryGuard } from './pty/memory-guard'
import type { ChatService } from './chat/chat-service'
import { expandHome, listDir, makeDirectory, pathExists, readFileForNode } from './files'
import type { RoutineRunner } from './routines/routine-runner'
import type { RoutineStore } from './routines/routine-store'
import type { MicGate } from './voice/permission'
import type { VoiceService } from './voice/voice-service'
import { MAX_HISTORY_BATCH } from '../shared/api'
import { AREAS, registerAreas } from './ipc/index'
import { PREFS_CH } from './ipc/preferences'
import { homedir } from 'node:os'
import { localized, localizeError, localizeMessage, localizeResult } from './i18n'
import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { NoteNode, TerminalNode } from '../shared/model'
import type { FloorService } from './floors/floor-service'
import type { PortalManager } from './portal/portal-manager'
import type { WorkspaceStore } from './domain/workspace-store'
import type { WorkspaceRegistry } from './domain/workspace-registry'
import { assertWorkspaceId } from './domain/workspace-id'
import { parseExternalUrl } from './domain/node-extras'
import type { TerminalManager } from './pty/terminal-manager'
import {
  parseBandName, parseCamera, parseData, parseDims, parseFloorId, parseFloorStatus, parseId, parseLandOptions, parseMemberIds,
  parseDockState, parseDrawing, parseDrawingPatch, parseNewFloor, parseNewNode, parsePath, parseNodePatch, parseRemoveOptions, parseTerminalConfig, parseWebContentsId
} from './validate'

const defaultFiles = { read: readFileForNode, list: listDir }

export const CH = {
  prefsGet: PREFS_CH.get, prefsSet: PREFS_CH.set, prefsChanged: PREFS_CH.changed, prefsBind: PREFS_CH.bind, prefsReset: PREFS_CH.reset,
  historyNotice: 'palco:history:notice',
  historyUndo: 'palco:history:undo',
  historyRedo: 'palco:history:redo',
  historyCanUndo: 'palco:history:canUndo',
  historyCanRedo: 'palco:history:canRedo',
  historyCommit: 'palco:history:commit',
  partRename: 'palco:partitura:rename', partExport: 'palco:partitura:export', partImport: 'palco:partitura:import',
  stackRename: 'palco:stack:rename',
  noteUnlink: 'palco:noteFile:unlink', noteMoveOut: 'palco:noteFile:moveOut',
  groupCreate: 'palco:group:create', groupUngroup: 'palco:group:ungroup', groupRename: 'palco:group:rename', groupColor: 'palco:group:color',
  partInspect: 'palco:partitura:inspect', partReviewImport: 'palco:partitura:reviewImport', partUpdatePreview: 'palco:partitura:updatePreview',
  partList: 'palco:partitura:list',
  partSave: 'palco:partitura:save',
  partInsert: 'palco:partitura:insert',
  partRemove: 'palco:partitura:remove',
  partUpdate: 'palco:partitura:update',
  presetList: 'palco:presets:list',
  roleList: 'palco:presets:roles',
  wsGet: 'palco:workspace:get',
  wsChanged: 'palco:workspace:changed',
  wsCamera: 'palco:workspace:setCamera',
  wsDock: 'palco:workspace:setDock',
  nodeAdd: 'palco:node:add',
  nodePatch: 'palco:node:patch',
  nodeRemove: 'palco:node:remove',
  connAdd: 'palco:connection:add',
  connRemove: 'palco:connection:remove',
  termAttach: 'palco:terminal:attach',
  termDetach: 'palco:terminal:detach',
  termData: 'palco:terminal:data',
  termExit: 'palco:terminal:exit',
  termWrite: 'palco:terminal:write',
  termResize: 'palco:terminal:resize',
  termRestart: 'palco:terminal:restart',
  termReconfigure: 'palco:terminal:reconfigure',
  termResolveAgent: 'palco:terminal:resolveAgent',
  termFocused: 'palco:terminal:focused',
  termFocusRequest: 'palco:terminal:focusRequest',
  shellOpenExternal: 'palco:shell:openExternal',
  linksList: 'palco:links:list',
  linksGoTo: 'palco:links:goto',
  linksRemove: 'palco:links:remove',
  floorCreate: 'palco:floor:create',
  floorSwitch: 'palco:floor:switch',
  floorLand: 'palco:floor:land',
  floorRemove: 'palco:floor:remove',
  floorSetStatus: 'palco:floor:setStatus',
  bandCreate: 'palco:band:create',
  bandAdd: 'palco:band:add',
  bandRemove: 'palco:band:remove',
  bandDissolve: 'palco:band:dissolve',
  portalRegister: 'palco:portal:register',
  usageGet: 'palco:usage:get',
  usageVisible: 'palco:usage:setVisible',
  usageRefresh: 'palco:usage:refresh',
  usageChanged: 'palco:usage:changed',
  accountList: 'palco:accounts:list',
  accountAdd: 'palco:accounts:add',
  accountRemove: 'palco:accounts:remove',
  wsSidebar: 'palco:workspaces:sidebar',
  wsSidebarChanged: 'palco:workspaces:sidebarChanged',
  wsCreate: 'palco:workspaces:create',
  wsRename: 'palco:workspaces:rename',
  wsRemove: 'palco:workspaces:remove',
  wsSwitch: 'palco:workspaces:switch',
  wsMove: 'palco:workspaces:move',
  spaceCreate: 'palco:spaces:create',
  spaceRename: 'palco:spaces:rename',
  spaceRemove: 'palco:spaces:remove',
  spaceToggle: 'palco:spaces:toggle',
  pageCreate: 'palco:pages:create',
  pageEdit: 'palco:pages:edit',
  pageRemove: 'palco:pages:remove',
  pageSwitch: 'palco:pages:switch',
  wsStyle: 'palco:workspaces:style',
  wsIconSave: 'palco:workspaces:iconSave',
  wsIconLoad: 'palco:workspaces:iconLoad',
  wsIconDelete: 'palco:workspaces:iconDelete',
  wsIconChanged: 'palco:workspaces:iconChanged',
  drawAdd: 'palco:drawing:add',
  drawRemove: 'palco:drawing:remove',
  drawPatch: 'palco:drawing:patch',
  fileRead: 'palco:files:read',
  fileList: 'palco:files:list',
  filePick: 'palco:files:pick',
  fileExists: 'palco:files:exists',
  fileMkdir: 'palco:files:mkdir',
  metaWarning: 'palco:meta:warning',
  metaWarningChanged: 'palco:meta:warningChanged'
} as const

/** O que o IPC usa do registro de workspaces. */
export type IpcRegistry = Pick<WorkspaceRegistry,
  'active' | 'activeId' | 'storeOfNode' | 'node' | 'onChange' | 'onSidebar' | 'sidebar' | 'create' | 'rename' | 'remove'
  | 'switch' | 'move' | 'createSpace' | 'renameSpace' | 'removeSpace' | 'toggleSpace' | 'get' | 'warning'
  | 'createPage' | 'editPage' | 'removePage' | 'switchPage' | 'setWorkspaceStyle' | 'saveIcon' | 'loadIcon' | 'deleteIcon' | 'list' | 'idOf'>

type FloorOps = Pick<FloorService, 'create' | 'land' | 'remove' | 'setStatus'>

export interface IpcDeps {
  /** Sincronização das notas ligadas a arquivo e o diálogo nativo de salvar. */
  linkedNotes?: { moveOut(store: WorkspaceStore, id: string, path: string): void }
  pickSavePath?: (defaultName: string) => Promise<string | null>
  preferences?: PreferencesStore
  /** Limite de memória por terminal (a contagem do aviso ao reduzir o limite). */
  memoryGuard?: MemoryGuard
  chat?: ChatService
  /** A interface mostra o workspace ativo; operações por id vão ao workspace dono do nó. */
  registry: IpcRegistry
  agents?: AgentCatalog
  partituras?: PartituraStore
  /** Ditado local: o serviço do whisper e o portão do microfone. */
  voice?: { service: VoiceService; gate: MicGate; locale(): string }
  /** Rotinas agendadas (opcional: sem elas o painel fica vazio). */
  routines?: { store: RoutineStore; runner: RoutineRunner }
  /** Leitura do uso dos agentes (fontes locais). */
  usage?: () => Promise<AgentUsage[]>
  usageService?: UsageService
  accounts?: AccountStore
  /** Avisos de outras fontes (presets, roles, partituras, terminais que subiram sem role) para o banner. */
  notices?: { get(): Array<string | undefined>; onChange?(cb: () => void): () => void }
  /** Terminal com o foco do teclado na tela (`null` = nenhum): cala o aviso de atividade dele. */
  onTerminalFocused?: (id: string | null) => void
  /** Navegador do sistema (shell.openExternal); o IPC só deixa passar http/https. */
  openExternal?: (url: string) => Promise<void>
  /** Cordas entre workspaces, já resolvidas (só leitura) e o "ir até" um nó de outro workspace. */
  links?: { list(): CrossLinkView[]; goTo(nodeId: string): void; remove?(linkId: string): void }
  /** Seletor nativo (dialog.showOpenDialog); `null` se cancelado. */
  pickPath?: (kind: 'file' | 'dir') => Promise<string | null>
  /** Leitura só pelo main, com os tetos de `files.ts` (injetável para testes). */
  files?: { read(path: string): Promise<unknown>; list(dir: string): Promise<unknown> }
  terminals: TerminalManager
  /** Um serviço de floors por workspace (ou um só, quando há um workspace). */
  floors: FloorOps | ((store: WorkspaceStore) => FloorOps)
  portals: Pick<PortalManager, 'register' | 'unregister'> & Partial<Pick<PortalManager, 'capturePng'>>
  /** O webContents é um <webview> filho da janela do app? (nunca registre outro: o agente o controlaria.) */
  isPortalGuest: (webContentsId: number) => boolean
  getWindow: () => BrowserWindow | null
  /** Decide se a URL do frame remetente é o documento do app. */
  isTrustedUrl: (url: string) => boolean
}

/** Registra os handlers de IPC e liga store/terminais ao renderer. Devolve a função de limpeza. */
export function registerIpc({ voice, linkedNotes, pickSavePath, preferences, memoryGuard, chat, registry, terminals, floors: floorsDep, portals, isPortalGuest, getWindow, isTrustedUrl, routines, usage, usageService, accounts, agents, partituras, pickPath, files, notices, onTerminalFocused, openExternal, links }: IpcDeps): () => void {
  const history = new CanvasHistory({
    spawn: n => terminals.spawn(n), dispose: id => terminals.dispose(id), unregister: id => portals.unregister(id),
    // Desfazer a edição de um terminal: o processo de pé sobe de novo com o que voltou; o parado fica parado.
    restart: n => {
      if (!terminals.hasSession?.(n.id)) return
      void Promise.resolve(terminals.restart(n)).then(() => { terminalStartWarnings.delete(n.id) }, () => { terminalStartWarnings.set(n.id, 'Falha ao iniciar um terminal. Corrija a configuração em Editar terminal e use Reiniciar.') }).finally(() => checkWarning())
    }
  })
  let batching = false
  const mutationChannels = new Set<string>([CH.nodeAdd, CH.nodePatch, CH.nodeRemove, CH.connAdd, CH.connRemove, CH.drawAdd, CH.drawRemove, CH.drawPatch, CH.bandCreate, CH.bandAdd, CH.bandRemove, CH.bandDissolve, CH.groupCreate, CH.groupUngroup, CH.groupRename, CH.groupColor, CH.stackRename])
  const mutations = new Map<string, (...args: unknown[]) => unknown>()
  const mutationStore = (channel: string, args: unknown[]): WorkspaceStore => {
    if (([CH.nodePatch, CH.nodeRemove, CH.connAdd, CH.bandAdd, CH.bandRemove, CH.bandDissolve] as string[]).includes(channel)) {
      return registry.storeOfNode(parseId(args[0])) ?? registry.active()
    }
    if (channel === CH.bandCreate && Array.isArray(args[1]) && args[1][0]) return ownerOf(parseId(args[1][0]))
    if ((channel === CH.groupCreate || channel === CH.groupUngroup) && Array.isArray(args[0]) && typeof args[0][0] === 'string') return ownerOf(parseId(args[0][0]))
    return registry.active()
  }
  const terminalOf = (id: string): TerminalNode | undefined => {
    const n = registry.node(id)
    return n?.kind === 'terminal' ? n : undefined
  }
  /** Workspace dono do nó; nó desconhecido é erro (nunca cai no ativo por engano). */
  const ownerOf = (id: string): WorkspaceStore => {
    const store = registry.storeOfNode(id)
    if (!store) throw new Error('nó inexistente')
    return store
  }
  const floors = (): FloorOps => (typeof floorsDep === 'function' ? floorsDep(registry.active()) : floorsDep)

  const send = (channel: string, ...args: unknown[]): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args.map((a) => localizeResult(a)))
  }

  // Só o frame principal da nossa janela, com a URL do app, fala com a API privilegiada.
  const authorized = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const win = getWindow()
    const frame = event.senderFrame
    return !!win && event.sender === win.webContents && !!frame && frame.parent === null && isTrustedUrl(frame.url)
  }

  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    if (mutationChannels.has(channel)) mutations.set(channel, fn)
    ipcMain.handle(channel, (event, ...args) => {
      if (!authorized(event)) throw localizeError(new Error('remetente não autorizado'))
      return localized(() => mutationChannels.has(channel)
        ? history.transact(mutationStore(channel, args), () => fn(...args), false)
        : fn(...args))
    })
  }

  // Eventos `send` não têm resposta: payload ruim ou erro do PTY é registrado e descartado, nunca propagado.
  const listen = (channel: string, fn: (...args: unknown[]) => void): void => {
    ipcMain.on(channel, (event, ...args) => {
      try {
        if (!authorized(event)) return
        fn(...args)
      } catch (err) {
        console.warn(`palco: ${channel} recusado:`, err instanceof Error ? err.message : err)
      }
    })
  }

  const externallyClearedHistory = new WeakMap<WorkspaceStore, string | null>()
  const terminalStartWarnings = new Map<string, string>()
  // Avisos do registro (migração, barra) e do workspace ativo (arquivo recuperado etc.).
  const currentWarning = (): string | null => {
    const startWarnings = [...terminalStartWarnings]
      .filter(([id]) => registry.storeOfNode(id) === registry.active()).map(([, message]) => message)
    const all = [registry.warning, ...startWarnings, ...(notices?.get() ?? [])]
      .filter((w): w is string => typeof w === 'string' && w !== '')
    return all.length ? all.map((w) => localizeMessage(w)).join('; ') : null
  }
  let lastWarning = currentWarning()

  // As áreas de IPC registram seus canais em `src/main/ipc/`.
  const offAreas = registerAreas(AREAS, {
    handle, listen, send,
    deps: { preferences, ...(voice ? { voice } : {}), ...(memoryGuard ? { memoryGuard } : {}), ...(chat ? { chat } : {}), registry, terminals, floors: floorsDep, portals, isPortalGuest, getWindow, isTrustedUrl, ...(routines ? { routines } : {}), ...(usage ? { usage } : {}), ...(usageService ? { usageService } : {}), ...(accounts ? { accounts } : {}), ...(agents ? { agents } : {}), ...(partituras ? { partituras } : {}), ...(pickPath ? { pickPath } : {}), ...(files ? { files } : {}), ...(notices ? { notices } : {}), ...(onTerminalFocused ? { onTerminalFocused } : {}), ...(openExternal ? { openExternal } : {}), ...(links ? { links } : {}) }
  })
  handle(CH.metaWarning, () => currentWarning())
  handle(CH.partRename, (name, next) => { if (!partituras) throw new Error('partituras indisponíveis'); partituras.rename(parseBandName(name), parseBandName(next)) })
  handle(CH.partExport, name => { if (!partituras) throw new Error('partituras indisponíveis'); return partituras.export(name === undefined ? undefined : parseBandName(name)) })
  const importDocument = (document: unknown): string => { if (typeof document !== 'string' || document.length > 10_000_000) throw new Error('arquivo inválido'); return document }
  handle(CH.partImport, document => { if (!partituras) throw new Error('partituras indisponíveis'); partituras.import(importDocument(document)) })
  handle(CH.partReviewImport, document => { if (!partituras) throw new Error('partituras indisponíveis'); return partituras.reviewImport(importDocument(document)) })
  handle(CH.partInspect, name => { if (!partituras) throw new Error('partituras indisponíveis'); return reviewPartitura(partituras.get(parseBandName(name))) })
  handle(CH.partUpdatePreview, (rawName, rawOptions) => {
    if (!partituras) throw new Error('partituras indisponíveis')
    if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) throw new Error('opções inválidas')
    const opts = rawOptions as Record<string, unknown>
    return previewUpdate(partituras, registry.active(), parseBandName(rawName), registry.active().get().activeFloor, { noteText: opts.noteText === true, ids: new Set(parseMemberIds(opts.nodeIds)) })
  })
  handle(CH.partList, () => { const list = partituras?.list() ?? []; checkWarning(); return list })
  handle(CH.partSave, (rawName, rawOptions) => {
    if (!partituras) throw new Error('partituras indisponíveis')
    const name = parseBandName(rawName)
    if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) throw new Error('opções inválidas')
    const opts = rawOptions as Record<string, unknown>
    savePartitura(partituras, registry.active(), name, registry.active().get().activeFloor, { noteText: opts.noteText as boolean, ...(opts.description === undefined ? {} : { description: opts.description as string }), ...(opts.nodeIds === undefined ? {} : { ids: new Set(parseMemberIds(opts.nodeIds)) }) })
  })
  handle(CH.partUpdate, (rawName, rawOptions) => {
    if (!partituras) throw new Error('partituras indisponíveis')
    if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) throw new Error('opções inválidas')
    const opts = rawOptions as Record<string, unknown>
    updatePartitura(partituras, registry.active(), parseBandName(rawName), registry.active().get().activeFloor, { noteText: opts.noteText === true, ids: new Set(parseMemberIds(opts.nodeIds)) })
  })
  handle(CH.partInsert, (rawName, rawOptions) => {
    if (!partituras) throw new Error('partituras indisponíveis')
    if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) throw new Error('opções inválidas')
    const opts = rawOptions as Record<string, unknown>, store = registry.active(), ws = store.get()
    const camera = ws.activeFloor === null ? ws.camera : ws.floors[ws.activeFloor]!.camera
    startPartitura(partituras, store, parseBandName(rawName), ws.activeFloor, { x: -camera.offset.x / camera.zoom + 80, y: -camera.offset.y / camera.zoom + 80 }, opts.commands as boolean, n => terminals.spawn(n), agents, id => terminals.dispose(id), opts.confirmed === true)
  })
  handle(CH.partRemove, name => { if (!partituras) throw new Error('partituras indisponíveis'); partituras.remove(parseBandName(name)) })
  handle(CH.presetList, () => agents?.presets.list() ?? [])
  handle(CH.roleList, () => { const list = agents?.roles.list() ?? []; checkWarning(); return list })
  const historyStore = (raw: unknown): WorkspaceStore => registry.get(parseId(raw))
  const activeHistoryStore = (raw: unknown): WorkspaceStore => {
    const store = historyStore(raw)
    if (store !== registry.active()) throw new Error('workspace não está ativo')
    return store
  }
  const stepHistory = (raw: unknown, direction: 'undo' | 'redo'): boolean => {
    const store = activeHistoryStore(raw)
    const applied = history[direction](store)
    if (!applied && externallyClearedHistory.has(store)) {
      send(CH.historyNotice, localizeMessage('Nada para desfazer: um agente alterou o canvas.'))
    }
    return applied
  }
  handle(CH.historyUndo, raw => stepHistory(raw, 'undo'))
  handle(CH.historyRedo, raw => stepHistory(raw, 'redo'))
  handle(CH.historyCanUndo, raw => history.canUndo(historyStore(raw)))
  handle(CH.historyCanRedo, raw => history.canRedo(historyStore(raw)))
  handle(CH.historyCommit, (rawId, rawOperations) => {
    const store = historyStore(rawId)
    if (store !== registry.active()) throw new Error('workspace não está ativo')
    if (!Array.isArray(rawOperations) || rawOperations.length > MAX_HISTORY_BATCH) throw new Error(`lote inválido (máximo ${MAX_HISTORY_BATCH} operações)`)
    // Ponta de corda: id existente ou `{ op: i }`, o nó criado pelo node.add de índice i, anterior no mesmo lote.
    const isRef = (v: unknown): v is { op: number } => !!v && typeof v === 'object' && !Array.isArray(v)
    const checkRef = (v: { op: number }, at: number): void => {
      const i = (v as { op: unknown }).op
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= at) throw new Error('referência de nó inválida no lote (use o índice de um node.add anterior)')
      const target = rawOperations[i] as Record<string, unknown> | undefined
      if (!target || target.type !== 'node.add') throw new Error('referência de nó inválida no lote (o índice precisa ser de um node.add)')
    }
    const commands = rawOperations.map((raw, at) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('operação inválida')
      const op = raw as Record<string, unknown>
      let channel: string, args: unknown[]
      if (op.type === 'connection.add' && (isRef(op.a) || isRef(op.b))) {
        for (const end of [op.a, op.b]) {
          if (isRef(end)) checkRef(end, at)
          else if (registry.storeOfNode(parseId(end)) !== store) throw new Error('nó de outro workspace')
        }
        return { channel: CH.connAdd, args: [op.a, op.b], refs: true }
      }
      if (op.type === 'group.create') {
        if (!Array.isArray(op.members)) throw new Error('operação de histórico inválida')
        for (const member of op.members) {
          if (isRef(member)) checkRef(member, at)
          else if (registry.storeOfNode(parseId(member)) !== store) throw new Error('nó de outro workspace')
        }
        return { channel: CH.groupCreate, args: [op.members, op.name, op.color], refs: true }
      }
      switch (op.type) {
        case 'group.ungroup': channel = CH.groupUngroup; args = [op.ids]; break
        case 'stack.rename': channel = CH.stackRename; args = [op.id, op.name]; break
        case 'node.add': channel = CH.nodeAdd; args = [op.node]; break
        case 'node.patch': channel = CH.nodePatch; args = [op.id, op.patch]; break
        case 'node.remove': channel = CH.nodeRemove; args = [op.id]; break
        case 'connection.add': channel = CH.connAdd; args = [op.a, op.b]; break
        case 'connection.remove': channel = CH.connRemove; args = [op.id]; break
        case 'drawing.add': channel = CH.drawAdd; args = [op.drawing]; break
        case 'drawing.remove': channel = CH.drawRemove; args = [op.id]; break
        case 'drawing.patch': channel = CH.drawPatch; args = [op.id, op.patch]; break
        default: throw new Error('operação de histórico inválida')
      }
      // Never allow a batch scoped to A to mutate a node owned by B.
      if (mutationStore(channel, args) !== store) throw new Error('nó de outro workspace')
      if (channel === CH.connAdd && registry.storeOfNode(parseId(args[1])) !== store) throw new Error('nó de outro workspace')
      return { channel, args, refs: false }
    })
    return history.transact(store, () => {
      batching = true
      try {
        const results: unknown[] = []
        for (const { channel, args, refs } of commands) {
          const resolve = (a: unknown): unknown => (isRef(a) ? results[a.op] : Array.isArray(a) ? a.map(resolve) : a)
          const resolved = refs ? args.map(resolve) : args
          results.push(mutations.get(channel)!(...resolved))
        }
        return results
      } finally { batching = false }
    })
  })
  handle(CH.wsGet, () => registry.active().get())
  handle(CH.wsCamera, (camera) => registry.active().setCamera(parseCamera(camera)))
  handle(CH.wsDock, (state) => registry.active().setDockState(parseDockState(state)))

  handle(CH.nodeAdd, (raw) => {
    const node = parseNewNode(raw)
    const store = registry.active()
    if (node.kind === 'terminal' && node.role) {
      if (!agents) throw new Error('roles indisponíveis')
      node.role = agents.roles.get(node.role).name
    }
    // Terminal novo sem pasta: dentro de um floor começa na worktree dele; no Ground, na home.
    const floorDir = node.kind === 'terminal' && node.floorId !== null ? store.get().floors[node.floorId]?.dir : undefined
    // `~/…` vira a pasta pessoal (o renderer não a conhece).
    const prepared = node.kind !== 'terminal' ? node
      : node.cwd === '' ? { ...node, cwd: floorDir ?? homedir() } : { ...node, cwd: expandHome(node.cwd, homedir()) }
    const id = store.addNode(prepared)
    const created = terminalOf(id)
    if (created && !batching) {
      try { terminals.spawn(created) }
      catch {
        // A single new card must remain editable/restartable if its first boot fails.
        // Batches still use strict reconcile/rollback and never swallow a spawn failure.
        try { terminals.dispose(id) } catch { /* best effort: only this new ID */ }
        terminalStartWarnings.set(id, 'Falha ao iniciar um terminal. Corrija a configuração em Editar terminal e use Reiniciar.')
        checkWarning()
      }
    }
    return id
  })
  handle(CH.nodePatch, (rawId, rawPatch) => {
    const id = parseId(rawId)
    const store = ownerOf(id)
    const target = store.get().nodes[id]!
    store.patchNode(id, parseNodePatch(rawPatch, target.kind))
  })
  handle(CH.nodeRemove, (rawId) => {
    const id = parseId(rawId)
    const store = registry.storeOfNode(id)
    // A trava é conferida antes de encerrar o processo: um bloqueado não perde nem o nó nem o terminal.
    store?.assertRemovable(id)
    if (!batching) { terminals.dispose(id); portals.unregister(id) }
    store?.removeNode(id)
  })

  // '~' = pasta pessoal (o renderer não conhece o home).
  handle(CH.floorCreate, (raw) => {
    const input = parseNewFloor(raw)
    return floors().create(input.fromDir === '~' ? { ...input, fromDir: homedir() } : input)
  })
  handle(CH.floorSwitch, (id) => registry.active().setActiveFloor(parseFloorId(id)))
  handle(CH.floorLand, (id, opts) => floors().land(parseId(id), parseLandOptions(opts)))
  handle(CH.floorRemove, (id, opts) => floors().remove(parseId(id), parseRemoveOptions(opts)))
  handle(CH.floorSetStatus, (id, status) => floors().setStatus(parseId(id), parseFloorStatus(status)))

  handle(CH.bandCreate, (rawName, rawMembers) => {
    const name = parseBandName(rawName)
    const members = parseMemberIds(rawMembers)
    if (members.length === 0) throw new Error('a banda precisa de ao menos um membro')
    const store = registry.storeOfNode(members[0]!)
    const first = store?.get().nodes[members[0]!]
    if (!store || !first) throw new Error('membro inexistente')
    return store.createBand(name, members, first.floorId)
  })
  handle(CH.bandAdd, (band, member) => ownerOf(parseId(band)).bandAdd(parseId(band), parseId(member)))
  handle(CH.bandRemove, (band, member) => ownerOf(parseId(band)).bandRemove(parseId(band), parseId(member)))
  handle(CH.bandDissolve, (band) => ownerOf(parseId(band)).dissolveBand(parseId(band)))

  // O renderer diz qual <webview> pertence ao nó; só vale se for um convidado desta janela e o nó for um portal.
  listen(CH.portalRegister, (rawNode, rawContents) => {
    const nodeId = parseId(rawNode)
    const contentsId = parseWebContentsId(rawContents)
    if (registry.node(nodeId)?.kind !== 'portal') throw new Error('o nó não é um portal')
    if (!isPortalGuest(contentsId)) throw new Error('o webContents não é um portal desta janela')
    portals.register(nodeId, contentsId)
  })

  handle(CH.connAdd, (a, b) => ownerOf(parseId(a)).connect(parseId(a), parseId(b)))
  handle(CH.connRemove, (id) => registry.active().disconnect(parseId(id)))

  handle(CH.termAttach, (id) => terminals.attach(parseId(id)))
  handle(CH.termDetach, (id) => terminals.detach(parseId(id)))
  listen(CH.termWrite, (id, data) => terminals.write(parseId(id), parseData(data)))
  handle(CH.shellOpenExternal, async (raw) => {
    const url = parseExternalUrl(raw)
    if (!openExternal) throw new Error('navegador externo indisponível')
    await openExternal(url)
  })
  listen(CH.termFocused, (id) => onTerminalFocused?.(id === null ? null : parseId(id)))
  handle(CH.linksList, () => links?.list() ?? [])
  handle(CH.linksGoTo, (id) => { links?.goTo(parseId(id)) })
  handle(CH.linksRemove, (id) => { links?.remove?.(parseId(id)) })
  listen(CH.termResize, (id, cols, rows) => {
    const dims = parseDims(cols, rows)
    terminals.resize(parseId(id), dims.cols, dims.rows)
  })
  // Reiniciar: encerra o processo (se roda) e sobe de novo com a configuração atual do nó.
  handle(CH.termRestart, async (rawId) => {
    const id = parseId(rawId)
    const node = terminalOf(id)
    // Recarregar um descarregado é acordar: a marca só sai com o processo de pé.
    if (node?.unloaded) {
      await wakeNode({ registry, terminals, portals }, id)
      terminalStartWarnings.delete(id)
      checkWarning()
      return
    }
    if (node) {
      await terminals.restart(node)
      terminalStartWarnings.delete(node.id)
      checkWarning()
    }
  })
  handle(CH.termResolveAgent, async (rawCommand) => {
    if (typeof rawCommand !== 'string' || rawCommand.length > 4096) throw new Error('command inválido')
    return resolveAgentForCommand(rawCommand, { shell: process.env.SHELL ?? '/bin/bash' })
  })
  // Editar terminal: comando e pasta novos (validados aqui), gravados e aplicados reiniciando o processo.
  handle(CH.termReconfigure, async (rawId, raw, rawPatch) => {
    const id = parseId(rawId)
    const node = terminalOf(id)
    if (!node) throw new Error('o nó não é um terminal')
    const store = ownerOf(id)
    const floorDir = node.floorId !== null ? store.get().floors[node.floorId]?.dir : undefined
    // Tudo é validado antes de gravar qualquer coisa: pasta ruim não deixa nome/aparência/monitor pela metade.
    const config = parseTerminalConfig(raw, { home: homedir(), defaultDir: floorDir ?? homedir() })
    const patch = rawPatch === undefined || rawPatch === null ? undefined : parseNodePatch(rawPatch, 'terminal')
    history.transact(store, () => {
      if (patch && Object.keys(patch).length > 0) store.patchNode(id, patch)
      store.reconfigureTerminal(id, config)
    }, false)
    const updated = terminalOf(id)
    if (updated) {
      await terminals.restart(updated)
      terminalStartWarnings.delete(updated.id)
      checkWarning()
    }
  })


  // Grupos: o dono é o workspace dos elementos; renomear e colorir valem no workspace aberto.
  const members = (raw: unknown): { ids: string[]; store: WorkspaceStore } => {
    const ids = parseMemberIds(raw), store = ids.length ? ownerOf(ids[0]!) : registry.active()
    if (!ids.every((id) => store.hasNode(id))) throw new Error('nó de outro workspace')
    return { ids, store }
  }
  const groupColorArg = (raw: unknown): string | null => { if (raw !== null && typeof raw !== 'string') throw new Error('cor de grupo inválida'); return raw }
  handle(CH.groupCreate, (rawIds, name, color) => {
    const { ids, store } = members(rawIds)
    const id = store.groupNodes(ids)
    if (id !== null && name !== undefined) store.renameGroup(id, name as string)
    if (id !== null && color !== undefined) store.setGroupColor(id, groupColorArg(color))
    return id
  })
  handle(CH.groupUngroup, (rawIds) => { const { ids, store } = members(rawIds); store.ungroupNodes(ids) })
  handle(CH.groupRename, (id, name) => registry.active().renameGroup(parseId(id), name as string))
  handle(CH.groupColor, (id, color) => registry.active().setGroupColor(parseId(id), groupColorArg(color)))
  // Nome do fichário; vazio ou `null` volta ao nome automático.
  handle(CH.stackRename, (rawId, name) => {
    const id = parseId(rawId), store = registry.active()
    if (name !== null && (typeof name !== 'string' || name.trim().length > MAX_GROUP_NAME)) throw new Error('nome de fichário inválido')
    if (!Object.values(store.get().nodes).some((n) => n.kind === 'note' && n.stackId === id)) throw new Error('fichário inexistente')
    store.setStackName(id, typeof name === 'string' && name.trim() !== '' ? name : null)
  })
  const noteOf = (raw: unknown): { id: string; store: WorkspaceStore; node: NoteNode } => {
    const id = parseId(raw), store = ownerOf(id), node = store.get().nodes[id]!
    if (node.kind !== 'note') throw new Error('o nó não é uma nota')
    return { id, store, node }
  }
  handle(CH.noteUnlink, (raw) => { const { id, store } = noteOf(raw); history.transact(store, () => store.unlinkNote(id), false) })
  // "Mover para fora": o destino vem do diálogo nativo, nunca do renderer.
  handle(CH.noteMoveOut, async (raw) => {
    const { id, node } = noteOf(raw)
    if (node.linkedFile) throw new Error('a nota já está ligada a um arquivo')
    const chosen = await pickSavePath?.(`${node.name.replace(/[/\\\u0000-\u001f]+/g, '-').slice(0, 80) || 'nota'}.md`)
    if (!chosen) return false
    const store = ownerOf(id)
    history.transact(store, () => { if (!linkedNotes) throw new Error('notas em arquivo indisponíveis'); linkedNotes.moveOut(store, id, isNoteFilePath(chosen) ? chosen : `${chosen}.md`) }, false)
    return true
  })
  handle(CH.drawAdd, (raw) => registry.active().addDrawing(parseDrawing(raw)))
  handle(CH.drawRemove, (id) => registry.active().removeDrawing(parseId(id)))
  handle(CH.drawPatch, (id, patch) => registry.active().patchDrawing(parseId(id), parseDrawingPatch(patch)))
  handle(CH.fileRead, (path) => (files ?? defaultFiles).read(parsePath(path)))
  handle(CH.fileList, (dir) => (files ?? defaultFiles).list(parsePath(dir)))
  // Diretório do terminal novo: confere e cria (fora da pasta pessoal só com a confirmação extra do diálogo).
  const dirArg = (raw: unknown): string => parsePath(expandHome(typeof raw === 'string' ? raw : '', homedir()))
  handle(CH.fileExists, (raw) => pathExists(dirArg(raw)))
  handle(CH.fileMkdir, (raw, rawOpts) => {
    const outsideHome = typeof rawOpts === 'object' && rawOpts !== null && (rawOpts as { outsideHome?: unknown }).outsideHome === true
    return makeDirectory(dirArg(raw), { home: homedir(), outsideHome })
  })
  handle(CH.filePick, (kind) => {
    if (kind !== 'file' && kind !== 'dir') throw new Error('tipo de seleção inválido')
    return pickPath ? pickPath(kind) : null
  })
  handle(CH.usageGet, () => usageService?.snapshot() ?? usage?.() ?? [])
  const usageViewers = new Set<string>()
  let usageContents: BrowserWindow['webContents'] | undefined
  const forgetUsageViewers = (): void => {
    usageViewers.clear()
    usageService?.setVisible(false)
    usageContents?.removeListener?.('destroyed', forgetUsageViewers)
    usageContents?.removeListener?.('did-navigate', forgetUsageViewers)
    usageContents = undefined
  }
  handle(CH.usageVisible, (visible, rawId) => {
    if (typeof visible !== 'boolean') throw new Error('visibilidade inválida')
    const id = rawId === undefined ? 'default' : parseId(rawId)
    if (visible) {
      if (!usageContents) {
        usageContents = getWindow()?.webContents
        usageContents?.once?.('destroyed', forgetUsageViewers)
        usageContents?.once?.('did-navigate', forgetUsageViewers)
      }
      usageViewers.add(id)
    } else usageViewers.delete(id)
    usageService?.setVisible(usageViewers.size > 0)
  })
  handle(CH.usageRefresh, async (id) => {
    const accountId = id === undefined ? undefined : parseId(id)
    await usageService?.refresh(accountId)
    return usageService?.snapshot() ?? []
  })
  handle(CH.accountList, () => accounts?.list() ?? [])
  handle(CH.accountAdd, (input) => {
    if (!accounts) throw new Error('contas indisponíveis')
    return accounts.add(accountInput(input, homedir()))
  })
  handle(CH.accountRemove, (id) => {
    if (!accounts) throw new Error('contas indisponíveis')
    accounts.remove(parseId(id))
  })
  const offUsage = usageService?.onChange(() => send(CH.usageChanged, usageService.snapshot())) ?? (() => {})

  // Workspaces e spaces da barra lateral.
  const text = (v: unknown): string => {
    if (typeof v !== 'string' || v.trim() === '' || v.length > 200) throw new Error('nome inválido')
    return v
  }
  const spaceRef = (v: unknown): string | null => (v === null || v === undefined ? null : parseId(v))
  handle(CH.wsSidebar, () => registry.sidebar())
  handle(CH.wsCreate, (name, space) => registry.create(text(name), spaceRef(space)))
  handle(CH.wsRename, (id, name) => registry.rename(parseId(id), text(name)))
  handle(CH.wsRemove, (rawId) => removeWorkspace(registry, parseId(rawId), {
    disposeTerminal: id => terminals.dispose(id), unregisterPortal: id => portals.unregister(id)
  }))
  handle(CH.wsSwitch, (id) => registry.switch(parseId(id)))
  handle(CH.wsMove, (id, space, index, page) => {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new Error('posição inválida')
    if (page === undefined || page === null) registry.move(parseId(id), spaceRef(space), index)
    else registry.move(parseId(id), spaceRef(space), index, parseId(page))
  })
  handle(CH.spaceCreate, (name) => registry.createSpace(text(name)))
  handle(CH.spaceRename, (id, name) => registry.renameSpace(parseId(id), text(name)))
  handle(CH.spaceRemove, (id) => void registry.removeSpace(parseId(id)))
  handle(CH.spaceToggle, (id) => registry.toggleSpace(parseId(id)))

  // Espaços (páginas da barra) e aparência do workspace. O registro valida nome, ícone e cor; aqui só a forma.
  const fields = (v: unknown, allowed: readonly string[]): Record<string, unknown> => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('payload inválido')
    const o = v as Record<string, unknown>
    for (const key of Object.keys(o)) if (!allowed.includes(key)) throw new Error(`campo '${key}' não pode ser alterado`)
    return o
  }
  const optText = (v: unknown, nullable: boolean): string | null | undefined => {
    if (v === undefined || (nullable && v === null)) return v as null | undefined
    if (typeof v !== 'string' || v.length > 200) throw new Error('valor inválido')
    return v
  }
  const style = <K extends string>(o: Record<string, unknown>, keys: readonly K[], nullable: boolean): Partial<Record<K, string | null>> =>
    Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, optText(o[k], nullable)])) as Partial<Record<K, string | null>>
  handle(CH.pageCreate, (raw) => {
    const o = fields(raw, ['name', 'icon', 'color'])
    return registry.createPage({ name: text(o.name), ...(style(o, ['icon', 'color'], false) as { icon?: string; color?: string }) })
  })
  handle(CH.pageEdit, (id, raw) => {
    const o = fields(raw, ['name', 'icon', 'color'])
    registry.editPage(parseId(id), { ...(o.name !== undefined ? { name: text(o.name) } : {}), ...(style(o, ['icon'], false) as { icon?: string }), ...(style(o, ['color'], true) as { color?: string | null }) })
  })
  handle(CH.pageRemove, (id) => registry.removePage(parseId(id)))
  handle(CH.pageSwitch, (id) => registry.switchPage(parseId(id)))
  const wsRef = (v: unknown): string => {
    const id = parseId(v)
    assertWorkspaceId(id)
    return id
  }
  handle(CH.wsStyle, (id, raw) => registry.setWorkspaceStyle(wsRef(id), style(fields(raw, ['icon', 'color']), ['icon', 'color'], true)))
  handle(CH.wsIconSave, (id, bytes) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('imagem inválida')
    const wsId = wsRef(id)
    registry.saveIcon(wsId, bytes)
    send(CH.wsIconChanged, wsId)
  })
  handle(CH.wsIconLoad, (id) => registry.loadIcon(wsRef(id)))
  handle(CH.wsIconDelete, (id) => {
    const wsId = wsRef(id)
    registry.deleteIcon(wsId)
    send(CH.wsIconChanged, wsId)
  })

  const checkWarning = (): void => {
    const warning = currentWarning()
    if (warning !== lastWarning) {
      lastWarning = warning
      send(CH.metaWarningChanged, warning)
    }
  }
  // Só o workspace ativo vai para a tela; os outros seguem rodando e gravando.
  const offNotices = notices?.onChange?.(() => checkWarning()) ?? (() => {})
  const offChange = registry.onChange((id, ws) => {
    const store = registry.get(id)
    if (externallyClearedHistory.has(store) && externallyClearedHistory.get(store) !== ws.activeFloor) externallyClearedHistory.delete(store)
    if (history.busy && (history.canUndo(store) || history.canRedo(store))) externallyClearedHistory.delete(store)
    if (history.observe(store)) externallyClearedHistory.set(store, ws.activeFloor)
    for (const nodeId of terminalStartWarnings.keys()) if (!registry.node(nodeId)) terminalStartWarnings.delete(nodeId)
    if (id === registry.activeId()) send(CH.wsChanged, ws)
    checkWarning()
  })
  let shownWorkspace = registry.activeId()
  const offSidebar = registry.onSidebar((side) => {
    // O evento da barra não traz as contagens (terminais) nem o cadeado: a interface recebe o estado completo.
    send(CH.wsSidebarChanged, registry.sidebar?.() ?? side)
    if (side.active !== shownWorkspace) {
      shownWorkspace = side.active
      send(CH.wsChanged, registry.active().get())
    }
    checkWarning()
  })
  const offData = terminals.onData((id, data, seq, gen) => send(CH.termData, id, data, seq, gen))
  const offExit = terminals.onExit((id, code) => send(CH.termExit, id, code))

  return () => {
    forgetUsageViewers()
    offAreas()
    offUsage()
    offNotices()
    offChange()
    offSidebar()
    offData()
    offExit()
    for (const ch of Object.values(CH)) {
      ipcMain.removeHandler(ch)
      ipcMain.removeAllListeners(ch)
    }
  }
}
