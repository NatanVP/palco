import { useDismissPopover } from './canvas/useDismissPopover'
import { SettingsDialog } from './settings/SettingsDialog'
import { getPreferences, matchesShortcut, shortcutLabel, shortcutsSuspended, usePreferenceEffects, usePreferences } from './settings/preferences'
import { PartituraMenu } from './partituras/PartituraMenu'
import { useScorePanel } from './partituras/useScorePanel'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { t, tr, useLocale } from './i18n'
import type { Floor, PortalNode, Size, NewNode, Sidebar as SidebarState, Vec, Workspace } from '../../shared/model'
import { Canvas } from './canvas/Canvas'
import { screenToWorld, snap, zoomAt, type Camera } from './canvas/camera'
import { ZoomBar } from './canvas/ZoomBar'
import { Dock, type Tool } from './dock/Dock'
import { placementFrame, type PlaceKind } from './canvas/placement'
import { cameraTransition } from './canvas/screen-options'
import { noteDefaults } from '../../shared/new-item'
import { NewTerminalDialog } from './dialogs/NewTerminalDialog'
import { DrawToolbar } from './canvas/draw/DrawToolbar'
import { DEFAULT_DRAW_STYLE, type DrawStyle } from './canvas/draw/tools'
import { NewPortalDialog, toNewPortalNode, type NewPortalForm } from './dialogs/NewPortalDialog'
import { toNewNode, type NewTerminalForm } from './dialogs/new-terminal'
import { FloorCreateSheet, FloorOverview } from './floors/FloorOverview'
import { RoutinesPanel } from './routines/RoutinesPanel'
import { AnimatePresence } from 'motion/react'
import { UsagePanel } from './usage/UsagePanel'
import { cutConnections } from './canvas/connection-cut'
import { Sidebar } from './sidebar/Sidebar'
import { TopBar } from './canvas/TopBar'
import { ContextualBar } from './canvas/ContextualBar'
import { focusCamera } from './canvas/contextual'
import { EditTerminalDialog } from './dialogs/EditTerminalDialog'
import { EditPortalDialog } from './dialogs/EditPortalDialog'
import { viewOnAdopt } from './focus'
import { isConnectShortcut, isTypingTarget, matchesGlobalShortcut, sharedJump, typingKeepsKey } from './shortcuts'
import { useCanvasCommands, visibleNodes } from './canvas/commands/useCommands'
import { resolveCommand, type Command } from './canvas/commands/keymap'
import { dismissLift, EMPTY_DOCK, sanitizeDock, type DockState } from './canvas/dock'
import { ALIGN_IDS } from './canvas/commands/align'
import { nodesForDrop } from './canvas/drop'
import { cycleComposer, focusComposer } from './composer/composer-mode'
import { BatutaSearch } from './search/BatutaSearch'
import { searchEntries, type SearchEntry } from './search/search-index'
import { SHORTCUTS, type ShortcutId } from '../../shared/shortcuts'
import { UNMERGED_WORK } from '../../shared/floor-errors'
import { readSidebarHidden, readSidebarRail, railVisible, toggleRail as toggleRailState, writeSidebarHidden, writeSidebarRail } from './sidebar/sidebar-layout'
import { WorkspaceRail } from './sidebar/WorkspaceRail'
import { WorkspaceStyleSheet } from './sidebar/WorkspaceStyleSheet'
import { createPortal as portalInto } from 'react-dom'
import { railInset } from './sidebar/sidebar-layout'
import { ShutdownOverlay } from './ShutdownOverlay'

type Frame = { pos: Vec; size: Size }
const DEFAULT_CAMERA: Camera = { offset: { x: 0, y: 0 }, zoom: 1 }

