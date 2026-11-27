import { canvasEditMenu } from './canvas-edit-menu'
import { routineBackgroundContext } from './routines/background-context'
import { GitHosts } from './git-hosts/git-hosts'
import { Diagnostics } from './diagnostics'
import { attachAboutGit } from './ipc/about-git'
import { clearPortalStorage } from './data/portal-storage'
import { DataRoot } from './data/data-root'
import { DataService } from './data/data-service'
import { attachData } from './ipc/data'
import { portalPartitionFor } from '../shared/portal-settings'
import { AccountService } from './accounts/account-service'
import { SecretVault } from './accounts/secret-vault'
import { accountCommand } from './accounts/cli-auth'
import { loginTerminal } from './accounts/login-terminal'
import { ProviderLibrary, ACCOUNT_PROVIDERS, USAGE_PROVIDERS } from './providers/provider-library'
import { queryProviderUsage } from './usage/provider-query'
import { attachAccountSettings } from './ipc/account-settings'
import { RoleLibrary } from './agents/role-library'
import { PromptStore, removePromptsWithWorkspace } from './prompts/prompt-store'
import { SkillBases } from './skill-bases'
import { attachLibraries } from './ipc/agent-libraries'
import { SystemController, attachSystem } from './system/controller'
import { electronSystemPorts } from './system/electron-ports'
import { wireSystemSources } from './system/runtime'
import { SessionStore } from './system/sessions'
import { ChatService } from './chat/chat-service'
import { EnvironmentRuntime } from './environments/runtime'
import { readCliBundle, runStep, which } from './environments/system'
import { TunnelServer } from './environments/tunnel'
import { ChatStore } from './chat/chat-store'
import { MemoryGuard, readProcessTree } from './pty/memory-guard'
import { windowOpacityValue } from '../shared/new-item'
import { PreferencesStore } from './preferences/preferences-store'
import { localizeMessage, mt, setMainLocaleSource, mainLocale } from './i18n'
import { popupWindowPolicy } from './portal/popup-policy'
import { IsolatedPortalStorage, portalCensus } from './portal/isolated-storage'
import { LinkedNotes } from './notes/linked-notes'
import { restoreTerminals } from './agents/restore'
import { PartituraStore } from './partituras/partitura-store'
import { RoleStore } from './agents/roles'
import { PresetStore, AgentCatalog } from './agents/presets'
import { app, BrowserWindow, dialog, Menu, Notification, safeStorage, session, shell, webContents, type WebContents } from 'electron'
import { QUIET_MS } from './activity-monitor'
import { readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, cpus, totalmem, release } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { WorkspaceStore } from './domain/workspace-store'
import { WorkspaceRegistry } from './domain/workspace-registry'
import { AskBroker } from './ask/ask-broker'
import { startServer } from './server/http-server'
import { TerminalManager } from './pty/terminal-manager'
import { FloorService } from './floors/floor-service'
import { PortalManager } from './portal/portal-manager'
import { CH, registerIpc } from './ipc'
import { AccountStore } from './accounts/account-store'
import { UsageService } from './usage/usage-service'
import { createUsageRunner } from './usage/runner'
import { makeRoutineFire } from './routines/fire'
import { installSkills } from './skills-install'
import { lazyTerminals, wakeTerminal } from './pty/wake'
import { CrossLinkStore, pruneLinksAtStartup } from './domain/cross-links'
import { crossLinkViews } from './domain/cross-link-view'
import { RoutineRunner, markRejected } from './routines/routine-runner'
import { RoutineStore } from './routines/routine-store'
import { MODELS, RUNTIMES } from './voice/catalog'
import { installMicPolicy, MicGate } from './voice/permission'
import { VoiceService } from './voice/voice-service'
import { allowGuestNavigation, createUrlPolicy, enforceWebviewPolicy, isPortalUrl } from './security'
import { withAskLogging } from './log'
import { cleanStaleSocketDirs, createSocketDirectory, markOwned, removeOwnedSocketDirectory } from './socket-cleanup'
import { setupSingleInstance } from './single-instance'
import { resolveRuntimePaths } from './runtime-paths'

const here = dirname(fileURLToPath(import.meta.url))
const runtimePaths = resolveRuntimePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
let socketDir: string | undefined

