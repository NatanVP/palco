import { CLIPBOARD_CH as CCH } from '../shared/clipboard'
import { NODE_STATE_CH as NCH } from '../shared/node-state'
import { ABOUT_CH as ABCH, GIT_HOSTS_CH as GCH } from '../shared/about-git'
import { DATA_CH as DCH } from '../shared/data-settings'
import { ACCOUNT_SETTINGS_CH as ACH, PROVIDERS_CH as PCH } from '../shared/account-settings'
import { LIBRARY_CH as LCH } from '../shared/agent-libraries'
import { SYSTEM_CH, type SystemSnapshot } from '../shared/system'
import type { Preferences } from '../shared/preferences'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PalcoApi, RoutineView } from '../shared/api'
import type { RoutineRun } from '../shared/model'
import type { VoiceProgress } from '../shared/voice'
import type { AgentUsage, Sidebar } from '../shared/model'
import type { Workspace } from '../shared/model'

// Mantido em sincronia com CH em src/main/ipc.ts (o preload cjs não importa do main).
const CH = {
  shutdownBegin: 'palco:shutdown:begin', shutdownPainted: 'palco:shutdown:painted',
  prefsGet: 'palco:preferences:get', prefsSet: 'palco:preferences:set', prefsChanged: 'palco:preferences:changed',
  prefsBind: 'palco:preferences:bind', prefsReset: 'palco:preferences:resetShortcuts',
  historyNotice: 'palco:history:notice',
  historyUndo: 'palco:history:undo',
  historyRedo: 'palco:history:redo',
  historyCanUndo: 'palco:history:canUndo',
  historyCanRedo: 'palco:history:canRedo',
  historyCommit: 'palco:history:commit',
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
  floorStatus: 'palco:floor:setStatus',
  bandCreate: 'palco:band:create',
  bandAdd: 'palco:band:add',
  bandRemove: 'palco:band:remove',
  bandDissolve: 'palco:band:dissolve',
  portalRegister: 'palco:portal:register',
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
  fileMaterialize: 'palco:files:materialize', fileRead: 'palco:files:read',
  fileList: 'palco:files:list',
  filePick: 'palco:files:pick',
  fileExists: 'palco:files:exists',
  fileMkdir: 'palco:files:mkdir',
  usageGet: 'palco:usage:get',
  usageVisible: 'palco:usage:setVisible',
  usageRefresh: 'palco:usage:refresh',
  usageChanged: 'palco:usage:changed',
  accountList: 'palco:accounts:list',
  accountAdd: 'palco:accounts:add',
  accountRemove: 'palco:accounts:remove',
  partRename: 'palco:partitura:rename', partExport: 'palco:partitura:export', partImport: 'palco:partitura:import',
  stackRename: 'palco:stack:rename',
  noteUnlink: 'palco:noteFile:unlink', noteMoveOut: 'palco:noteFile:moveOut',
  groupCreate: 'palco:group:create', groupUngroup: 'palco:group:ungroup', groupRename: 'palco:group:rename', groupColor: 'palco:group:color',
  partInspect: 'palco:partitura:inspect', partReviewImport: 'palco:partitura:reviewImport', partUpdatePreview: 'palco:partitura:updatePreview',
  partList: 'palco:partitura:list',
  partSave: 'palco:partitura:save',
  partInsert: 'palco:partitura:insert',
  partRemove: 'palco:partitura:remove', partUpdate: 'palco:partitura:update',
  presetList: 'palco:presets:list',
  roleList: 'palco:presets:roles',
  presetSet: 'palco:presets:set', presetCreate: 'palco:presets:create', presetRemove: 'palco:presets:remove', presetReorder: 'palco:presets:reorder', presetRestore: 'palco:presets:restore', presetMissing: 'palco:presets:missing', presetReset: 'palco:presets:reset',
  memCount: 'palco:terminal:memoryCountAbove',
  envStatus: 'palco:environments:status', railTerminals: 'palco:rail:terminals', railAttention: 'palco:rail:attention',
  fileTrash: 'palco:files:trash', fileRename: 'palco:files:rename', fileStore: 'palco:files:storeAttachment', fileKind: 'palco:files:kind', fileNoteText: 'palco:files:noteText',
  chatState: 'palco:chat:state', chatOlder: 'palco:chat:older', chatSend: 'palco:chat:send', chatInterrupt: 'palco:chat:interrupt', chatAck: 'palco:chat:acknowledge', chatRead: 'palco:chat:markRead',
  chatThread: 'palco:chat:switchThread', chatClearThread: 'palco:chat:clearThread', chatClearAll: 'palco:chat:clearHistory', chatDelete: 'palco:chat:deleteEntry', chatAttachment: 'palco:chat:attachment', chatPreview: 'palco:chat:preview', chatChanged: 'palco:chat:changed',
  routineList: 'palco:routine:list',
  routineChanged: 'palco:routine:changed',
  routineSetEnabled: 'palco:routine:setEnabled',
  routineRunNow: 'palco:routine:runNow',
  routineRemove: 'palco:routine:remove',
  voiceStatus: 'palco:voice:status', voiceInstall: 'palco:voice:install', voiceCancel: 'palco:voice:cancel', voiceRemove: 'palco:voice:remove', voiceArm: 'palco:voice:arm', voiceTranscribe: 'palco:voice:transcribe', voiceProgress: 'palco:voice:progress',
  routineSave: 'palco:routine:save',
  routineHistory: 'palco:routine:history',
  routineHistoryChanged: 'palco:routine:historyChanged',
  routineHistoryRemove: 'palco:routine:historyRemove',
  routineHistoryClear: 'palco:routine:historyClear',
  metaWarning: 'palco:meta:warning',
  metaWarningChanged: 'palco:meta:warningChanged'
} as const

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PalcoApi = {
  shutdown: { onBegin: cb => subscribe(CH.shutdownBegin, cb), painted: () => ipcRenderer.send(CH.shutdownPainted) },
  stack: { rename: (stackId, name) => ipcRenderer.invoke(CH.stackRename, stackId, name) },
  noteFile: {
    unlink: id => ipcRenderer.invoke(CH.noteUnlink, id),
    moveOut: id => ipcRenderer.invoke(CH.noteMoveOut, id)
  },
  group: {
    create: ids => ipcRenderer.invoke(CH.groupCreate, ids),
    ungroup: ids => ipcRenderer.invoke(CH.groupUngroup, ids),
    rename: (id, name) => ipcRenderer.invoke(CH.groupRename, id, name),
    color: (id, color) => ipcRenderer.invoke(CH.groupColor, id, color)
  },
  nodeState: { unload: ids => ipcRenderer.invoke(NCH.unload, ids), wake: id => ipcRenderer.invoke(NCH.wake, id), reveal: id => ipcRenderer.invoke(NCH.reveal, id), open: id => ipcRenderer.invoke(NCH.open, id), copyFile: id => ipcRenderer.invoke(NCH.copyFile, id), clearPortalStorage: id => ipcRenderer.invoke(NCH.clearPortalStorage, id), copyScreenshot: id => ipcRenderer.invoke(NCH.copyScreenshot, id) },
  clipboard: { read: () => ipcRenderer.invoke(CCH.read), writeText: text => ipcRenderer.invoke(CCH.writeText, text), saveImage: () => ipcRenderer.invoke(CCH.saveImage) },
  about: { openRuntimeLicenses: () => ipcRenderer.invoke(ABCH+'openRuntimeLicenses'), openContact: () => ipcRenderer.invoke(ABCH+'openContact'), info: () => ipcRenderer.invoke(ABCH+'info'), report: () => ipcRenderer.invoke(ABCH+'report'), saveReport: () => ipcRenderer.invoke(ABCH+'saveReport'), completeOnboarding: () => ipcRenderer.invoke(ABCH+'completeOnboarding'), reopenOnboarding: () => ipcRenderer.invoke(ABCH+'reopenOnboarding'), onOnboarding: cb => { const listener = () => cb(); ipcRenderer.on(ABCH+'onboarding',listener); return () => { ipcRenderer.removeListener(ABCH+'onboarding',listener) } } },
  gitHosts: { state: () => ipcRenderer.invoke(GCH+'state'), check: id => ipcRenderer.invoke(GCH+'check',id), restore: (id,digest) => ipcRenderer.invoke(GCH+'restore',id,digest), restoreMissing: () => ipcRenderer.invoke(GCH+'restoreMissing'), reload: () => ipcRenderer.invoke(GCH+'reload'), showFolder: () => ipcRenderer.invoke(GCH+'showFolder'), copyPath: () => ipcRenderer.invoke(GCH+'copyPath') },
  dataSettings: {
    state: () => ipcRenderer.invoke(DCH+'state'), usage: () => ipcRenderer.invoke(DCH+'usage'), pickRoot: () => ipcRenderer.invoke(DCH+'pickRoot'), moveRoot: path => ipcRenderer.invoke(DCH+'moveRoot',path), showFolder: backups => ipcRenderer.invoke(DCH+'showFolder',backups), backupNow: () => ipcRenderer.invoke(DCH+'backupNow'), exportZip: () => ipcRenderer.invoke(DCH+'exportZip'), pickImport: () => ipcRenderer.invoke(DCH+'pickImport'), prepareSnapshot: id => ipcRenderer.invoke(DCH+'prepareSnapshot',id), restore: token => ipcRenderer.invoke(DCH+'restore',token), deleteSnapshot: id => ipcRenderer.invoke(DCH+'deleteSnapshot',id), deleteGroup: id => ipcRenderer.invoke(DCH+'deleteGroup',id), signOutAll: () => ipcRenderer.invoke(DCH+'signOutAll'), reset: () => ipcRenderer.invoke(DCH+'reset'), clearGlobal: () => ipcRenderer.invoke(DCH+'clearGlobal')
  },
  accountSettings: {
    setColor: (id,color) => ipcRenderer.invoke(ACH+'setColor',id,color),
    terminals: () => ipcRenderer.invoke(ACH+'terminals'), list: () => ipcRenderer.invoke(ACH+'list'), secureStorage: () => ipcRenderer.invoke(ACH+'secureStorage'), add: input => ipcRenderer.invoke(ACH+'add',input), check: id => ipcRenderer.invoke(ACH+'check',id), login: id => ipcRenderer.invoke(ACH+'login',id), logout: id => ipcRenderer.invoke(ACH+'logout',id), rename: (id,name) => ipcRenderer.invoke(ACH+'rename',id,name), replaceKey: (id,key) => ipcRenderer.invoke(ACH+'replaceKey',id,key), remove: id => ipcRenderer.invoke(ACH+'remove',id), assign: (terminal,account,restart) => ipcRenderer.invoke(ACH+'assign',terminal,account,restart), setUsageEnabled: value => ipcRenderer.invoke(ACH+'setUsageEnabled',value)
  },
  providers: { restoreOne: (area,id) => ipcRenderer.invoke(PCH+'restoreOne',area,id), path: area => ipcRenderer.invoke(PCH+'path',area), list: area => ipcRenderer.invoke(PCH+'list',area), configure: (area,id,patch) => ipcRenderer.invoke(PCH+'configure',area,id,patch), restore: (area,all) => ipcRenderer.invoke(PCH+'restore',area,all), showFolder: area => ipcRenderer.invoke(PCH+'showFolder',area), reload: area => ipcRenderer.invoke(PCH+'reload',area) },
  prompts: {
    list: workspace => ipcRenderer.invoke(LCH.promptList, workspace), read: id => ipcRenderer.invoke(LCH.promptRead, id),
    save: draft => ipcRenderer.invoke(LCH.promptSave, draft), remove: id => ipcRenderer.invoke(LCH.promptRemove, id),
    undo: token => ipcRenderer.invoke(LCH.promptUndo, token), showFolder: workspace => ipcRenderer.invoke(LCH.promptFolder, workspace),
    directory: workspace => ipcRenderer.invoke(LCH.promptDirectory, workspace)
  },
  roles: { list: () => ipcRenderer.invoke(LCH.roleList), save: draft => ipcRenderer.invoke(LCH.roleSave, draft), remove: names => ipcRenderer.invoke(LCH.roleRemove, names), discover: workspace => ipcRenderer.invoke(LCH.roleDiscover, workspace), import: (candidates, workspace) => ipcRenderer.invoke(LCH.roleImport, candidates, workspace) },
  skills: { list: () => ipcRenderer.invoke(LCH.skillList), save: draft => ipcRenderer.invoke(LCH.skillSave, draft), remove: id => ipcRenderer.invoke(LCH.skillRemove, id), reorder: ids => ipcRenderer.invoke(LCH.skillReorder, ids), reset: () => ipcRenderer.invoke(LCH.skillReset) },
  system: {
    snapshot: () => ipcRenderer.invoke(SYSTEM_CH.snapshot),
    onChange: cb => subscribe<[SystemSnapshot]>(SYSTEM_CH.changed, cb),
    nextAttention: () => ipcRenderer.invoke(SYSTEM_CH.next),
    focus: id => ipcRenderer.invoke(SYSTEM_CH.focus, id),
    dismiss: id => ipcRenderer.invoke(SYSTEM_CH.dismiss, id)
  },
  preferences: {
    get: () => ipcRenderer.invoke(CH.prefsGet),
    set: patch => ipcRenderer.invoke(CH.prefsSet, patch),
    onChange: cb => subscribe<[Preferences]>(CH.prefsChanged, cb),
    bind: (id, binding) => ipcRenderer.invoke(CH.prefsBind, id, binding),
    resetShortcuts: () => ipcRenderer.invoke(CH.prefsReset)
  },
  environments: { status: () => ipcRenderer.invoke(CH.envStatus) },
  rail: { terminals: id => ipcRenderer.invoke(CH.railTerminals, id), attention: () => ipcRenderer.invoke(CH.railAttention) },
  chat: {
    state: (id, thread) => ipcRenderer.invoke(CH.chatState, id, thread),
    older: (id, thread, before) => ipcRenderer.invoke(CH.chatOlder, id, thread, before),
    send: (id, message) => ipcRenderer.invoke(CH.chatSend, id, message),
    interrupt: id => ipcRenderer.invoke(CH.chatInterrupt, id),
    acknowledge: id => ipcRenderer.invoke(CH.chatAck, id),
    markRead: id => ipcRenderer.invoke(CH.chatRead, id),
    switchThread: (id, thread) => ipcRenderer.invoke(CH.chatThread, id, thread),
    clearThread: (id, thread) => ipcRenderer.invoke(CH.chatClearThread, id, thread),
    clearHistory: id => ipcRenderer.invoke(CH.chatClearAll, id),
    deleteEntry: (id, thread, entry) => ipcRenderer.invoke(CH.chatDelete, id, thread, entry),
    attachment: (id, attachmentId) => ipcRenderer.invoke(CH.chatAttachment, id, attachmentId),
    preview: id => ipcRenderer.invoke(CH.chatPreview, id),
    onChange: cb => subscribe<[string]>(CH.chatChanged, cb)
  },
  history: {
    onNotice: cb => subscribe<[string]>(CH.historyNotice, cb),
    undo: id => ipcRenderer.invoke(CH.historyUndo, id),
    redo: id => ipcRenderer.invoke(CH.historyRedo, id),
    canUndo: id => ipcRenderer.invoke(CH.historyCanUndo, id),
    canRedo: id => ipcRenderer.invoke(CH.historyCanRedo, id),
    commit: (id, operations) => ipcRenderer.invoke(CH.historyCommit, id, operations)
  },
  workspace: {
    get: () => ipcRenderer.invoke(CH.wsGet),
    onChange: (cb) => subscribe<[Workspace]>(CH.wsChanged, cb),
    setCamera: (camera) => ipcRenderer.invoke(CH.wsCamera, camera),
    setDock: (state) => ipcRenderer.invoke(CH.wsDock, state)
  },
  node: {
    add: (node) => ipcRenderer.invoke(CH.nodeAdd, node),
    patch: (id, patch) => ipcRenderer.invoke(CH.nodePatch, id, patch),
    remove: (id) => ipcRenderer.invoke(CH.nodeRemove, id)
  },
  connection: {
    add: (a, b) => ipcRenderer.invoke(CH.connAdd, a, b),
    remove: (id) => ipcRenderer.invoke(CH.connRemove, id)
  },
  floor: {
    create: (floor) => ipcRenderer.invoke(CH.floorCreate, floor),
    switch: (id) => ipcRenderer.invoke(CH.floorSwitch, id),
    land: (id, opts) => ipcRenderer.invoke(CH.floorLand, id, opts),
    remove: (id, opts) => ipcRenderer.invoke(CH.floorRemove, id, opts),
    setStatus: (id, status) => ipcRenderer.invoke(CH.floorStatus, id, status)
  },
  band: {
    create: (name, members) => ipcRenderer.invoke(CH.bandCreate, name, members),
    add: (bandId, terminalId) => ipcRenderer.invoke(CH.bandAdd, bandId, terminalId),
    remove: (bandId, terminalId) => ipcRenderer.invoke(CH.bandRemove, bandId, terminalId),
    dissolve: (bandId) => ipcRenderer.invoke(CH.bandDissolve, bandId)
  },
  portal: {
    register: (nodeId, webContentsId) => ipcRenderer.send(CH.portalRegister, nodeId, webContentsId)
  },
  workspaces: {
    sidebar: () => ipcRenderer.invoke(CH.wsSidebar),
    onSidebar: (cb) => subscribe<[Sidebar]>(CH.wsSidebarChanged, cb),
    create: (name, spaceId) => ipcRenderer.invoke(CH.wsCreate, name, spaceId ?? null),
    rename: (id, name) => ipcRenderer.invoke(CH.wsRename, id, name),
    remove: (id) => ipcRenderer.invoke(CH.wsRemove, id),
    switch: (id) => ipcRenderer.invoke(CH.wsSwitch, id),
    move: (id, spaceId, index, pageId) => ipcRenderer.invoke(CH.wsMove, id, spaceId, index, pageId ?? null),
    setStyle: (id, style) => ipcRenderer.invoke(CH.wsStyle, id, style),
    saveIcon: (id, png) => ipcRenderer.invoke(CH.wsIconSave, id, png),
    loadIcon: (id) => ipcRenderer.invoke(CH.wsIconLoad, id),
    deleteIcon: (id) => ipcRenderer.invoke(CH.wsIconDelete, id),
    onIconChanged: (cb) => subscribe<[string]>(CH.wsIconChanged, cb)
  },
  pages: {
    create: (input) => ipcRenderer.invoke(CH.pageCreate, input),
    edit: (id, patch) => ipcRenderer.invoke(CH.pageEdit, id, patch),
    remove: (id) => ipcRenderer.invoke(CH.pageRemove, id),
    switch: (id) => ipcRenderer.invoke(CH.pageSwitch, id)
  },
  spaces: {
    create: (name) => ipcRenderer.invoke(CH.spaceCreate, name),
    rename: (id, name) => ipcRenderer.invoke(CH.spaceRename, id, name),
    remove: (id) => ipcRenderer.invoke(CH.spaceRemove, id),
    toggle: (id) => ipcRenderer.invoke(CH.spaceToggle, id)
  },
  drawing: {
    add: (d) => ipcRenderer.invoke(CH.drawAdd, d),
    remove: (id) => ipcRenderer.invoke(CH.drawRemove, id),
    patch: (id, patch) => ipcRenderer.invoke(CH.drawPatch, id, patch)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(CH.shellOpenExternal, url)
  },
  links: {
    list: () => ipcRenderer.invoke(CH.linksList),
    goTo: (nodeId) => ipcRenderer.invoke(CH.linksGoTo, nodeId),
    remove: (linkId) => ipcRenderer.invoke(CH.linksRemove, linkId)
  },
  files: {
    read: (path) => ipcRenderer.invoke(CH.fileRead, path),
    list: (dir) => ipcRenderer.invoke(CH.fileList, dir),
    pick: (kind) => ipcRenderer.invoke(CH.filePick, kind),
    exists: (dir) => ipcRenderer.invoke(CH.fileExists, dir),
    mkdir: (dir, opts) => ipcRenderer.invoke(CH.fileMkdir, dir, opts ?? {}),
    trash: path => ipcRenderer.invoke(CH.fileTrash, path),
    rename: (path, name) => ipcRenderer.invoke(CH.fileRename, path, name),
    storeAttachment: path => ipcRenderer.invoke(CH.fileStore, path),
    kindOf: path => ipcRenderer.invoke(CH.fileKind, path),
    noteText: path => ipcRenderer.invoke(CH.fileNoteText, path),
    materialize: (name, mime, data) => ipcRenderer.invoke(CH.fileMaterialize, name, mime, data),
    pathOf: file => webUtils.getPathForFile(file)
  },
  accounts: {
    list: () => ipcRenderer.invoke(CH.accountList),
    add: account => ipcRenderer.invoke(CH.accountAdd, account),
    remove: id => ipcRenderer.invoke(CH.accountRemove, id)
  },
  usage: {
    get: () => ipcRenderer.invoke(CH.usageGet),
    setVisible: (v, id) => ipcRenderer.invoke(CH.usageVisible, v, id),
    refresh: id => ipcRenderer.invoke(CH.usageRefresh, id),
    onChange: cb => subscribe<[AgentUsage[]]>(CH.usageChanged, cb)
  },
  partitura: {
    rename: (name, next) => ipcRenderer.invoke(CH.partRename, name, next),
    export: name => ipcRenderer.invoke(CH.partExport, name),
    import: document => ipcRenderer.invoke(CH.partImport, document),
    inspect: name => ipcRenderer.invoke(CH.partInspect, name),
    reviewImport: document => ipcRenderer.invoke(CH.partReviewImport, document),
    updatePreview: (name, opts) => ipcRenderer.invoke(CH.partUpdatePreview, name, opts),
    list: () => ipcRenderer.invoke(CH.partList),
    save: (name, opts) => ipcRenderer.invoke(CH.partSave, name, opts),
    insert: (name, opts) => ipcRenderer.invoke(CH.partInsert, name, opts),
    remove: (name) => ipcRenderer.invoke(CH.partRemove, name),
    update: (name, opts) => ipcRenderer.invoke(CH.partUpdate, name, opts)
  },
  presets: {
    list: () => ipcRenderer.invoke(CH.presetList),
    roles: () => ipcRenderer.invoke(CH.roleList),
    create: preset => ipcRenderer.invoke(CH.presetCreate, preset),
    set: (name, patch) => ipcRenderer.invoke(CH.presetSet, name, patch),
    remove: name => ipcRenderer.invoke(CH.presetRemove, name),
    reorder: names => ipcRenderer.invoke(CH.presetReorder, names),
    restoreDefaults: () => ipcRenderer.invoke(CH.presetRestore),
    resetDefaults: () => ipcRenderer.invoke(CH.presetReset),
    missingDefaults: () => ipcRenderer.invoke(CH.presetMissing)
  },
  voice: {
    status: () => ipcRenderer.invoke(CH.voiceStatus),
    install: (model) => ipcRenderer.invoke(CH.voiceInstall, model),
    cancel: () => ipcRenderer.invoke(CH.voiceCancel),
    remove: () => ipcRenderer.invoke(CH.voiceRemove),
    arm: () => ipcRenderer.invoke(CH.voiceArm),
    transcribe: (wav) => ipcRenderer.invoke(CH.voiceTranscribe, wav),
    onProgress: (cb) => subscribe<[VoiceProgress]>(CH.voiceProgress, cb)
  },
  routine: {
    list: () => ipcRenderer.invoke(CH.routineList),
    onChange: (cb) => subscribe<[RoutineView[]]>(CH.routineChanged, cb),
    save: (input) => ipcRenderer.invoke(CH.routineSave, input),
    history: () => ipcRenderer.invoke(CH.routineHistory),
    onHistory: (cb) => subscribe<[RoutineRun[]]>(CH.routineHistoryChanged, cb),
    historyRemove: (id) => ipcRenderer.invoke(CH.routineHistoryRemove, id),
    historyClear: () => ipcRenderer.invoke(CH.routineHistoryClear),
    setEnabled: (id, on) => ipcRenderer.invoke(CH.routineSetEnabled, id, on),
    runNow: (id) => ipcRenderer.invoke(CH.routineRunNow, id),
    remove: (id) => ipcRenderer.invoke(CH.routineRemove, id)
  },
  terminal: {
    attach: (id) => ipcRenderer.invoke(CH.termAttach, id),
    detach: (id) => { void ipcRenderer.invoke(CH.termDetach, id).catch(() => {}) },
    countAboveMemory: (mb) => ipcRenderer.invoke(CH.memCount, mb),
    onData: (cb) => subscribe<[string, string, number, number]>(CH.termData, cb),
    onExit: (cb) => subscribe<[string, number]>(CH.termExit, cb),
    write: (id, data) => ipcRenderer.send(CH.termWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(CH.termResize, id, cols, rows),
    restart: (id) => ipcRenderer.invoke(CH.termRestart, id),
    resolveAgent: (command) => ipcRenderer.invoke(CH.termResolveAgent, command),
    reconfigure: (id, config, patch) => ipcRenderer.invoke(CH.termReconfigure, id, config, patch ?? null),
    setFocused: (id) => ipcRenderer.send(CH.termFocused, id),
    onFocusRequest: (cb) => subscribe<[string]>(CH.termFocusRequest, cb)
  }
}

contextBridge.exposeInMainWorld('palco', api)

// Extras fora do contrato compartilhado (src/shared/api.ts): aviso do store para o topo da janela.
contextBridge.exposeInMainWorld('palcoMeta', {
  warning: (): Promise<string | null> => ipcRenderer.invoke(CH.metaWarning),
  onWarning: (cb: (warning: string | null) => void): (() => void) => subscribe<[string | null]>(CH.metaWarningChanged, cb)
})