function defaultName(prefix: string, ws: Workspace): string {
  const taken = new Set(Object.values(ws.nodes).map((n) => n.name.toLowerCase()))
  for (let i = 1; ; i++) {
    const name = `${prefix}${i}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

const errorText = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err)
  // O Electron prefixa o erro do handler: "Error invoking remote method '...': FloorError: <mensagem>".
  return raw.replace(/^Error invoking remote method '[^']*': /, '').replace(/^[A-Za-z]*Error: /, '')
}

type Dialog =
  | { kind: 'floor-create' }
  | { kind: 'band-create'; terminals: string[] }
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; danger?: boolean; floorSheet?: boolean; onConfirm(): void }
  | { kind: 'message'; title: string; lines: string[] }

export function App() {
  const [shuttingDown, setShuttingDown] = useState(false)
  const confirmShutdownPainted = useCallback(() => window.palco.shutdown.painted(), [])
  useEffect(() => window.palco.shutdown.onBegin(() => setShuttingDown(true)), [])
  usePreferenceEffects()
  const preferences = usePreferences()
  useLocale() // a interface inteira re-renderiza quando o idioma troca
  const [showSettings, setShowSettings] = useState(false)
  /** Onde as Configurações abrem (o rodapé do painel de uso leva a Agentes > Uso); vazio = a primeira aba. */
  const [settingsAt, setSettingsAt] = useState<{ tab: string; section: string } | null>(null)

  const [ws, setWs] = useState<Workspace | null>(null)
  const [sidebar, setSidebar] = useState<SidebarState | null>(null)
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA)
  /** Transição da câmera só nos saltos (ir até um nó), por "Movimento da câmera"; roda e arrasto nunca animam. */
  const [glideMs, setGlideMs] = useState(0)
  const glideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const glide = useCallback((movement: 'glide' | 'instant'): void => {
    const ms = cameraTransition(movement, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    clearTimeout(glideTimer.current); setGlideMs(ms)
    if (ms) glideTimer.current = setTimeout(() => setGlideMs(0), ms + 50)
  }, [])
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [selectedConn, setSelectedConn] = useState<string | null>(null)
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const id = selection.size === 1 ? [...selection][0]! : null
    focusComposer(id && ws?.nodes[id]?.kind === 'terminal' ? id : null)
  }, [selection, ws?.id, ws?.activeFloor])
  useEffect(() => {
    const sync = (event: FocusEvent): void => {
      const id = (event.target as HTMLElement | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id')
      if (id && ws?.nodes[id]?.kind === 'terminal') focusComposer(id)
    }
    window.addEventListener('focusin', sync)
    return () => window.removeEventListener('focusin', sync)
  }, [ws])
  /** Diálogo de novo terminal; `frame: null` = sem área desenhada (Ctrl+T): nasce centrado na viewport. */
  const [newTerm, setNewTerm] = useState<{ frame: Frame | null } | null>(null)
  const [newPortal, setNewPortal] = useState<{ frame: Frame } | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE)
  /** Desenhos selecionados: a barra de estilo deles (no canvas) toma o lugar da barra dos nós. */
  const [drawingsSelected, setDrawingsSelected] = useState(false)
  const [showMinimap, setShowMinimap] = useState(false)
  const [viewSize, setViewSize] = useState<Size>({ w: window.innerWidth, h: window.innerHeight })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [showRoutines, setShowRoutines] = useState(false)
  const [showUsage, setShowUsage] = useState(false)
  useDismissPopover(showMinimap, () => setShowMinimap(false), '.minimap, [data-toggle-minimap]')
  useDismissPopover(showUsage, () => setShowUsage(false), '.usage-panel, .usage-rings')
  const scores = useScorePanel()
  // Oculta ou não, a barra lateral volta como estava ao recarregar.
  const [sidebarHidden, setSidebarHidden] = useState(() => readSidebarHidden(localStorage))
  const [sidebarRail, setSidebarRail] = useState(() => readSidebarRail(localStorage))
  const toggleSidebar = useCallback(() => setSidebarHidden((h) => !h), [])
  /** "Alternar Mini Barra Lateral": aberta, vira o trilho; recolhida, liga/desliga o trilho. */
  const toggleRail = useCallback(() => {
    const next = toggleRailState({ hidden: sidebarHidden, rail: sidebarRail })
    setSidebarHidden(next.hidden); setSidebarRail(next.rail)
  }, [sidebarHidden, sidebarRail])
  useEffect(() => writeSidebarHidden(localStorage, sidebarHidden), [sidebarHidden])
  useEffect(() => writeSidebarRail(localStorage, sidebarRail), [sidebarRail])
  /** Terminal aberto no "Editar terminal" (lápis da barra contextual). */
  const [editingTerminal, setEditingTerminal] = useState<string | null>(null)
  /** Portal aberto no "Editar…" do menu do botão direito. */
  const [editingPortal, setEditingPortal] = useState<string | null>(null)
  // Contas por agente (Claude 1, Claude 2, Codex…) para o campo "Conta" do Novo Terminal.
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; agent: 'claude' | 'codex' | 'antigravity' }>>([])
  useEffect(() => { void window.palco.accounts?.list().then((l) => setAccounts(l.map((a) => ({ id: a.id, name: a.name, agent: a.agent })))).catch(() => {}) }, [newTerm])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const shownView = useRef<string | undefined>(undefined)
  const wsRef = useRef(ws)
  wsRef.current = ws
  const viewRef = useRef(viewSize)
  viewRef.current = viewSize
  /** "Conexões" → nó de outro floor: aplicado quando esse floor chega (adopt), descartado se a troca falhar. */
  const pendingFocus = useRef<string | null>(null)
  const sidebarRef = useRef(sidebar)
  sidebarRef.current = sidebar
  const switchWsRef = useRef<(id: string) => Promise<void>>(async () => {})
  const jumpArm = useRef(sharedJump)
  const [showSearch, setShowSearch] = useState(false)
  // Trilho: menu de contexto de um workspace, renomear/editar a partir dele e o selo de avisos (respostas do agente por ler).
  const [railMenu, setRailMenu] = useState<{ id: string; name: string; at: { x: number; y: number } } | null>(null)
  const [railRenaming, setRailRenaming] = useState<string | null>(null)
  const [railStyling, setRailStyling] = useState<string | null>(null)
  const [railAttention, setRailAttention] = useState<Record<string, number>>({})
  // As contagens do trilho (terminais por workspace) seguem quem entra e sai do workspace aberto.
  const terminalCount = ws ? Object.values(ws.nodes).filter((n) => n.kind === 'terminal').length : 0
  useEffect(() => { void window.palco.workspaces.sidebar().then(setSidebar).catch(() => {}) }, [terminalCount, ws?.id])
  useEffect(() => {
    const load = (): void => { void window.palco.rail?.attention().then(setRailAttention).catch(() => {}) }
    load(); return window.palco.chat?.onChange(load)
  }, [])
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notify = useCallback((message: string, duration = 2500): void => { clearTimeout(flashTimer.current); setFlash(message); flashTimer.current = setTimeout(() => setFlash(null), duration) }, [])
  useEffect(() => window.palco.history?.onNotice?.(message => notify(message, 4000)), [notify])
  useEffect(() => () => clearTimeout(flashTimer.current), [])
  /** Elemento elevado ao painel central (Elevar elemento); some ao trocar de workspace/andar ou se o nó deixar de existir. */
  const [dock, setDock] = useState<DockState>(EMPTY_DOCK)
  const dockRef = useRef(dock)
  dockRef.current = dock
  /** Muda o elevado/encaixado e guarda no workspace (por andar), para voltar igual na próxima sessão. */
  const updateDock = useCallback((next: DockState): void => { dockRef.current = next; setDock(next); void window.palco.workspace.setDock(next).catch(() => {}) }, [])
  const runCommand = useCanvasCommands({
    dock, setDock: updateDock,
    ws: wsRef, camera: cameraRef, view: viewRef, sidebar: sidebarRef, selection, setSelection: (ids) => setSelection(ids),
    changeCamera: (c, jump) => { if (jump) glide(getPreferences().cameraMovement); changeCamera(c) },
    switchWorkspace: (id) => switchWsRef.current(id), toggleMinimap: () => setShowMinimap((v) => !v), openSearch: () => setShowSearch(true), notify
  })

  /** Cada workspace e cada floor tem a sua câmera: ao trocar (por qualquer caminho) a tela passa a mostrar a dele. */
  const adopt = useCallback((w: Workspace): void => {
    setWs(w)
    const view = `${w.id}\u0000${w.activeFloor ?? ''}`
    if (shownView.current !== view) {
      shownView.current = view
      const shown = viewOnAdopt(w, pendingFocus.current, viewRef.current)
      if (shown.selection.length > 0) pendingFocus.current = null
      cameraRef.current = shown.camera
      setCamera(shown.camera)
      setSelection(new Set(shown.selection))
      setLinkFrom(null); setDock(sanitizeDock((w.activeFloor === null ? w.dockState : w.floors[w.activeFloor]?.dockState) ?? EMPTY_DOCK, new Set(Object.keys(w.nodes))))
      setSelectedConn(null)
    }
  }, [])

  useEffect(() => {
    if (!ws) return
    const ids = new Set(Object.keys(ws.nodes))
    const next = sanitizeDock(dockRef.current, ids)
    if (JSON.stringify(next) !== JSON.stringify(dockRef.current)) updateDock(next)
  }, [ws, updateDock])
  useEffect(() => {
    if (!dock.liftedId) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as Element | null)?.closest?.('.xterm, input, textarea, [role="dialog"], .composer')) updateDock(dismissLift(dockRef.current)) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dock.liftedId, updateDock])
  useEffect(() => {
    void window.palco.workspace.get().then(adopt)
    return window.palco.workspace.onChange(adopt)
  }, [adopt])

  // Clique na notificação de atividade: o main já trocou workspace/floor; aqui o terminal é centralizado,
  // selecionado e recebe o teclado. Se o floor ainda não chegou, o adopt aplica o foco pendente.
  const focusInput = useRef<string | null>(null)
  useEffect(() => window.palco.terminal.onFocusRequest((id) => {
    focusInput.current = id
    pendingFocus.current = id
    const current = wsRef.current
    const node = current?.nodes[id]
    if (current && node && node.floorId === current.activeFloor) {
      pendingFocus.current = null
      const cam = focusCamera(cameraRef.current, node, viewRef.current)
      cameraRef.current = cam
      glide(getPreferences().cameraMovement)
      setCamera(cam)
      setSelection(new Set([id]))
    }
  }), [])
  useEffect(() => {
    const id = focusInput.current
    if (!id || !selection.has(id)) return
    focusInput.current = null
    // Depois do render: a textarea do xterm do nó recebe o teclado.
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-node-id="${CSS.escape(id)}"] .xterm-helper-textarea`)?.focus())
  }, [selection])

  useEffect(() => {
    void window.palco.workspaces.sidebar().then(setSidebar)
    return window.palco.workspaces.onSidebar(setSidebar)
  }, [])

  useEffect(() => {
    void window.palcoMeta.warning().then(setWarning).catch(() => {})
    return window.palcoMeta.onWarning(setWarning)
  }, [])

  const changeCamera = useCallback((c: Camera) => {
    // A ref anda junto: dois cliques seguidos no zoom partem do valor já aplicado, não do último render.
    cameraRef.current = c
    setCamera(c)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void window.palco.workspace.setCamera(c), 400)
  }, [])

  const onLink = useCallback(
    (id: string) => {
      if (linkFrom === null) { setTool('select'); setLinkFrom(id) }
      else if (linkFrom === id) setLinkFrom(null)
      else {
        void window.palco.connection.add(linkFrom, id).catch((err: unknown) => console.warn(t('App.ligacao_recusada'), err))
        setLinkFrom(null)
      }
    },
    [linkFrom]
  )

  const selectOnly = useCallback((id: string | null) => {
    setSelection((prev) => (id === null ? (prev.size === 0 ? prev : new Set()) : prev.size === 1 && prev.has(id) ? prev : new Set([id])))
  }, [])

  const selectMany = useCallback((ids: string[]) => setSelection(new Set(ids)), [])

  const toggleSelect = useCallback((id: string) => {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Atalhos de comando do canvas (ciclos, saltos, zoom, alinhar, organizar, Batuta Search): resolvidos pelo mapa vivo, em qualquer foco
  // menos dentro de um campo de texto (só a busca e o ciclo de elementos valem lá) e nunca com um diálogo aberto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || shortcutsSuspended() || typingKeepsKey(e) || document.querySelector('.settings-dialog, .batuta')) return
      if (!e.repeat && ['Control', 'Meta', 'Alt', 'Shift'].includes(e.key) && matchesShortcut('workspaceJump', e)) jumpArm.current.tap(performance.now())
      const command = resolveCommand(e, { shortcuts: getPreferences().shortcuts, jump: jumpArm.current, now: performance.now() })
      if (!command) return
      const target = e.target as HTMLElement | null
      if (target && isTypingTarget(target) && !target.closest?.('.xterm') && command.kind !== 'search' && command.kind !== 'node' && command.kind !== 'chatSwap' && command.kind !== 'dictate') return
      if (document.querySelector('.modal-back') && command.kind !== 'search') return
      e.preventDefault(); runCommand(command)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runCommand])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || shortcutsSuspended() || document.querySelector('.settings-dialog')) return
      if (matchesGlobalShortcut('settings', e)) { e.preventDefault(); setShowSettings(true); return }
      // Compositor de Prompts (Ctrl+Shift+P): gira escondido → sobreposto → abaixo no terminal selecionado ou em foco.
      if (matchesGlobalShortcut('prompter', e)) {
        e.preventDefault()
        const w = wsRef.current, focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null
        const id = focused ?? (selection.size === 1 ? [...selection][0]! : null)
        if (id && w?.nodes[id]?.kind === 'terminal') cycleComposer(id, true)
        else notify(t('App.selecione_um_terminal_para_abr'))
        return
      }
      // Ctrl+Shift+L é global (o terminal não a recebe; ver TerminalView): vem antes do filtro de campos.
      if (matchesGlobalShortcut('partituras', e)) {
        e.preventDefault()
        scores.open()
        return
      }
      const target = e.target as HTMLElement
      if (isTypingTarget(target)) return
      if (matchesShortcut('cancel', e)) {
        setLinkFrom(null)
        setSelection(new Set())
        setTool('select')
      }
      // Ctrl+T (Cmd+T no macOS): novo terminal sem área desenhada.
      if (matchesShortcut('newTerminal', e)) {
        e.preventDefault()
        setNewTerm({ frame: null })
      }
      // Ctrl+L: conectar o nó selecionado (o mesmo início do botão Conectar). Só fora do terminal: lá é limpar a tela.
      if (isConnectShortcut(e)) {
        e.preventDefault()
        if (selection.size === 1) onLink([...selection][0]!)
      }
      if (matchesShortcut('deleteSelection', e) && selectedConn && wsRef.current) {
        void cutConnections(window.palco.history, wsRef.current.id, [selectedConn]).catch((err: unknown) => console.warn(t('App.nao_foi_possivel_remover_a_con'), err))
        setSelectedConn(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedConn, selection, onLink, notify])

  if (!ws) return <div className="loading">{t('App.carregando')}</div>

  const fail = (title: string, err: unknown): void => setDialog({ kind: 'message', title, lines: errorText(err).split('\n') })

  /** Grava a câmera pendente no floor de onde se sai, e só então troca. */
  const switchFloor = async (id: Workspace['activeFloor']): Promise<boolean> => {
    if (id === ws.activeFloor) return true
    clearTimeout(saveTimer.current)
    try {
      await window.palco.workspace.setCamera(cameraRef.current)
      await window.palco.floor.switch(id)
      return true
    } catch (err) {
      fail(t('App.nao_foi_possivel_trocar_de_flo'), err)
      return false
    }
  }

  /** Grava a câmera pendente no workspace de onde se sai, e só então troca. */
  const switchWorkspace = async (id: string): Promise<void> => {
    clearTimeout(saveTimer.current)
    try {
      await window.palco.workspace.setCamera(cameraRef.current)
      await window.palco.workspaces.switch(id)
    } catch (err) {
      fail(t('App.nao_foi_possivel_trocar_de_wor'), err)
    }
  }

  switchWsRef.current = switchWorkspace

  const askRemoveWorkspace = (meta: { id: string; name: string }): void =>
    setDialog({
      kind: 'confirm',
      title: t('App.remover_o_workspace_name', { name: meta.name }),
      body: t('App.encerra_os_terminais_dele_e_ti'),
      confirmLabel: t('App.remover'),
      danger: true,
      onConfirm: () => {
        setDialog(null)
        window.palco.workspaces.remove(meta.id).catch((err: unknown) => fail(t('App.nao_foi_possivel_remover_o_wor'), err))
      }
    })

  const askRemoveSpace = (space: { id: string; name: string }): void =>
    setDialog({
      kind: 'confirm',
      title: t('App.apagar_o_space_name', { name: space.name }),
      body: t('App.os_workspaces_dele_continuam_e'),
      confirmLabel: t('App.apagar'),
      onConfirm: () => {
        setDialog(null)
        window.palco.spaces.remove(space.id).catch((err: unknown) => fail(t('App.nao_foi_possivel_apagar_o_spac'), err))
      }
    })

  const addNode = (node: NewNode): void => void window.palco.node.add(node).catch((err: unknown) => fail(t('App.nao_foi_possivel_criar_o_no'), err))

  /** Fim do gesto de colocação: o nó nasce exatamente no frame desenhado (ou no padrão do clique). */
  const place = (kind: PlaceKind, frame: Frame): void => {
    setTool('select')
    const floorId = ws.activeFloor
    switch (kind) {
      case 'terminal':
        setNewTerm({ frame })
        return
      case 'note':
        {
          // Clique usa o tamanho padrão da nota; a área desenhada vale como foi desenhada. Cor e fonte vêm dos padrões.
          const d = noteDefaults(preferences)
          addNode({ kind: 'note', floorId, name: defaultName(t('App.nota'), ws), content: '', render: preferences.defaultNoteRender, color: d.color, fontSize: d.fontSize, ...(d.fontFamily ? { fontFamily: d.fontFamily } : {}), ...frame })
        }
        return
      case 'text':
        addNode({ kind: 'text', floorId, name: defaultName(t('App.texto'), ws), text: '', fontSize: 28, ...frame })
        return
      case 'portal':
        setNewPortal({ frame })
        return
      case 'file':
      case 'filetree':
        // Arquivo e pasta pedem o caminho (seletor nativo) antes de criar no frame.
        window.palco.files.pick(kind === 'file' ? 'file' : 'dir').then(async (path) => {
          if (!path) return
          const name = path.split('/').filter(Boolean).pop() || path
          addNode(kind === 'file' ? { kind: 'file', floorId, name, path: preferences.alwaysCopyAttachments ? await window.palco.files.storeAttachment(path) : path, ...frame } : { kind: 'filetree', floorId, name, root: path, ...frame })
        }).catch((err: unknown) => fail(t('App.nao_foi_possivel_adicionar_o_item'), err))
    }
  }

  /** Arquivos soltos no canvas: pasta vira árvore, .md/.txt vira nota, o resto vira nó arquivo (copiado para o palco com "Sempre copiar arquivos"). */
  const dropFiles = (files: File[], at: Vec): void => {
    void (async () => {
      const paths = files.map((f) => window.palco.files.pathOf(f)).filter((p) => p !== '')
      const infos = await Promise.all(paths.map(async (path) => {
        const k = await window.palco.files.kindOf(path).catch(() => null)
        const text = k?.note ? await window.palco.files.noteText(path).catch(() => null) : null
        return { path, kind: k?.kind ?? null, note: k?.note === true && text != null, text }
      }))
      const copies: Record<string, string> = {}
      if (preferences.alwaysCopyAttachments) {
        for (const i of infos) if (i.kind === 'file' && !i.note) {
          try { copies[i.path] = await window.palco.files.storeAttachment(i.path) } catch (err) { notify(t('App.nao_foi_possivel_copiar_v1_v2', { v1: i.path.split('/').pop() ?? i.path, v2: errorText(err) })) }
        }
      }
      for (const node of nodesForDrop(infos, at, preferences, ws.activeFloor, copies)) addNode(node)
    })().catch((err: unknown) => fail(t('App.nao_foi_possivel_adicionar_os_'), err))
  }

  /** Frame do terminal sem área desenhada: o tamanho padrão centrado na viewport. */
  const centeredTerminalFrame = (): Frame => {
    const c = screenToWorld({ x: viewSize.w / 2, y: viewSize.h / 2 }, camera)
    return placementFrame(c, c, 'terminal', 20, preferences)
  }

  /** "Criar" do diálogo: o nó nasce no frame (ou centrado), é selecionado e o diálogo fecha. Devolve o erro, se houver. */
  const createTerminal = async (frame: Frame | null, form: NewTerminalForm): Promise<string | null> => {
    try {
      const node = toNewNode(form, frame ?? centeredTerminalFrame(), ws.activeFloor, Object.values(ws.nodes).map((n) => n.name))
      const id = await window.palco.node.add(node)
      if (form.agentWarning) notify(form.agentWarning)
      setSelection(new Set([id]))
      setNewTerm(null)
      return null
    } catch (err) {
      return errorText(err)
    }
  }

  /** "Criar" do Novo Portal: o portal nasce no frame, é selecionado e o diálogo fecha. Devolve o erro, se houver. */
  const createPortal = async (frame: Frame, form: NewPortalForm): Promise<string | null> => {
    try {
      const id = await window.palco.node.add(toNewPortalNode(form, frame, ws.activeFloor, Object.values(ws.nodes).map((n) => n.name)))
      setSelection(new Set([id]))
      setNewPortal(null)
      return null
    } catch (err) {
      return errorText(err)
    }
  }

  /** Zoom pela barra: em torno do centro do canvas visível. */
  const setZoom = (next: (current: number) => number): void => {
    const cam = cameraRef.current
    changeCamera(zoomAt(cam, { x: viewSize.w / 2, y: viewSize.h / 2 }, next(cam.zoom) / cam.zoom))
  }

  /** Linha da lista "Conexões": vai até o nó do outro lado (troca de floor se for outro) e o seleciona. */
  const focusNode = (nodeId: string, floorId: Workspace['activeFloor']): void => {
    if (floorId !== ws.activeFloor) {
      // A centralização acontece quando o floor novo chega (adopt); troca recusada mantém câmera e seleção.
      pendingFocus.current = nodeId
      void switchFloor(floorId).then((ok) => { if (!ok) pendingFocus.current = null })
      return
    }
    const node = ws.nodes[nodeId]
    if (!node) return
    glide(preferences.cameraMovement)
    changeCamera(focusCamera(cameraRef.current, node, viewSize))
    setSelection(new Set([nodeId]))
  }

  const modeHint =
    tool === 'draw' ? t('App.lapis_arraste_para_desenhar_es')
      : tool !== 'select' ? t('App.arraste_a_area_do_novo_no_um_c')
        : linkFrom ? t('App.clique_no_no_a_ligar_esc_cance')
          : null
  const editNode = editingTerminal ? ws.nodes[editingTerminal] : undefined
  const activeName = sidebar?.workspaces.find((w) => w.id === sidebar.active)?.name ?? ws.name

  const firstTerminalDir = (): string => Object.values(ws.nodes).find((n) => n.kind === 'terminal')?.cwd || '~'

  const askLand = (floor: Floor): void =>
    setDialog({
      kind: 'confirm', floorSheet: true,
      title: t('App.integrar_o_floor_name', { name: floor.name }),
      body: t('App.faz_o_merge_de_branch_na_branc', { branch: floor.branch }),
      confirmLabel: t('App.integrar'),
      onConfirm: () => {
        setDialog(null)
        window.palco.floor
          .land(floor.id)
          .then((result) => {
            if (!result.ok) {
              setDialog({
                kind: 'message',
                title: t('App.o_land_nao_foi_feito'),
                lines: [result.error, ...(result.conflicts?.length ? [t('App.arquivos_em_conflito'), ...result.conflicts.map((f) => `  ${f}`)] : [])]
              })
            }
          })
          .catch((err: unknown) => fail(t('App.o_land_falhou'), err))
      }
    })

  const askDelete = (floor: Floor): void => {
    const remove = (force: boolean): void => {
      setDialog(null)
      window.palco.floor.remove(floor.id, force ? { force: true } : undefined).catch((err: unknown) => {
        const text = errorText(err)
        // Mudanças não commitadas (ou commits não integrados): só apaga com uma segunda confirmação explícita.
        if (!force && UNMERGED_WORK.test(text)) {
          setDialog({
            kind: 'confirm',
            floorSheet: true,
            title: t('App.ha_trabalho_que_sera_perdido'),
            body: t('App.text_excluir_mesmo_assim', { text }),
            confirmLabel: t('App.excluir_mesmo_assim'),
            danger: true,
            onConfirm: () => remove(true)
          })
        } else fail(t('App.nao_foi_possivel_excluir_o_flo'), err)
      })
    }
    setDialog({
      kind: 'confirm', floorSheet: true,
      title: t('App.excluir_o_floor_name', { name: floor.name }),
      body: t('App.remove_a_worktree_git_e_a_bran'),
      confirmLabel: t('App.excluir'),
      danger: true,
      onConfirm: () => remove(false)
    })
  }

  const submitFloor = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const branch = String(data.get('branch') ?? '').trim()
    const fromDir = String(data.get('dir') ?? '').trim()
    if (name === '' || fromDir === '') return
    setDialog(null)
    window.palco.floor
      .create({ name, fromDir, ...(branch === '' ? {} : { branch }) })
      .then((floor) => switchFloor(floor.id))
      .catch((err: unknown) => fail(t('App.nao_foi_possivel_criar_o_floor'), err))
  }

  const submitBand = (e: FormEvent<HTMLFormElement>, terminals: string[]): void => {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim() || defaultName(t('App.banda'), ws)
    setDialog(null)
    setSelection(new Set())
    window.palco.band.create(name, terminals).catch((err: unknown) => fail(t('App.nao_foi_possivel_criar_a_banda'), err))
  }

  return (
    <div className="app" style={{ ['--rail-inset' as string]: `${railInset({ hidden: sidebarHidden, rail: sidebarRail })}px` }}>
      {warning && (
        <div className="warning" role="alert">
          {warning}
        </div>
      )}
      <div className="main-row">
      {sidebar && (
        <Sidebar
          sidebar={sidebar}
          activeTerminals={ws ? Object.values(ws.nodes).filter((n) => n.kind === 'terminal').length : 0}
          onSwitch={(id) => void switchWorkspace(id)}
          onRemoveWorkspace={askRemoveWorkspace}
          onRemoveSpace={askRemoveSpace}
          onError={fail}
          hidden={sidebarHidden}
          onToggleHidden={toggleSidebar}
        />
      )}
      <div className="stage">
      {sidebar && <WorkspaceRail sidebar={sidebar} show={railVisible({ hidden: sidebarHidden, rail: sidebarRail })} attention={railAttention}
        onSwitch={(id) => void switchWorkspace(id)}
        onCreate={(name) => void window.palco.workspaces.create(name).then((id) => switchWorkspace(id)).catch((err: unknown) => fail(t('App.nao_foi_possivel_criar_o_works'), err))}
        onMove={(id, to) => void window.palco.workspaces.move(id, to.spaceId, to.index).catch((err: unknown) => fail(t('App.nao_foi_possivel_mover_o_works'), err))}
        onMenu={(item, at) => setRailMenu({ id: item.id, name: item.name, at })}
        terminalsOf={(id) => window.palco.rail.terminals(id)}
        onGoTo={(wsId, terminalId) => { void (async () => { if (wsId !== sidebar.active) await switchWorkspace(wsId); void window.palco.links?.goTo(terminalId) })() }}
        onPage={(id) => void window.palco.pages.switch(id).catch((err: unknown) => fail(t('App.nao_foi_possivel_trocar_de_espaco'), err))} />}
      {railMenu && sidebar && portalInto(<>
        <div className="rail-pop-back" onPointerDown={() => setRailMenu(null)} />
        <div className="rail-pop" role="menu" aria-label={t('App.menu_de_name', { name: railMenu.name })} style={{ left: railMenu.at.x, top: railMenu.at.y }}>
          <button type="button" role="menuitem" onClick={() => { const id = railMenu.id; setRailMenu(null); setRailStyling(id) }}>{t('App.editar_workspace')}</button>
          <button type="button" role="menuitem" onClick={() => { const id = railMenu.id; setRailMenu(null); setRailRenaming(id) }}>{t('App.renomear')}</button>
          <button type="button" role="menuitem" disabled={sidebar.workspaces.length <= 1} onClick={() => { const m = sidebar.workspaces.find((w) => w.id === railMenu.id); setRailMenu(null); if (m) askRemoveWorkspace(m) }}>{t('App.excluir_workspace')}</button>
        </div></>, document.body)}
      {railRenaming && sidebar && (() => { const m = sidebar.workspaces.find((w) => w.id === railRenaming); return m ? <div className="modal-back" onPointerDown={() => setRailRenaming(null)}><form className="modal" onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('name') ?? '').trim(); setRailRenaming(null); if (v && v !== m.name) void window.palco.workspaces.rename(m.id, v).catch((err: unknown) => fail(t('App.nao_foi_possivel_renomear'), err)) }}><label>{t('App.renomear_o_workspace')}</label><input name="name" aria-label={t('App.novo_nome_do_workspace')} autoFocus defaultValue={m.name} /><div className="modal-actions"><button type="button" onClick={() => setRailRenaming(null)}>{t('App.cancelar')}</button><button type="submit">{t('App.renomear')}</button></div></form></div> : null })()}
      {railStyling && sidebar && sidebar.workspaces.find((w) => w.id === railStyling) && <WorkspaceStyleSheet key={railStyling} meta={sidebar.workspaces.find((w) => w.id === railStyling)!} onClose={() => setRailStyling(null)} onError={(m) => fail(t('App.nao_foi_possivel_editar_o_work'), new Error(String(m)))} />}
      <div className="canvas-area">
      <FloorOverview ws={ws} onSwitch={switchFloor} onCreate={() => setDialog({ kind: 'floor-create' })} onLand={askLand} onDelete={askDelete} controls={
        <ZoomBar zoom={camera.zoom} onZoom={setZoom} minimap={showMinimap}
          onToggleMinimap={() => setShowMinimap((v) => !v)} onOpenUsage={() => setShowUsage((v) => !v)}
          />
      }>
      <Canvas
        ws={ws}
        camera={camera}
        glideMs={glideMs}
        onCamera={changeCamera}
        linkFrom={linkFrom}
        onLink={onLink}
        selectedConn={selectedConn}
        onFocusNode={focusNode}
        onSelectConn={setSelectedConn}
        selection={selection}
        onToggleSelect={toggleSelect}
        onSelectOnly={selectOnly}
        onSelectMany={selectMany}
        onGoToFloor={(id) => void switchFloor(id)}
        tool={tool}
        showMinimap={showMinimap}
        onViewSize={setViewSize}
        onPlace={place}
        onDropFiles={dropFiles}
        drawStyle={drawStyle}
        dock={dock}
        onDock={updateDock}
        leadingInset={railVisible({ hidden: sidebarHidden, rail: sidebarRail }) ? 62 : 0}
        onDrawingsSelected={setDrawingsSelected}
        onDrawStyle={setDrawStyle}
        onTool={setTool}
        onPartitura={scores.open}
        onFail={fail}
        onNotice={notify}
        onEditTerminal={setEditingTerminal}
        onEditPortal={setEditingPortal}
        onCreateBand={(terminals) => setDialog({ kind: 'band-create', terminals })}
        onConfirm={(ask) => setDialog({ kind: 'confirm', ...ask, onConfirm: () => { setDialog(null); ask.onConfirm() } })}
      />
      </FloorOverview>
      <TopBar
        sidebarHidden={sidebarHidden}
        onToggleSidebar={toggleSidebar}
        workspaceName={activeName}
        workspace={sidebar?.workspaces.find((w) => w.id === sidebar.active)}
        onRoutines={() => setShowRoutines((v) => !v)}
        onPartituras={() => scores.open()}
        onSettings={() => setShowSettings(true)}
        railOn={railVisible({ hidden: sidebarHidden, rail: sidebarRail })}
        onToggleRail={toggleRail}
      />
      <Dock tool={tool} onTool={setTool} />
      {tool === 'draw' ? (
        <div className="contextual-row"><DrawToolbar style={drawStyle} onStyle={setDrawStyle} /></div>
      ) : drawingsSelected ? null : (
        <ContextualBar
          ws={ws}
          selection={selection}
          linkFrom={linkFrom}
          onLink={onLink}
          onEdit={setEditingTerminal}
          onCreateBand={(terminals) => setDialog({ kind: 'band-create', terminals })}
          onFocus={focusNode}
          onCleared={() => setSelection(new Set())}
          onError={fail}
          modeHint={modeHint}
        />
      )}
      {/* Dentro da área do canvas: o painel mede o topo a partir dela, abaixo da barra mesmo com a faixa de aviso. */}
      {scores.shown && <PartituraMenu {...scores.panel} />}
      </div>
      </div>
      </div>
      {showSettings && <SettingsDialog at={settingsAt} onClose={() => { setShowSettings(false); setSettingsAt(null) }} />}
      {showSearch && (() => {
        // Batuta Search: elementos do andar, espaços de trabalho e os comandos (com o atalho de cada um).
        const commands: Array<{ id: string; label: string; run(): void; shortcut?: ShortcutId }> = [
          { id: 'settings', label: t('App.configuracoes'), run: () => setShowSettings(true), shortcut: 'settings' },
          { id: 'newTerminal', label: t('App.novo_terminal'), run: () => setNewTerm({ frame: null }), shortcut: 'newTerminal' },
          { id: 'partituras', label: t('App.partituras'), run: () => scores.open(), shortcut: 'partituras' },
          { id: 'toggleSidebar', label: t('App.mostrar_ocultar_barra_lateral'), run: toggleSidebar, shortcut: 'toggleSidebar' },
          { id: 'routines', label: t('App.rotinas'), run: () => setShowRoutines(true) },
          ...([['lift', { kind: 'lift' }], ['minimap', { kind: 'minimap' }], ['tidy', { kind: 'tidy' }], ['toggleFocus', { kind: 'toggleFocus' }], ['zoomSelection', { kind: 'zoomSelection' }],
            ['zoomIn', { kind: 'zoom', op: 'in' }], ['zoomOut', { kind: 'zoom', op: 'out' }], ['zoom100', { kind: 'zoom', op: 'reset' }],
            ...ALIGN_IDS.map((a): [ShortcutId, Command] => [a, { kind: 'align', action: a }])] as Array<[ShortcutId, Command]>)
            .map(([id, command]) => ({ id, label: tr(SHORTCUTS.find((s) => s.id === id)!.label), run: () => runCommand(command), shortcut: id }))
        ]
        const entries = searchEntries({
          nodes: visibleNodes(ws),
          workspaces: (sidebar?.order ?? []).flatMap((id) => { const m = sidebar!.workspaces.find((w) => w.id === id); return m ? [{ id, name: m.name, active: id === sidebar!.active }] : [] }),
          commands: commands.map((c) => ({ id: c.id, label: c.label, ...(c.shortcut && shortcutLabel(c.shortcut) !== 'Sem atalho' ? { hint: shortcutLabel(c.shortcut) } : {}) }))
        })
        const pick = (e: SearchEntry): void => {
          if (e.kind === 'node') focusNode(e.id, ws.activeFloor)
          else if (e.kind === 'workspace') void switchWorkspace(e.id)
          else commands.find((c) => c.id === e.id)?.run()
        }
        return <BatutaSearch entries={entries} onPick={pick} onClose={() => setShowSearch(false)} />
      })()}
      {flash && <div className="flash" role="status">{flash}</div>}
      {editNode?.kind === 'terminal' && <EditTerminalDialog key={editNode.id} node={editNode} onClose={() => setEditingTerminal(null)} onError={fail} />}
      {editingPortal && ws.nodes[editingPortal]?.kind === 'portal' && <EditPortalDialog key={editingPortal} node={ws.nodes[editingPortal] as PortalNode} onClose={() => setEditingPortal(null)} onError={fail} />}
      {showRoutines && <RoutinesPanel onClose={() => setShowRoutines(false)} />}
      <AnimatePresence>{showUsage && preferences.usageEnabled && <UsagePanel key="usage" onClose={() => setShowUsage(false)} onSettings={() => { setShowUsage(false); setSettingsAt({ tab: 'agents', section: 'Uso' }); setShowSettings(true) }} />}</AnimatePresence>

      {newTerm && (
        <NewTerminalDialog
          workspaceId={ws.id}
          sizeLabel={newTerm.frame ? `${newTerm.frame.size.w}×${newTerm.frame.size.h}` : null}
          accounts={accounts}
          onCancel={() => setNewTerm(null)}
          onCreate={(form) => createTerminal(newTerm.frame, form)}
        />
      )}

      {newPortal && <NewPortalDialog onCancel={() => setNewPortal(null)} onCreate={(form) => createPortal(newPortal.frame, form)} />}

      {dialog && (
        <div className="modal-back" onPointerDown={() => setDialog(null)}>
          {dialog.kind === 'floor-create' && (
            <FloorCreateSheet defaultDir={firstTerminalDir()} onSubmit={submitFloor} onCancel={() => setDialog(null)} />
          )}
          {dialog.kind === 'band-create' && (
            <form className="modal" onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => submitBand(e, dialog.terminals)}>
              <label>{t('App.nova_banda_com', { count: dialog.terminals.length })}</label>
              <input name="name" autoFocus defaultValue={defaultName(t('App.banda'), ws)} />
              <div className="modal-actions">
                <button type="button" onClick={() => setDialog(null)}>
                  {t('App.cancelar')}
                </button>
                <button type="submit">{t('App.agrupar')}</button>
              </div>
            </form>
          )}
          {dialog.kind === 'confirm' && (
            <div className={dialog.floorSheet ? 'floor-sheet' : 'modal'} role="dialog" onPointerDown={(e) => e.stopPropagation()}>
              <label>{dialog.title}</label>
              <p className="modal-text">{dialog.body}</p>
              <div className="modal-actions">
                <button onClick={() => setDialog(null)}>{t('App.cancelar')}</button>
                <button className={dialog.danger ? 'danger' : ''} onClick={dialog.onConfirm} autoFocus>
                  {dialog.confirmLabel}
                </button>
              </div>
            </div>
          )}
          {dialog.kind === 'message' && (
            <div className="modal" role="alertdialog" onPointerDown={(e) => e.stopPropagation()}>
              <label>{dialog.title}</label>
              <p className="modal-text">{dialog.lines.join('\n')}</p>
              <div className="modal-actions">
                <button onClick={() => setDialog(null)} autoFocus>
                  {t('App.ok')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {shuttingDown && <ShutdownOverlay label={t('shutdown.processes')} onPainted={confirmShutdownPainted} />}
    </div>
  )
}