const indexHtml = join(here, '../renderer/index.html')
const isTrustedUrl = createUrlPolicy({ indexFileUrl: pathToFileURL(indexHtml).href, devUrl: process.env.ELECTRON_RENDERER_URL })

let win: BrowserWindow | null = null
let system: SystemController | undefined
let cleanup: Array<() => void | Promise<void>> = []

/** "Opacidade da Janela": lida das preferências no boot; vale no próximo lançamento. */
let startOpacity = 100
let configurePopupGuest: ((guest: WebContents) => void) | undefined

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#14161a',
    title: 'palco',
    icon: join(runtimePaths.icons, 'palco-512.png'),
    opacity: windowOpacityValue(startOpacity),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: false, // só para o preload cjs
      nodeIntegration: false,
      webviewTag: true // o nó portal é um <webview>; a política abaixo o isola
    }
  })
  win.on('closed', () => (win = null))
  win.on('close', event => {
    if (quitting) return
    event.preventDefault()
    if (!system?.closeWindow()) app.quit()
  })
  win.on('focus', () => win?.flashFrame(false))
  // O preload expõe a API privilegiada: a janela nunca sai do documento do app nem abre outras.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  win.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  // Portal: o webview nasce sem preload e sem Node, na partição própria, e só abre http, https e file.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!enforceWebviewPolicy(webPreferences as unknown as Record<string, unknown>, params as unknown as Record<string, unknown>)) event.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_event, guest) => {
    if(configurePopupGuest) configurePopupGuest(guest)
    else guest.setWindowOpenHandler(() => ({ action: 'deny' }))
    const guard = (event: { preventDefault(): void }, url: string): void => {
      if (!allowGuestNavigation(guest.getURL(), url)) event.preventDefault()
    }
    guest.on('will-navigate', guard)
    guest.on('will-redirect', guard)
    // will-navigate cobre o frame principal; iframes (inclusive data:/javascript: sem redirect) passam por este.
    guest.on('will-frame-navigate', (details) => {
      if (!allowGuestNavigation(guest.getURL(), details.url)) details.preventDefault()
    })
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(indexHtml)
}

async function boot(): Promise<void> {
  // Antes de qualquer sessão: sem isto o Electron aprovaria microfone e câmera a quem pedisse, portais inclusive.
  const micGate = new MicGate()
  installMicPolicy(session.defaultSession, { gate: micGate, isApp: (contents) => !!win && !win.isDestroyed() && contents === win.webContents, isTrustedUrl })
  app.on('session-created', (created) => { if (created !== session.defaultSession) installMicPolicy(created, null) })
  const cleanupRoots = new Set([process.env.XDG_RUNTIME_DIR, tmpdir()].filter((dir): dir is string => !!dir))
  for (const root of cleanupRoots) for (const dir of cleanStaleSocketDirs(root, process.pid)) console.info(`[palco] socket antigo removido: ${dir}`)
  socketDir = createSocketDirectory(process.env.XDG_RUNTIME_DIR, process.pid)
  markOwned(socketDir, process.pid)
  const socketPath = join(socketDir, 'palco.sock')

  const dataRoots = new DataRoot(join(app.getPath('userData'), 'palco-data-location.json'), join(homedir(), '.palco'))
  const dataRoot = dataRoots.current()
  // Um arquivo por workspace; o workspace.json de arquivo único é migrado na primeira abertura.
  const registry = new WorkspaceRegistry(join(dataRoot, 'workspaces'), join(dataRoot, 'workspace.json'))
  const palcoBin = runtimePaths.cli
  const skillsSource = runtimePaths.skills
  const skillVersions = new Map<string, string>()
  // Presets, roles e partituras nunca derrubam o boot: problemas viram aviso no banner.
  const preferences = new PreferencesStore(join(dataRoot, 'preferences.json'))
  // O que o main mostra (menu, bandeja, diálogos, notificações, erros para a janela) segue a preferência ou o idioma do sistema.
  setMainLocaleSource(() => ({ preference: preferences.get().appLanguage, system: app.getLocale() }))
  const roles = new RoleStore(join(dataRoot, 'roles'))
  const presets = new PresetStore(join(dataRoot, 'presets.json'), roles)
  const agents = new AgentCatalog(presets, roles)
  const partituras = new PartituraStore(join(dataRoot, 'partituras'))
  const accounts = new AccountStore(join(dataRoot, 'accounts.json'))
  try { accounts.seed(homedir()) } catch { accounts.warning = 'não foi possível salvar as contas iniciais' }
  const skillBases = new SkillBases(join(dataRoot, 'skill-bases.json'), skillsSource, homedir(), agent => accounts.list().filter(a => a.agent === agent).map(a => a.configDir))
  const roleLibrary = new RoleLibrary(roles, name => {
    // No process is restarted: edits apply to the next launch.
    presets.clearRole(name); partituras.clearRole(name)
    for (const ws of registry.list()) {
      const store = registry.get(ws.id)
      for (const node of Object.values(store.get().nodes)) if (node.kind === 'terminal' && node.role && roles.canonical(node.role) === name) store.setTerminalRole(node.id)
    }
  }, name => Object.values(registry.allNodes()).filter(n => n.kind === 'terminal' && n.role && roles.canonical(n.role) === name).length)
  const prompts = new PromptStore(join(dataRoot, 'prompts'))
  cleanup.push(removePromptsWithWorkspace(registry, prompts, () => console.warn('palco: não foi possível apagar os prompts do workspace excluído')))
  cleanup.push(attachLibraries(registry, {
    prompts, roles: roleLibrary, skills: skillBases,
    hasWorkspace: id => registry.list().some(w => w.id === id),
    root: id => { const ws = registry.list().find(w => w.id === id); if (!ws) throw new Error('Espaço de trabalho não encontrado.'); const cwd = ws.dir ?? Object.values(registry.get(id).get().nodes).find((n): n is import('../shared/model').TerminalNode => n.kind === 'terminal')?.cwd; if (!cwd) throw new Error('Defina um diretório para este espaço de trabalho.'); return cwd }
  }))
  try { skillBases.apply() } catch { console.warn('palco: não foi possível atualizar todas as bases de skills') }
  const accountProviders = new ProviderLibrary(join(dataRoot, 'account-providers'), ACCOUNT_PROVIDERS)
  const usageProviders = new ProviderLibrary(join(dataRoot, 'usage-providers'), USAGE_PROVIDERS)
  try { accountProviders.ensure(); if (preferences.get().usageEnabled) usageProviders.ensure() } catch { console.warn('palco: provedores indisponíveis; arquivos preservados') }
  const usageRunner = createUsageRunner()
  const usageService = new UsageService({ accounts, runner: usageRunner, now: Date.now, setTimeout, enabled: () => preferences.get().usageEnabled, providerEnabled: a => !!usageProviders.get(a.providerId ?? a.agent), color: a => usageProviders.get(a.providerId ?? a.agent)?.color, query: a => queryProviderUsage(a,usageProviders,usageRunner) })
  cleanup.push(async () => { usageService.dispose(); await usageRunner.dispose() })
  cleanup.push(usageProviders.onChange(() => usageService.settingsChanged()), preferences.onChange(() => usageService.settingsChanged()))
  const terminalNotes = new Map<string, string>()
  const noticeListeners = new Set<() => void>()
  const notices = {
    get: (): Array<string | undefined> => [
      preferences.warning, presets.warning, roles.warning, partituras.warning, accounts.warning,
      // Só avisos de terminais que ainda existem.
      ...[...terminalNotes].filter(([id]) => registry.node(id) !== undefined).map(([, note]) => note)
    ],
    onChange: (cb: () => void): (() => void) => { noticeListeners.add(cb); return () => noticeListeners.delete(cb) }
  }
  // Ambientes fora do shell local (tmux, SSH, Docker, Sandbox): túnel TCP de loopback para o socket do app e a preparação de cada partida.
  const tunnel = new TunnelServer(socketPath)
  cleanup.push(() => tunnel.close())
  const environments = new EnvironmentRuntime({
    settings: () => { const p = preferences.get(); return { sshEnabled: p.sshEnabled, dockerEnabled: p.dockerEnabled, sandboxEnabled: p.sandboxEnabled, localTmuxEnabled: p.localTmuxEnabled, tunnelPort: p.tunnelPort, sshScriptPath: p.sshScriptPath, sshAddToPath: p.sshAddToPath } },
    tunnel, runDir: join(homedir(), '.palco', 'run'), run: runStep, which, cliBundle: () => readCliBundle(runtimePaths.cliBundle)
  })
  const terminals = new TerminalManager({
    environments, socketPath, palcoBin, resolveAccount: id => accounts.byId(id), resolveRole: name => roles.resolve(name),
    // Skills do palco na pasta do agente (padrão e da conta); só copia quando a versão muda.
    beforeSpawn: (node) => {
      const accountDir = node.accountId === undefined ? undefined : accounts.byId(node.accountId)?.configDir
      for (const target of skillBases.targets(node.agent, accountDir)) installSkills(skillsSource, target, skillVersions)
    },
    onWarning: (id, message) => {
      console.warn(`palco: ${message}`)
      terminalNotes.set(id, message)
      for (const cb of noticeListeners) cb()
    }
  })
  // Limite de memória por terminal: mede a árvore de processos de cada shell e encerra os filhos que passam do limite.
  const memoryGuard = new MemoryGuard({
    enabled: () => preferences.get().memoryLimitEnabled, limitMB: () => preferences.get().memoryLimitMB,
    terminals: () => terminals.livePids().map(({ id, pid }) => ({ id, pids: readProcessTree(pid) })),
    kill: pid => process.kill(pid, 'SIGTERM')
  })
  memoryGuard.start()
  cleanup.push(() => memoryGuard.stop())
  const broker = new AskBroker({
    deliver: (id, text) => terminals.deliverPrompt(id, text),
    screenText: (id) => terminals.screenText(id),
    agentOf: (id) => {
      const n = registry.node(id)
      return n?.kind === 'terminal' ? n.agent : 'shell'
    },
    setTimeout,
    clearTimeout
  })

  // O fim de turno por silêncio depende de saber que o agente continua emitindo saída.
  cleanup.push(terminals.onData((id) => broker.onOutput(id)))
  cleanup.push(terminals.onExit((id) => broker.onExit(id)))

  const nameOf = (id: string): string => registry.node(id)?.name ?? id

  // "Monitorar Atividade": notificação do sistema quando o terminal termina ou volta a trabalhar.
  // O clique traz a janela, troca de workspace/floor se precisar e pede ao renderer para focar o terminal.
  const shownNotifications = new Set<Notification>() // referência viva: sem ela o clique pode se perder no GC
  /** Traz o nó para a tela: troca de workspace e de andar se precisar e pede ao renderer para focá-lo. */
  const focusNode = (id: string): void => {
    const store = registry.storeOfNode(id)
    const node = registry.node(id)
    if (!store || !node) return
    const wsId = registry.idOf(store)
    if (wsId && wsId !== registry.activeId()) registry.switch(wsId)
    if (store.get().activeFloor !== node.floorId) store.setActiveFloor(node.floorId)
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(CH.termFocusRequest, id)
  }
  const sessions = new SessionStore(join(dataRoot, 'sessions.json'))
  const vault = new SecretVault(join(dataRoot, 'encrypted-account-keys.json'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || ['gnome_libsecret','kwallet','kwallet5','kwallet6'].includes(safeStorage.getSelectedStorageBackend())),
    encrypt: value => safeStorage.encryptString(value), decrypt: bytes => safeStorage.decryptString(bytes)
  })
  const terminalList = () => Object.values(registry.allNodes()).filter((n): n is import('../shared/model').TerminalNode => n.kind === 'terminal')
  const switchAccount = async (id: string, accountId: string | null, restart: boolean): Promise<void> => {
    const old = registry.node(id), store = registry.storeOfNode(id)
    if (!store || old?.kind !== 'terminal') throw new Error('Terminal não encontrado.')
    if (accountId && accounts.byId(accountId)?.agent !== old.agent) throw new Error('Conta incompatível com o agente.')
    const restored = sessions.forAccountSwitch(old, accountId, preferences.get().resumeSessionsOnRelaunch)
    store.setTerminalAccount(id,accountId ?? undefined)
    const next = store.get().nodes[id]!
    if (restart && next.kind === 'terminal') await terminals.restart({ ...next, command: restored.command })
  }
  const accountService = new AccountService({ root: dataRoot, store: accounts, vault, providers: accountProviders, ports: {
    usedBy: id => terminalList().filter(n => n.accountId === id).length,
    installed: p => which(p.command)!==null,
    status: (a,p) => accountCommand(a,p,'status'), logout: async (a,p) => { await accountCommand(a,p,'logout') },
    login: async (a,p) => {
      const store = registry.active()
      const cwd = registry.list().find(w => w.id === registry.activeId())?.dir ?? Object.values(store.get().nodes).find((n): n is import('../shared/model').TerminalNode => n.kind === 'terminal')?.cwd ?? homedir()
      const id = store.addNode(loginTerminal(a, p, { cwd, floorId: store.get().activeFloor, name: mt('Entrar em {p1}', { p1: a.name }) }))
      const node = store.get().nodes[id]!; if (node.kind === 'terminal' && !terminals.isRunning(id)) terminals.spawn(node); focusNode(id)
    },
    switchAccount,
    moveToDefault: async accountId => { for (const n of terminalList().filter(n => n.accountId === accountId)) await switchAccount(n.id,null,terminals.isRunning(n.id)) }
  } })
  cleanup.push(accountService.installRuntime(), attachAccountSettings(registry, {
    accounts: accountService, providers: { accounts: accountProviders, usage: usageProviders }, terminals: () => terminalList().map(n => ({id:n.id,name:n.name,agent:n.agent,accountId:n.accountId})),
    setUsageEnabled: value => { if (value) usageProviders.ensure(); else usageProviders.removeAll(); preferences.set({usageEnabled:value}) }
  }))
  const clearPortalSessions = (all=false): Promise<void> => clearPortalStorage({
    session: name=>session.fromPartition(name),
    partitionNames: ()=>{try{return readdirSync(join(app.getPath('sessionData'),'Partitions'))}catch{return[]}},
    knownPartitions: ()=>Object.values(registry.allNodes()).filter((n): n is import('../shared/model').PortalNode=>n.kind==='portal').map(n=>portalPartitionFor(n.storage,n.id,registry.idOf(registry.storeOfNode(n.id)!)!)),
    guests: ()=>webContents.getAllWebContents().filter(w=>w.getType()==='webview')
  },all)
  const gitHosts = new GitHosts(join(dataRoot,'git-hosts'))
  try { gitHosts.ensure() } catch { console.warn('palco: provedores de Git indisponíveis; arquivos preservados') }
  const diagnostics = new Diagnostics(join(dataRoot,'onboarding.json'),()=>({appVersion:app.getVersion(),electron:process.versions.electron??'desconhecido',chrome:process.versions.chrome??'desconhecido',node:process.versions.node,platform:process.platform,arch:process.arch,release:release(),memoryMB:Math.round(totalmem()/1048576),cpuCount:cpus().length,workspaceCount:registry.list().length,terminalCount:terminalList().length}))
  cleanup.push(attachAboutGit(registry,{git:gitHosts,diagnostics,version:app.getVersion(),contact:null}))
  const dataService = new DataService({ roots:dataRoots, flush:()=>registry.flushAll(), workspaces:()=>registry.list().map(w=>({id:w.id,name:w.name})), clearGlobal:()=>clearPortalSessions(),
    signOutAll:async()=>{const failed:string[]=[];for(const a of accountService.list()){try{await accountService.logout(a.id)}catch{failed.push(a.name)}}return failed}
  })
  dataService.start()
  cleanup.push(()=>dataService.dispose(), attachData(registry,{data:dataService,restart:operation=>{if(pendingDataOperation)throw new Error('Outra operação de dados já está em andamento.');pendingDataOperation=operation;app.quit()},reset:async()=>{await clearPortalSessions(true);dataService.reset()}}))
  const systemPorts = electronSystemPorts(() => win, notice => {
    if (notice.terminalId) { focusNode(notice.terminalId); return }
    if (notice.workspaceId) {
      registry.switch(notice.workspaceId)
      if (notice.floorId !== undefined) registry.active().setActiveFloor(notice.floorId)
    }
  })
  system = new SystemController({ preferences: () => preferences.get(), nodes: () => Object.values(registry.allNodes()).filter((n): n is import('../shared/model').TerminalNode => n.kind === 'terminal'), ports: systemPorts })
  cleanup.push(attachSystem(registry, system), () => systemPorts.dispose())
  const loggedBroker = withAskLogging(broker, { info: (m) => console.info(m), now: Date.now, nameOf })
  // O agente não ficou pronto no teto: os asks pendentes falham (o servidor traduz para 'agente não ficou pronto').
  cleanup.push(terminals.onDeliveryFailed((id) => broker.onExit(id)))
  cleanup.push(terminals.onPromptRejected((id) => broker.onRejected(id)))

  // Portais: o main controla cada <webview> pelo webContents; o renderer só informa qual pertence a qual nó.
  const popupWindows = new Map<string, BrowserWindow>()
  const portals = new PortalManager({
    fromId: (id) => webContents.fromId(id),
    writeFile: (path, data) => writeFileSync(path, data),
    nameOf: nameOf,
    resizeNode: (id, dw, dh) => {
      const popup = popupWindows.get(id)
      if (popup && !popup.isDestroyed()) {const [w=0,h=0]=popup.getContentSize();popup.setContentSize(w+dw,h+dh);return}
      const store = registry.storeOfNode(id), node = registry.node(id)
      if (!store || node?.kind !== 'portal') throw new Error('portal removido')
      const size = { w: node.size.w + dw, h: node.size.h + dh }
      if (size.w < 100 || size.h < 100 || size.w > 8192 || size.h > 8192) throw new Error('tamanho de card inválido')
      store.patchNode(id, { size })
    }
  })
  // Popups keep the original browser guest (and opener/session), never a second navigation.
  cleanup.push(() => portals.dispose())
  configurePopupGuest = guest => {
    guest.once('destroyed',()=>portals.unregisterContents(guest.id))
    guest.setWindowOpenHandler(({url}) => popupWindowPolicy(url, guest.session))
    guest.on('did-create-window', child => {
      const id=portals.registerPopup(guest.id,child.webContents.id)
      popupWindows.set(id,child)
      const guard=(event:{preventDefault():void},url:string):void=>{if(url!=='about:blank'&&!allowGuestNavigation(child.webContents.getURL(),url))event.preventDefault()}
      child.webContents.on('will-navigate',guard);child.webContents.on('will-redirect',guard)
      child.webContents.on('will-frame-navigate',details=>{if(details.url!=='about:blank'&&!allowGuestNavigation(child.webContents.getURL(),details.url))details.preventDefault()})
      configurePopupGuest?.(child.webContents)
      child.on('closed',()=>{popupWindows.delete(id);portals.closePopup(id)})
    })
  }
  // Floors pertencem a um workspace: um serviço por store, criado sob demanda.
  const floorServices = new Map<WorkspaceStore, FloorService>()
  const floors = (store: WorkspaceStore): FloorService => {
    let service = floorServices.get(store)
    if (!service) {
      service = new FloorService({ store, terminals, portals, pullRequests: (repoRoot, reference) => gitHosts.pullRequest(repoRoot, reference) })
      floorServices.set(store, service)
    }
    return service
  }
  const isPortalGuest = (id: number): boolean => {
    const wc = webContents.fromId(id)
    return !!wc && !wc.isDestroyed() && wc.getType() === 'webview' && !!win && wc.hostWebContents === win.webContents
  }

  /** Notificação simples (lembretes, disparo de rotina, status de andar). */
  const desktopNotify = (title: string, body: string): void => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: localizeMessage(title), body: localizeMessage(body) })
    shownNotifications.add(n)
    n.on('click', () => shownNotifications.delete(n))
    n.on('close', () => shownNotifications.delete(n))
    n.show()
  }
  const lastOutput = new Map<string, number>()
  cleanup.push(terminals.onData((id) => { lastOutput.set(id, Date.now()) }))
  cleanup.push(terminals.onExit((id) => { lastOutput.delete(id) }))
  const routineStore = new RoutineStore(join(dataRoot, 'routines.json'))
  const runner = new RoutineRunner({
    store: routineStore,
    // Rotinas apontam para terminais de qualquer workspace.
    fire: makeRoutineFire({
      background: r => routineBackgroundContext(r, registry, palcoBin),
      workspace: () => ({ ...registry.active().get(), nodes: registry.allNodes() }),
      terminals,
      workspaceInfo: (r) => {
        const store = r.workspaceId !== undefined ? registry.list().some((w) => w.id === r.workspaceId) ? registry.get(r.workspaceId) : undefined : registry.storeOfNode(r.terminalId)
        const id = store && registry.idOf(store)
        const meta = id === undefined ? undefined : registry.list().find((w) => w.id === id)
        return meta && { name: meta.name, ...(meta.dir === undefined ? {} : { dir: meta.dir }) }
      },
      // Ocupado: saída nos últimos segundos ou um ask esperando resposta dele.
      isBusy: (id) => Date.now() - (lastOutput.get(id) ?? 0) < QUIET_MS || broker.pending().some((p) => p.to === id),
      notify: desktopNotify,
      // Destino dormindo (andar ou workspace não aberto): acorda e espera ficar pronto.
      wake: async (id) => {
        const node = registry.node(id)
        return node?.kind === 'terminal' ? wakeTerminal(node, terminals) : 'exited'
      }
    }),
    now: () => new Date(),
    terminalName: (id) => registry.node(id)?.name,
    setTimeout,
    clearTimeout
  })
  const routines = { store: routineStore, runner }
  cleanup.push(terminals.onPromptRejected((id) => markRejected(routineStore, id, new Date())))

  const voiceService = new VoiceService({ root: join(dataRoot, 'voice'), runtime: RUNTIMES[`${process.platform}-${process.arch}`], models: MODELS })
  cleanup.push(() => voiceService.dispose())
  const linkedNotes = new LinkedNotes(() => registry.openStores())
  linkedNotes.sync()
  cleanup.push(registry.onChange(() => linkedNotes.sync()), () => linkedNotes.dispose())
  const crossLinks = new CrossLinkStore(join(dataRoot, 'links.json'))
  pruneLinksAtStartup(crossLinks, { node: (id) => registry.node(id), complete: registry.complete() })
  // Sessões de portais isolados apagados em execuções anteriores.
  const isolatedPortals = new IsolatedPortalStorage(join(dataRoot, 'isolated-portals.json'), () => portalCensus(registry), async (partition) => {
    const guestSession = session.fromPartition(partition)
    await guestSession.clearStorageData(); await guestSession.clearCache(); await guestSession.clearAuthCache()
  })
  void isolatedPortals.sweep()
  cleanup.push(registry.onChange(() => isolatedPortals.note()))
  // Chat dos terminais de agente: histórico em ~/.palco/chats; o agente responde por `palco say`.
  const chat = new ChatService({
    store: new ChatStore(join(dataRoot, 'chats')), home: homedir(),
    deliver: (id, text, settled) => terminals.deliverWhenReady(id, text, settled), write: (id, data) => terminals.write(id, data),
    isRunning: id => terminals.isRunning(id), screenText: (id, n) => terminals.screenText(id, n), isAgent: id => { const n = registry.node(id); return n?.kind === 'terminal' && n.agent !== 'shell' },
    onTerminalData: cb => terminals.onData(id => cb(id)), now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: t => clearTimeout(t as NodeJS.Timeout),
    settleMs: 90_000
  })
  cleanup.push(() => chat.dispose())
  const systemSources = wireSystemSources({ controller: system!, sessions, registry, terminals, preferences, chat, pullRequests: cwd=>gitHosts.pullRequests(cwd) })
  cleanup.push(() => systemSources.dispose())
  const server = await startServer(socketPath, { chat, preferences: () => preferences.get(), registry, broker: loggedBroker, terminals, portals, floors, routines, agents, partituras, accounts, links: crossLinks, onAgentEvent: systemSources.agentEvent, notify: message => desktopNotify('Palco', message) })
  cleanup.push(() => server.close())
  cleanup.push(registerIpc({
    preferences, memoryGuard, chat, registry, agents, partituras, terminals, floors, notices, accounts, usageService,
    voice: { service: voiceService, gate: micGate, locale: () => mainLocale() },
    // Nó arquivo e árvore de pastas: o usuário escolhe o caminho no seletor nativo.
    pickPath: async (kind) => {
      const options = { properties: [kind === 'dir' ? 'openDirectory' : 'openFile'] as Array<'openDirectory' | 'openFile'> }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }, portals, isPortalGuest, getWindow: () => win, isTrustedUrl, routines,
    onTerminalFocused: (id) => system?.setFocused(id),
    openExternal: (url) => shell.openExternal(url),
    linkedNotes,
    pickSavePath: async (defaultName) => {
      const options = { defaultPath: join(homedir(), defaultName), filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      return result.canceled ? null : (result.filePath ?? null)
    },
    links: {
      list: () => crossLinkViews(crossLinks.list(), { node: (id) => registry.node(id), workspaceOf: (id) => { const st = registry.storeOfNode(id); return st && registry.idOf(st) }, list: () => registry.list() }),
      goTo: (id) => focusNode(id),
      remove: (id) => { crossLinks.remove(id) }
    },
  }))

  // Carregamento preguiçoso: sobem só os terminais do andar na tela do workspace aberto; os outros sobem quando
  // o usuário abre o workspace/andar, ou sob demanda (ask, check, routine run). Role ilegível não derruba os outros.
  const startVisible = (): void => {
    const dormant = lazyTerminals(registry.active().get()).filter((n) => !terminals.hasSession(n.id))
    for (const id of restoreTerminals(dormant, node => {
      const restored = sessions.forRelaunch(node, preferences.get().resumeSessionsOnRelaunch)
      try { terminals.spawn(restored) } catch (error) {
        if (restored.command === node.command) throw error
        terminals.dispose(node.id); terminals.spawn(node) // best effort fallback if the CLI cannot resume that id
      }
    })) {
      console.warn(`palco: terminal ${id} não iniciado; confira a responsabilidade, a conta e o keyring; depois reinicie pelo canvas`)
    }
  }
  startVisible()
  cleanup.push(registry.onChange((id) => { if (id === registry.activeId()) startVisible() }))
  cleanup.push(registry.onSidebar(() => startVisible()), accounts.onChange(startVisible))
  // Rotinas começam depois dos terminais; disparos perdidos com o app fechado não são repetidos.
  runner.start()
  cleanup.push(() => runner.stop())

  cleanup.push(() => registry.flushAll())
  cleanup.push(() => terminals.killAll())
  startOpacity = preferences.get().windowOpacity
  // Menu mínimo: o padrão do Electron tomava Ctrl+W (fechar), Ctrl+= / Ctrl+- / Ctrl+0 (zoom da página) e Ctrl+R, que agora são atalhos do canvas.
  if (process.platform !== 'darwin') {
    const applyMenu = (): void => Menu.setApplicationMenu(Menu.buildFromTemplate([canvasEditMenu(() => webContents.getFocusedWebContents() ?? undefined), { label: mt('Desenvolvedor'), submenu: [{ role: 'toggleDevTools' }] }]))
    applyMenu()
    cleanup.push(preferences.onChange(applyMenu))
  }
  cleanup.push(preferences.onChange(() => systemPorts.relabel()))
  createWindow()
}

let quitting = false
let quitRequested = false
let pendingDataOperation: (()=>void|Promise<void>) | undefined
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  if (quitRequested) return
  quitRequested = true
  void (async () => {
    if (!pendingDataOperation && system && !await system.mayQuit()) { quitRequested = false; return }
    quitting = true
    const tasks = cleanup.reverse()
    cleanup = []
    for (const task of tasks) {
      try {
        await task()
      } catch (err) {
        console.error('palco: falha ao encerrar', err)
      }
    }
    if (pendingDataOperation) {
      try { await pendingDataOperation(); app.relaunch() }
      catch (error) { dialog.showErrorBox(mt('Não foi possível alterar os dados'), error instanceof Error ? localizeMessage(error.message) : mt('A operação falhou; os arquivos de recuperação foram preservados.')) }
    }
    if (socketDir) removeOwnedSocketDirectory(socketDir, process.pid)
    app.quit()
  })()
})

app.on('window-all-closed', () => app.quit())

if (setupSingleInstance(app, () => win)) void app.whenReady().then(boot).catch((err) => {
  console.error('palco: falha ao iniciar', err)
  app.exit(1)
})
