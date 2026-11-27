import { matchesShortcut, matchesZoomWheel, usePreferences } from '../settings/preferences'
import { isEditingElsewhere, shouldHoverFocus } from './screen-options'
import { snapFrame } from './commands/snap'
import { installHistoryKeys, ownsHistoryFocus } from './history-keys'
import { cardFrameAt, type CardDrag } from './card-frame'
import { stackMembers, stackView, type StackTab } from './note-stack'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasNode, CrossLinkView, Drawing, DrawingPatch, FloorId, LinkNode, Size, Vec, Workspace } from '../../../shared/model'
import { screenToWorld, snap, zoomAt, type Camera } from './camera'
import { Connections, type Frames } from './Connections'
import { RopePopover } from './RopePopover'
import { cutConnections } from './connection-cut'
import { bandFrame } from './band-frame'
import { crossFloorPeers, crossWorkspacePeers, nodesOnFloor, visibleConnections, type CrossFloorPeer, type CrossWorkspacePeer } from '../floors/floor-view'
import { BandFrame } from '../nodes/BandFrame'
import { PortalView } from '../nodes/PortalView'
import { ChatHeaderButton, TerminalFace, chatToggle } from '../chat/TerminalFace'
import { Composer } from '../composer/Composer'
import { environmentLabel } from '../../../shared/environment'
import { NoteView } from '../nodes/NoteView'
import { TextView } from '../nodes/TextView'
import { TerminalIcon } from '../nodes/terminal-icons'
import { FileView } from '../nodes/FileView'
import { FileTreeView } from '../nodes/FileTreeView'
import { Drawings, type TransformTarget } from './Drawings'
import { boxCenter, groupBox, groupResizePatches, groupRotatePatches, pointsBox, resizePatch, rotatePatch, snapAngle } from './draw/transform'
import { snapToShapes } from './draw/geometry'
import { DrawingTextEditor } from './draw/DrawingTextEditor'
import { useCompletionBadges } from '../settings/completion-badges'
import { isLiftable, liftFrame, liftRect } from './lift'
import { dismissLift, dockNode, dockRect, dockZone, EMPTY_DOCK, liftNode, panelKindOf, type DockEdge, type DockState, type PanelKind } from './dock'
import { DrawingSelectionToolbar } from './draw/DrawToolbar'
import { selectionStyle, SNAP_REACH_PX, snapLine, styleFields, styleOperations } from './draw/style'
import { Minimap } from './Minimap'
import type { Tool } from '../dock/Dock'
import { isPlaceKind, PlacementGesture, type PlaceKind } from './placement'
import { PlacementLayer } from './PlacementLayer'
import { clampWidth, DEFAULT_DRAW_STYLE, gesturePoints, isAreaShape, keepsDrawing, kindOf, type DrawStyle, type DrawTool } from './draw/tools'
import { recognize } from './draw/recognize'
import { drawKeyAction } from './draw/keys'
import { commitDrawing } from './draw/commit'
import { lassoHits, mergeSelection, normRect, selectAllHits } from './selection/lasso'
import { batchTooLarge, batchTooLargeMessage, captureSelection, deleteOperations, DUPLICATE_OFFSET, isLockedNode, movableNodeIds, moveOperations, pasteOffset, pasteOperations, type CanvasClip } from './selection/group'
import { selectionKeyAction } from './selection/keys'
import type { HistoryOperation } from '../../../shared/api'
import { t } from '../i18n'
import { isHeld } from '../../../shared/lock'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { canvasMenu, scoresMenu, type ScoreAction } from './menu-items'
import { paperVars } from '../nodes/note-colors'
import { floorGroups } from '../../../shared/groups'
import { Check, FileSymlink } from 'lucide-react'
import { StackRename } from '../nodes/StackRename'
import { LinkCard } from '../nodes/LinkCard'
import { LINK_MIN, linkNode } from '../nodes/link'
import { GroupFrames } from './groups/GroupFrames'
import { groupFrame } from './groups/group-frame'
import { groupMenu } from './groups/group-menu'
import { drawingMenu, elementMenu } from './element-menu'
import { alignFrames, type AlignId } from './commands/align'
import { tidyFrames } from './commands/tidy'
import { fileNotes, unfileNote } from './note-stack'
import { drawingBox } from './selection/lasso'
import { quotePath, terminalHandle } from '../nodes/terminal-registry'
import { UnloadedCard, RedactedFace } from '../nodes/NodeStateFaces'
import { useRightDragPan } from './right-drag'
import { decidePaste, elementClipboard } from './selection/clipboard'
import { nodesForDrop } from './drop'
import { placementFrame } from './placement'
import { normalizePortalInput, uniquePortalName } from '../../../shared/portal-settings'
import { emptyForm, quickStartTiles, quickTileForm, toNewNode, type QuickTile } from '../dialogs/new-terminal'

/** Sem gesto em 4 s, o retângulo armado pelo `b` desarma (volta para Seleção). */
const ARM_TIMEOUT_MS = 4000
/** Distância mínima (em px de tela) entre pontos de um traço. */
const PEN_STEP = 2
const MAX_PEN_POINTS = 20_000
/** Até aqui (px de tela) o soltar conta como clique: o card não se move nem é gravado. */
const CLICK_SLOP_PX = 3


interface Props {
  ws: Workspace
  camera: Camera
  onCamera(c: Camera): void
  linkFrom: string | null
  onLink(id: string): void
  selectedConn: string | null
  onSelectConn(id: string | null): void
  /** Terminais escolhidos com Shift+clique (para agrupar em banda). */
  selection: ReadonlySet<string>
  onToggleSelect(id: string): void
  /** Clique simples num nó seleciona só ele; no fundo, limpa a seleção (`null`). */
  onSelectOnly?(id: string | null): void
  /** Laço, colar e duplicar: a seleção de nós passa a ser exatamente estes ids. */
  onSelectMany?(ids: string[]): void
  /** Chip de conexão entre floors: vai ao floor do outro lado. */
  onGoToFloor(id: FloorId): void
  /** Ponta do menu da corda: vai até o nó (troca de andar se preciso) e o seleciona. */
  onFocusNode?(nodeId: string, floorId: FloorId): void
  /** Ferramenta do dock: no modo desenho, arrastar no canvas desenha. */
  tool?: Tool
  /** Duração da transição da câmera num salto (ir até um nó); 0 = instantâneo. */
  glideMs?: number
  showMinimap?: boolean
  /** Tamanho visível do canvas (para o zoom pela barra e o minimapa). */
  onViewSize?(size: Size): void
  /** Fim de um gesto de colocação (ferramentas de criação do dock): o frame já em mundo e na grade. */
  onPlace?(kind: PlaceKind, frame: { pos: Vec; size: Size }): void
  /** Arquivos soltos no canvas (arrastados do gerenciador de arquivos do sistema), com o ponto do mundo onde caíram. */
  onDropFiles?(files: File[], at: Vec): void
  /** Barra de desenho: ferramenta, cor, espessura e padrão do próximo traço. */
  drawStyle?: DrawStyle
  onDrawStyle?(next: DrawStyle): void
  /** Avisa quando há desenhos selecionados: a barra de estilo deles tem prioridade sobre a barra dos nós. */
  onDrawingsSelected?(selected: boolean): void
  /** Elemento elevado ao painel central (ou null) e como recolher. */
  /** Elemento elevado e elemento encaixado na borda; como mudar; e o recuo da barra lateral (a faixa da frente começa depois dele). */
  dock?: DockState
  onDock?(next: DockState): void
  leadingInset?: number
  /** Troca a ferramenta do dock (o `b` arma o desenho; forma confirmada e Escape voltam para Seleção). */
  onTool?(tool: Tool): void
  /** Menu do botão direito › Partituras: criar ou atualizar com estes nós, ou abrir a biblioteca. */
  onPartitura?(action: ScoreAction, nodeIds: string[]): void
  /** Uma ação do menu do botão direito falhou. */
  onFail?(title: string, err: unknown): void
  /** Aviso curto (por exemplo, "Abrir" que só mostrou o arquivo na pasta). */
  onNotice?(message: string): void
  onEditTerminal?(id: string): void
  onEditPortal?(id: string): void
  onCreateBand?(terminals: string[]): void
  /** Ação do menu que pede confirmação antes (apagar banda, limpar histórico ou armazenamento). */
  onConfirm?(ask: { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm(): void }): void
}

/** O que o botão direito acertou. */
type MenuTarget = { kind: 'canvas' } | { kind: 'node'; id: string } | { kind: 'drawing'; id: string } | { kind: 'group'; id: string }
interface MenuState { target: MenuTarget; at: { x: number; y: number }; world: Vec; presets: QuickTile[]; hasSavedScore: boolean; /** Texto selecionado no xterm quando o menu abriu. */ termSelection: string }

type Drag =
  | { kind: 'pan'; start: Vec; offset: Vec; /** Pan iniciado com o botão esquerdo: se não andar, vale como clique no fundo. */ click?: { onRoot: boolean } }
  /** Laço no fundo: cantos em mundo; Shift no início soma à seleção. */
  | { kind: 'lasso'; start: Vec; startScreen: Vec; additive: boolean }
  /** Seleção inteira arrastada pelo cabeçalho; com Alt no início, solta cópias e os originais ficam. */
  | { kind: 'group'; start: Vec; ids: string[]; drawings: string[]; origins: Record<string, { pos: Vec; size: Size }>; alt: boolean }
  | (CardDrag & { id: string })
  | { kind: 'draw'; last: Vec; tool: DrawTool; raw: Vec[] }
  | { kind: 'control'; id: string }
  | { kind: 'transform'; target: TransformTarget; start: Vec; startLocal: Vec }
  | { kind: 'panel'; id: string; start: Vec }
  | { kind: 'dockresize'; id: string; start: Vec; width: number; edge: DockEdge }
  | { kind: 'place' }

const MODIFIERS = ['Control', 'Meta', 'Alt', 'Shift']
const PAN_CURSOR_DELAY_MS = 250
/** O ponteiro está no fundo, num desenho ou numa corda (e não num card, botão, campo ou menu)? */
function isPanSurface(target: EventTarget, root: Element): boolean {
  if (target === root) return true
  if (!(target instanceof Element) || !target.closest('.world')) return false
  return !target.closest('.node, .band-label, .rope-popover, button, input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')
}

export function Canvas({ ws, camera, onCamera, linkFrom, onLink, selectedConn, onSelectConn, selection, onToggleSelect, onSelectOnly, onSelectMany, onGoToFloor, onFocusNode, tool = 'select', glideMs = 0, onDropFiles, showMinimap = false, onViewSize, onPlace, drawStyle = DEFAULT_DRAW_STYLE, onDrawStyle, onDrawingsSelected, dock = EMPTY_DOCK, onDock, leadingInset = 0, onTool, onPartitura, onFail, onNotice, onEditTerminal, onEditPortal, onCreateBand, onConfirm }: Props) {
  const liftedId = dock.liftedId
  const completed = useCompletionBadges()
  /** Largura escolhida do painel encaixado por tipo (lembrada entre sessões), e o arrasto do painel em andamento. */
  const [dockWidths, setDockWidths] = useState<Partial<Record<PanelKind, number>>>(() => { try { return JSON.parse(localStorage.getItem('palco.dockWidths') ?? '{}') as Partial<Record<PanelKind, number>> } catch { return {} } })
  const [panelDrag, setPanelDrag] = useState<{ id: string; dx: number; dy: number; zone: 'leading' | 'trailing' | null } | null>(null)
  const [dockWidthLive, setDockWidthLive] = useState<number | null>(null)
  const panelRect = (n: CanvasNode): { rect: ReturnType<typeof liftRect>; mode: 'lift' | 'dock' } | null => {
    if (view.w <= 0 || !isLiftable(n)) return null
    if (dock.liftedId === n.id) return { rect: liftRect(n, view), mode: 'lift' }
    if (dock.dockedId === n.id) return { rect: dockRect(panelKindOf(n), dock.edge, view, { leadingInset, width: dockWidthLive ?? dockWidths[panelKindOf(n)] }), mode: 'dock' }
    return null
  }
  const onDrawingsSelectedRef = useRef(onDrawingsSelected)
  onDrawingsSelectedRef.current = onDrawingsSelected
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const prefs = usePreferences()
  const camRef = useRef(camera)
  camRef.current = camera
  const [frames, setFrames] = useState<Frames>({})
  // Menu da corda (clique ou botão direito numa corda): as cordas sob o clique e onde abrir; `ropeLit` destaca a da linha sob o mouse.
  const [ropeMenu, setRopeMenu] = useState<{ ids: string[]; at: { x: number; y: number } } | null>(null)
  const [ropeLit, setRopeLit] = useState<string | null>(null)
  const [ropeStatus, setRopeStatus] = useState('')
  const closeRopeMenu = useCallback(() => { setRopeMenu(null); setRopeLit(null) }, [])
  useEffect(() => { closeRopeMenu() }, [ws.id, ws.activeFloor, tool, linkFrom, closeRopeMenu])
  useEffect(() => {
    const el = root.current
    if (!el || !window.palco?.history) return
    return installHistoryKeys(el, ws.id, window.palco.history, () => {
      cancelRef.current(); clearPendingFrames(); setFrames({}); setSelectedDrawings(new Set())
      onSelectConn(null); onSelectOnly?.(null)
    }, err => console.warn(t('canvas.Canvas.nao_foi_possivel_desfazer_refa'), err))
  }, [ws.id, ws.activeFloor, onSelectConn, onSelectOnly])
  // Cordas entre workspaces: o main as guarda fora do workspace; relê quando o canvas muda e a cada poucos segundos.
  const [crossLinks, setCrossLinks] = useState<CrossLinkView[]>([])
  useEffect(() => {
    const api = window.palco?.links
    if (!api) return
    let alive = true
    // Só re-renderiza quando a lista muda de verdade.
    const load = (): void => { void api.list().then((l) => { if (alive) setCrossLinks((prev) => (JSON.stringify(prev) === JSON.stringify(l) ? prev : l)) }).catch(() => {}) }
    load()
    const timer = setInterval(load, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [ws])
  // × no chip remoto: desfaz a corda no main e tira o chip já, sem esperar a próxima leitura.
  const cutRemote = (linkId: string): void => {
    void window.palco.links?.remove?.(linkId).then(() => setCrossLinks((prev) => prev.filter((l) => l.id !== linkId))).catch(() => {})
  }
  const pendingFrames = useRef(new Map<string, { frame: Frames[string]; kind: 'move' | 'resize'; token: symbol; timer: ReturnType<typeof setTimeout> }>())
  const clearPendingFrame = (id: string): void => {
    const pending = pendingFrames.current.get(id)
    if (pending) clearTimeout(pending.timer)
    pendingFrames.current.delete(id)
  }
  const clearPendingFrames = (): void => {
    for (const id of pendingFrames.current.keys()) clearPendingFrame(id)
  }
  const captured = useRef<{ element: HTMLElement; pointerId: number } | null>(null)
  const releaseCapture = (): void => {
    const pointer = captured.current; captured.current = null
    if (pointer?.element.hasPointerCapture?.(pointer.pointerId)) pointer.element.releasePointerCapture(pointer.pointerId)
  }
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renamingStack, setRenamingStack] = useState<string | null>(null)
  /** Fichário → nota da frente (escolhida na aba). */
  const [stackFront, setStackFront] = useState<Record<string, string>>({})
  const [live, setLive] = useState<Omit<Drawing, 'id'> | null>(null)
  const liveRef = useRef(live)
  liveRef.current = live
  const [selectedDrawings, setSelectedDrawings] = useState<ReadonlySet<string>>(new Set())
  /**
   * Card selecionado por um clique no corpo: enquanto a seleção for essa, Delete/Backspace não o apagam. Qualquer
   * outro caminho (cabeçalho, laço, atalho, notificação) muda a seleção ou limpa isto, e volta a apagar.
   */
  const bodySelected = useRef<string | null>(null)
  useEffect(() => {
    const id = bodySelected.current
    if (id !== null && !(selection.size === 1 && selection.has(id))) bodySelected.current = null
  }, [selection])
  /** Ponto de controle da seta curva em arrasto (ainda não gravado). */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, DrawingPatch>>(new Map())
  useEffect(() => { onDrawingsSelectedRef.current?.(selectedDrawings.size > 0 && tool === 'select') }, [selectedDrawings, tool])
  useEffect(() => () => onDrawingsSelectedRef.current?.(false), [])
  /** Texto de forma em edição (duplo clique): id e o que foi digitado até agora. */
  const [editingText, setEditingText] = useState<{ id: string; value: string } | null>(null)
  const editingRef = useRef(editingText)
  editingRef.current = editingText
  const commitText = (): void => {
    const cur = editingRef.current
    if (!cur) return
    setEditingText(null)
    const before = (ws.drawings ?? []).find((x) => x.id === cur.id)?.text ?? ''
    const next = cur.value.trim()
    if (next === before) return
    void window.palco.history.commit(ws.id, [{ type: 'drawing.patch', id: cur.id, patch: { text: next.length ? next : null } }]).catch((err: unknown) => console.warn('texto recusado:', err))
  }
  const overridesRef = useRef(overrides)
  overridesRef.current = overrides
  /** Prévia do laço (mundo), do arrasto em grupo (deslocamento dos desenhos) e do pan por Space ou H. */
  const [lasso, setLasso] = useState<{ pos: Vec; size: Size } | null>(null)
  const [groupShift, setGroupShift] = useState<{ ids: ReadonlySet<string>; by: Vec } | null>(null)
  const [panHeld, setPanHeld] = useState(false)
  // As teclas de pan seguradas agora (Ctrl e Espaço podem estar juntas); `panHeld` é só o cursor.
  const heldPanKeys = useRef(new Map<string, { key: string; code?: string }>()), panCursorTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [panToggle, setPanToggle] = useState(false)
  // Menu do botão direito: o alvo, o ponto na tela e em mundo (o que ele cria nasce ali) e o que ele precisou perguntar ao main.
  const [ctxMenu, setCtxMenu] = useState<MenuState | null>(null)
  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])
  useEffect(() => { setCtxMenu(null) }, [ws.id, ws.activeFloor, tool, linkFrom])
  useRightDragPan(root, prefs.rightDragPansCanvas && !linkFrom, camRef, onCamera)
  const [view, setView] = useState<Size>({ w: 0, h: 0 })
  const gesture = useRef(new PlacementGesture())
  const [placePreview, setPlacePreview] = useState<{ pos: Vec; size: Size } | null>(null)
  const placing = isPlaceKind(tool)
  useEffect(() => {
    if (!linkFrom) return
    const cancel = (event: KeyboardEvent): void => {
      if (!matchesShortcut('cancel', event) || root.current?.closest('[inert]')) return
      event.preventDefault(); event.stopPropagation()
      onLink(linkFrom)
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [linkFrom, onLink])

  /** Cancelar não persiste o preview (inclusive quando o pointerup nunca chega). */
  const cancelGesture = (): void => {
    const active = drag.current
    gesture.current.cancel(); drag.current = null
    releaseCapture(); setPlacePreview(null); setLive(null)
    if (active?.kind === 'move' || active?.kind === 'resize') setFrames(all => {
      const { [active.id]: _gone, ...rest } = all
      return rest
    })
  }
  const cancelRef = useRef(cancelGesture)
  cancelRef.current = cancelGesture

  // Esc no meio do arrasto cancela só o arrasto (o App, com Esc fora dele, volta para Seleção).
  // A janela perdendo o foco também cancela: o soltar pode nunca chegar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!matchesShortcut('cancel', e) || (!gesture.current.active && !drag.current)) return
      e.stopPropagation()
      e.preventDefault()
      cancelRef.current()
    }
    const onBlur = (): void => cancelRef.current()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  // Nenhum frame de uma vista pode reaparecer por cima dos dados salvos de outra.
  useLayoutEffect(() => {
    cancelRef.current(); clearPendingFrames(); setFrames({}); setRenaming(null); setRenamingGroup(null); setRenamingStack(null)
  }, [ws.activeFloor, ws.id])
  useEffect(() => cancelRef.current(), [tool])
  useLayoutEffect(() => {
    const accepted = new Set<string>()
    for (const [id, pending] of pendingFrames.current) {
      const node = ws.nodes[id]
      if (!node || (pending.kind === 'move'
        ? node.pos.x === pending.frame.pos.x && node.pos.y === pending.frame.pos.y
        : node.size.w === pending.frame.size.w && node.size.h === pending.frame.size.h)) {
        accepted.add(id); clearPendingFrame(id)
      }
    }
    if (accepted.size) setFrames(all => Object.fromEntries(Object.entries(all).filter(([id]) => !accepted.has(id))))
  }, [ws.nodes])
  useEffect(() => () => { releaseCapture(); clearPendingFrames() }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const update = (): void => {
      const next = { w: el.clientWidth, h: el.clientHeight }
      setView(next)
      onViewSize?.(next)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onViewSize])

  // Trocar de ferramenta ou de floor solta os desenhos escolhidos.
  useEffect(() => setSelectedDrawings(new Set()), [tool, ws.activeFloor, ws.id])

  /** Nós selecionados com os fichários inteiros (a nota da frente leva as outras). */
  const selectedNodeIds = (): string[] => [...new Set([...selection].flatMap((id) => membersOf(id)))].filter((id) => ws.nodes[id]?.floorId === ws.activeFloor)
  /** Um lote no histórico (uma transação); ids novos de node.add/drawing.add passam a ser a seleção. */
  const commitGroup = (ops: HistoryOperation[], selectNew: boolean): void => {
    if (!ops.length) return
    if (batchTooLarge(ops)) { window.alert(batchTooLargeMessage()); return }
    void window.palco.history.commit(ws.id, ops).then((ids) => {
      if (!selectNew) return
      const nodes: string[] = [], drawings: string[] = []
      ops.forEach((op, i) => {
        const id = ids[i]
        if (typeof id !== 'string') return
        if (op.type === 'node.add') nodes.push(id)
        if (op.type === 'drawing.add') drawings.push(id)
      })
      onSelectMany?.(nodes); setSelectedDrawings(new Set(drawings))
    }).catch((err: unknown) => console.warn(t('canvas.Canvas.acao_em_grupo_recusada'), err))
  }

  // Teclas do laço (selection/keys.ts): Delete/Backspace apagam tudo o que está selecionado, Ctrl+C/V/D copiam, colam e
  // duplicam, H alterna o pan e a tecla configurada segura o pan. Cada ação é uma transação do histórico.
  const groupKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  groupKeyRef.current = (e: KeyboardEvent): void => {
    if (root.current?.closest('[inert]') || linkFrom) return
    if (matchesShortcut('cancel', e) && selectedDrawings.size) setSelectedDrawings(new Set())
    const nodeIds = selectedNodeIds(), drawingIds = [...selectedDrawings]
    const action = selectionKeyAction(e, { hasSelection: nodeIds.length + drawingIds.length > 0 })
    if (!action) return
    if (action.kind === 'delete' && bodySelected.current !== null && selection.has(bodySelected.current)) return
    if (action.kind === 'hold-pan') {
      const modifier = MODIFIERS.includes(e.key)
      if (!modifier) e.preventDefault()
      if (!e.repeat) {
        heldPanKeys.current.set(e.code || e.key, { key: e.key, code: e.code })
        clearTimeout(panCursorTimer.current)
        // Um modificador sozinho só muda o cursor se ficar segurado: senão ele piscaria em todo Ctrl+C, V e Z.
        if (modifier) panCursorTimer.current = setTimeout(() => setPanHeld(true), PAN_CURSOR_DELAY_MS)
        else setPanHeld(true)
      }
      return
    }
    if (action.kind === 'toggle-pan') { e.preventDefault(); setPanToggle((v) => !v); return }
    e.preventDefault()
    if (action.kind === 'delete') {
      commitGroup(deleteOperations(ws, nodeIds, drawingIds), false)
      onSelectOnly?.(null); setSelectedDrawings(new Set())
    } else if (action.kind === 'select-all') {
      bodySelected.current = null
      const all = selectAllHits(ws)
      onSelectMany?.(all.nodes); setSelectedDrawings(new Set(all.drawings))
    } else if (action.kind === 'nudge') {
      // Setas: 1 unidade (Shift: 10), sem encaixar na grade; itens travados ficam. Desenho movido é recriado, então a seleção passa para o novo.
      const ops = moveOperations(ws, nodeIds, drawingIds, action.by, { snap: false })
      if (!ops.length) return
      if (batchTooLarge(ops)) { window.alert(batchTooLargeMessage()); return }
      void window.palco.history.commit(ws.id, ops).then((ids) => {
        if (drawingIds.length) setSelectedDrawings(new Set(ops.flatMap((op, i) => (op.type === 'drawing.add' && typeof ids[i] === 'string' ? [ids[i] as string] : []))))
      }).catch((err: unknown) => console.warn('movimento recusado:', err))
    } else if (action.kind === 'copy') {
      elementClipboard.set(captureSelection(ws, nodeIds, drawingIds))
    } else if (action.kind === 'duplicate') {
      commitGroup(pasteOperations(captureSelection(ws, nodeIds, drawingIds), DUPLICATE_OFFSET, Object.values(ws.nodes).map((n) => n.name), ws.activeFloor), true)
    } else if (action.kind === 'paste') {
      const center = screenToWorld({ x: (root.current?.clientWidth ?? 0) / 2, y: (root.current?.clientHeight ?? 0) / 2 }, camRef.current)
      // O mesmo "Colar" do menu: os elementos copiados, ou o que o usuário copiou depois (arquivos, imagem, endereço).
      void pasteAt(center, true).catch(failed(t('ctx.nao_foi_possivel_colar')))
    }
  }
  useEffect(() => {
    const modifierOnly = (): boolean => [...heldPanKeys.current.values()].every(h => MODIFIERS.includes(h.key))
    const cursorOff = (): void => { clearTimeout(panCursorTimer.current); setPanHeld(false) }
    const onKey = (e: KeyboardEvent): void => {
      if (!MODIFIERS.includes(e.key) && e.key !== ' ' && modifierOnly()) cursorOff() // é um atalho (Ctrl+C), não um pan
      groupKeyRef.current(e)
    }
    const onUpKey = (e: KeyboardEvent): void => {
      let released = false
      for (const [code, held] of heldPanKeys.current) {
        if (e.key === held.key || !matchesShortcut('panHold', { ...held, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey })) { heldPanKeys.current.delete(code); released = true }
      }
      if (released && heldPanKeys.current.size === 0) cursorOff()
    }
    const onBlur = (): void => { heldPanKeys.current.clear(); cursorOff() }
    const onVisibility = (): void => { if (document.visibilityState === 'hidden') onBlur() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUpKey)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUpKey); window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])

  // Teclas do desenho: `b` arma o retângulo (desarma em 4 s sem gesto), `[`/`]` mudam a espessura, Escape cancela o
  // gesto em andamento (sem sair do desenho) ou sai do desenho. Captura: o Escape do gesto não chega ao do app.
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const styleRef = useRef(drawStyle)
  styleRef.current = drawStyle
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (root.current?.closest('[inert]') || linkFrom) return
      const action = drawKeyAction(e, { drawing: tool === 'draw', gesture: drag.current?.kind === 'draw', hasSelection: selection.size > 0 || selectedDrawings.size > 0 })
      if (!action) return
      const style = styleRef.current
      if (action.kind === 'cancel-gesture') {
        e.preventDefault(); e.stopImmediatePropagation()
        cancelRef.current()
      } else if (action.kind === 'exit') {
        e.preventDefault()
        onTool?.('select')
      } else if (action.kind === 'width') {
        e.preventDefault()
        onDrawStyle?.({ ...style, width: clampWidth(style.width + action.delta) })
      } else if (action.kind === 'arm-rect' && onTool && onDrawStyle) {
        e.preventDefault()
        onDrawStyle({ ...style, tool: 'rect', shape: 'rect' })
        onTool('draw')
        clearTimeout(armTimer.current)
        armTimer.current = setTimeout(() => { if (drag.current?.kind !== 'draw') onTool('select') }, ARM_TIMEOUT_MS)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tool, selection, selectedDrawings, linkFrom, onTool, onDrawStyle])
  useEffect(() => { if (tool !== 'draw') clearTimeout(armTimer.current) }, [tool])
  useEffect(() => () => clearTimeout(armTimer.current), [])

  const localPoint = (e: { clientX: number; clientY: number }): Vec => {
    const rect = root.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Wheel precisa de listener não passivo para impedir o zoom da página.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      // Sem o modificador do zoom, a roda (ou o trackpad) move a vista, já que arrastar o fundo agora faz o laço. Dentro de um card, o card rola.
      if (!matchesZoomWheel(e)) {
        if ((e.target as Element).closest?.('.node')) return
        e.preventDefault()
        const cam = camRef.current
        onCamera({ zoom: cam.zoom, offset: { x: cam.offset.x - e.deltaX, y: cam.offset.y - e.deltaY } })
        return
      }
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      onCamera(zoomAt(camRef.current, p, Math.exp(-e.deltaY * 0.0015)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onCamera])

  /** Linha e seta encaixam as pontas nas bordas das formas do andar (alcance em pixels de tela). */
  const snapped = (t: DrawTool, pts: Vec[]): Vec[] => (t === 'line' || t === 'arrow'
    ? snapLine(pts, (ws.drawings ?? []).filter((x) => x.floorId === ws.activeFloor), SNAP_REACH_PX / camRef.current.zoom) : pts)
  /** Os desenhos em andamento da alça arrastada (redimensionar, girar, ponta), como mudanças ainda não gravadas. */
  const transformPatches = (d: Extract<Drag, { kind: 'transform' }>, e: { clientX: number; clientY: number; shiftKey: boolean }, cam: { offset: Vec; zoom: number }): Map<string, DrawingPatch> => {
    const all = ws.drawings ?? [], t = d.target, z = cam.zoom
    const delta = { x: (e.clientX - d.start.x) / z, y: (e.clientY - d.start.y) / z }
    if (t.mode === 'endpoint') {
      const dr = all.find((x) => x.id === t.id)
      if (!dr) return new Map()
      const last = dr.points.length - 1, fixed = dr.points[t.end === 0 ? last : 0]!
      let p = screenToWorld(localPoint(e), cam)
      if (e.shiftKey) { const len = Math.hypot(p.x - fixed.x, p.y - fixed.y), a = Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / (Math.PI / 4)) * (Math.PI / 4); p = { x: fixed.x + len * Math.cos(a), y: fixed.y + len * Math.sin(a) } }
      else p = snapToShapes(p, all.filter((x) => x.id !== t.id && x.floorId === ws.activeFloor), SNAP_REACH_PX / z)
      return new Map([[t.id, { points: t.end === 0 ? [p, ...dr.points.slice(1)] : [...dr.points.slice(0, last), p] }]])
    }
    const ds = all.filter((x) => t.ids.includes(x.id))
    if (!ds.length) return new Map()
    if (t.mode === 'resize') return ds.length === 1 ? new Map([[ds[0]!.id, resizePatch(ds[0]!, t.handle, delta, e.shiftKey)]]) : groupResizePatches(ds, t.handle, delta, e.shiftKey)
    const center = ds.length === 1 ? boxCenter(pointsBox(ds[0]!.points)) : boxCenter(groupBox(ds))
    const screen = { x: center.x * z + cam.offset.x, y: center.y * z + cam.offset.y }, at = (p: Vec): number => Math.atan2(p.x - screen.x, -(p.y - screen.y))
    let angle = at(localPoint(e)) - at(d.startLocal)
    if (ds.length === 1) { angle += ds[0]!.rotation ?? 0; if (e.shiftKey) angle = snapAngle(angle); return new Map([[ds[0]!.id, rotatePatch(ds[0]!, angle)]]) }
    if (e.shiftKey) angle = snapAngle(angle)
    return groupRotatePatches(ds, center, angle)
  }
  const begin = (e: ReactPointerEvent, d: Drag): void => {
    e.preventDefault()
    e.stopPropagation()
    const element = e.currentTarget as HTMLElement
    element.setPointerCapture(e.pointerId)
    captured.current = { element, pointerId: e.pointerId }
    if (d.kind === 'move' || d.kind === 'resize') clearPendingFrame(d.id)
    drag.current = d
  }

  /** O card do fichário move e redimensiona todas as notas dele juntas (fichário com uma nota é nota comum). */
  const membersOf = (id: string): string[] => {
    const n = ws.nodes[id]
    if (n?.kind !== 'note' || !n.stackId) return [id]
    const ids = stackMembers(Object.values(ws.nodes), n.stackId).filter((m) => m.floorId === n.floorId).map((m) => m.id)
    return ids.length >= 2 ? ids : [id]
  }

  /** Menor tamanho ao redimensionar: o cartão de link é baixo. */
  const minOf = (id: string): Size | undefined => (ws.nodes[id]?.kind === 'link' ? LINK_MIN : undefined)

  const onMove = (e: ReactPointerEvent): void => {
    const d = drag.current
    if (!d) return
    const cam = camRef.current
    const cur = { x: e.clientX, y: e.clientY }
    if (d.kind === 'place') {
      setPlacePreview(gesture.current.move(screenToWorld(localPoint(e), cam)))
    } else if (d.kind === 'draw') {
      const stroke = liveRef.current
      if (!stroke || Math.hypot(cur.x - d.last.x, cur.y - d.last.y) < PEN_STEP || d.raw.length >= MAX_PEN_POINTS) return
      d.last = cur
      const p = screenToWorld(localPoint(e), cam)
      d.raw = keepsDrawing(d.tool) ? [...d.raw, p] : [d.raw[0]!, p]
      setLive({ ...stroke, points: snapped(d.tool, gesturePoints(d.tool, d.raw, e.shiftKey)) })
    } else if (d.kind === 'control') {
      setOverrides(new Map([[d.id, { control: screenToWorld(localPoint(e), cam) }]]))
    } else if (d.kind === 'transform') {
      setOverrides(transformPatches(d, e, cam))
    } else if (d.kind === 'panel') {
      const dx = cur.x - d.start.x, dy = cur.y - d.start.y, z = dockZone({ x: localPoint(e).x, translation: dx }, dock, view, leadingInset, d.id)
      setPanelDrag({ id: d.id, dx, dy, zone: z.kind === 'dock' ? z.edge : null })
    } else if (d.kind === 'dockresize') {
      const dx = cur.x - d.start.x
      setDockWidthLive(Math.round(d.width + (d.edge === 'trailing' ? -dx : dx)))
    } else if (d.kind === 'pan') {
      onCamera({ zoom: cam.zoom, offset: { x: d.offset.x + cur.x - d.start.x, y: d.offset.y + cur.y - d.start.y } })
    } else if (d.kind === 'lasso') {
      const r = normRect(d.start, screenToWorld(localPoint(e), cam))
      setLasso({ pos: { x: r.x, y: r.y }, size: { w: r.w, h: r.h } })
    } else if (d.kind === 'group') {
      const by = { x: (cur.x - d.start.x) / cam.zoom, y: (cur.y - d.start.y) / cam.zoom }
      setFrames(all => ({ ...all, ...Object.fromEntries((d.alt ? d.ids : movableNodeIds(ws, d.ids)).map((id) => {
        const o = d.origins[id]!
        return [id, { pos: { x: o.pos.x + by.x, y: o.pos.y + by.y }, size: o.size }]
      })) }))
      setGroupShift({ ids: new Set(d.drawings), by })
    } else {
      if (!ws.nodes[d.id]) return
      const ids = membersOf(d.id)
      const next = tileSnapped(d, cardFrameAt(d, cur, cam.zoom, minOf(d.id)), e)
      setFrames(all => ({ ...all, ...Object.fromEntries(ids.map((id) => [id, next])) }))
    }
  }

  /** "Modificador de encaixe magnético": com ele apertado, a borda do elemento arrastado cola na dos vizinhos (só arrasto de um elemento). */
  const tileSnapped = (d: { id: string }, frame: { pos: Vec; size: Size }, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): { pos: Vec; size: Size } => {
    if (membersOf(d.id).length !== 1 || !matchesShortcut('tile', { key: '', ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey })) return frame
    const others = Object.values(ws.nodes).filter((n) => n.floorId === ws.activeFloor && n.kind !== 'band' && n.id !== d.id).map((n) => ({ id: n.id, pos: (frames[n.id] ?? n).pos, size: (frames[n.id] ?? n).size }))
    return { ...frame, pos: snapFrame({ id: d.id, ...frame }, others).pos }
  }

  const onUp = (e: ReactPointerEvent): void => {
    const d = drag.current
    drag.current = null
    releaseCapture()
    if (!d) return
    if (d.kind === 'pan') {
      // Pan que não andou é um clique no fundo: solta a corda, limpa a seleção (ou recolhe o elemento elevado).
      if (d.click && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < CLICK_SLOP_PX) {
        if (liftedId && d.click.onRoot) { onDock?.(dismissLift(dock)); return }
        onSelectConn(null); onSelectOnly?.(null); setSelectedDrawings(new Set())
      }
      return
    }
    if (d.kind === 'lasso') {
      setLasso(null)
      const end = screenToWorld(localPoint(e), camRef.current)
      // Clique no fundo (sem arrasto): limpa a seleção; com Shift, mantém.
      if (Math.hypot(e.clientX - d.startScreen.x, e.clientY - d.startScreen.y) < CLICK_SLOP_PX) {
        if (!d.additive) { onSelectOnly?.(null); setSelectedDrawings(new Set()) }
        return
      }
      const next = mergeSelection({ nodes: selection, drawings: selectedDrawings }, lassoHits(normRect(d.start, end), ws), d.additive)
      bodySelected.current = null
      onSelectMany?.([...next.nodes]); setSelectedDrawings(next.drawings)
      return
    }
    if (d.kind === 'group') {
      setGroupShift(null)
      const zoom = camRef.current.zoom
      const by = { x: (e.clientX - d.start.x) / zoom, y: (e.clientY - d.start.y) / zoom }
      const dropAll = (): void => setFrames(all => Object.fromEntries(Object.entries(all).filter(([id]) => !d.ids.includes(id))))
      if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < CLICK_SLOP_PX) { dropAll(); return }
      const snapped = { x: snap(by.x), y: snap(by.y) }
      if (d.alt) {
        // Alt+arrasto: as cópias ficam onde soltou; os originais voltam ao lugar. Uma transação.
        dropAll()
        commitGroup(pasteOperations(captureSelection(ws, d.ids, d.drawings), snapped, Object.values(ws.nodes).map((n) => n.name), ws.activeFloor), true)
        return
      }
      // Mantém os frames finais até o snapshot confirmar, para evitar saltos após o arrasto.
      for (const id of movableNodeIds(ws, d.ids)) {
        const o = d.origins[id]!, frame = { pos: { x: o.pos.x + snapped.x, y: o.pos.y + snapped.y }, size: o.size }
        setFrames(all => ({ ...all, [id]: frame }))
        clearPendingFrame(id)
        const token = Symbol(id)
        const timer = setTimeout(() => { if (pendingFrames.current.get(id)?.token === token) { clearPendingFrame(id); setFrames(all => { const { [id]: _g, ...rest } = all; return rest }) } }, 2000)
        pendingFrames.current.set(id, { frame, kind: 'move', token, timer })
      }
      // Desenhos movidos são recriados: a seleção passa para os novos.
      const ops = moveOperations(ws, d.ids, d.drawings, by)
      if (!ops.length) { dropAll(); return }
      if (batchTooLarge(ops)) { dropAll(); window.alert(batchTooLargeMessage()); return }
      void window.palco.history.commit(ws.id, ops).then((ids) => {
        setSelectedDrawings(new Set(ops.flatMap((op, i) => (op.type === 'drawing.add' && typeof ids[i] === 'string' ? [ids[i] as string] : []))))
      }).catch((err: unknown) => { dropAll(); console.warn(t('canvas.Canvas.mover_em_grupo_recusado'), err) })
      return
    }
    if (d.kind === 'place') {
      const placed = gesture.current.end(screenToWorld(localPoint(e), camRef.current))
      setPlacePreview(null)
      if (placed) onPlace?.(placed.kind, placed.frame)
      return
    }
    if (d.kind === 'panel') {
      const dx = e.clientX - d.start.x, z = dockZone({ x: localPoint(e).x, translation: dx }, dock, view, leadingInset, d.id)
      setPanelDrag(null)
      if (z.kind === 'dock') onDock?.(dockNode(dock, d.id, z.edge))
      else if (z.kind === 'center') onDock?.(liftNode(dock, d.id))
      return
    }
    if (d.kind === 'dockresize') {
      const w = dockWidthLive
      setDockWidthLive(null)
      const n = ws.nodes[d.id]
      if (w && n) { const next = { ...dockWidths, [panelKindOf(n)]: w }; setDockWidths(next); try { localStorage.setItem('palco.dockWidths', JSON.stringify(next)) } catch { /* sem armazenamento: vale só nesta sessão */ } }
      return
    }
    if (d.kind === 'control' || d.kind === 'transform') {
      // Uma transação: redimensionar, girar ou curvar vira um `drawing.patch` por desenho, num nível só do histórico.
      const patches = overridesRef.current
      setOverrides(new Map())
      if (patches.size) void window.palco.history.commit(ws.id, [...patches].map(([id, patch]): HistoryOperation => ({ type: 'drawing.patch', id, patch }))).catch((err: unknown) => console.warn(t('canvas.Canvas.transformacao_recusada'), err))
      return
    }
    if (d.kind === 'draw') {
      const stroke = liveRef.current
      setLive(null)
      clearTimeout(armTimer.current)
      if (!stroke) return
      let final: Omit<Drawing, 'id'> = { ...stroke, points: snapped(d.tool, gesturePoints(d.tool, d.raw, e.shiftKey)) }
      // Desenho inteligente: reconhece ao soltar; sem reconhecer, fica como caneta.
      if (d.tool === 'smart') {
        const r = recognize(d.raw)
        if (r) final = { ...final, tool: r.tool, points: r.points }
      }
      // Linha, seta ou forma sem arrasto (um clique) não vira desenho.
      const [a, b] = [final.points[0]!, final.points[final.points.length - 1]!]
      if (!keepsDrawing(d.tool) && Math.hypot(a.x - b.x, a.y - b.y) < 2) return
      // Uma transação por traço: Ctrl+Z desfaz o último traço confirmado.
      void commitDrawing(window.palco.history, ws.id, final).catch((err: unknown) => console.warn('desenho recusado:', err))
      // Formas com área voltam para Seleção; traço livre, linha e seta continuam armados.
      if (isAreaShape(d.tool)) onTool?.('select')
      return
    }
    const node = ws.nodes[d.id]
    if (!node || node.floorId !== ws.activeFloor) return
    // Clique sem arrasto (selecionar pelo cabeçalho, tocar na alça): não grava nem encaixa na grade.
    const ids = membersOf(d.id)
    const dropFrames = (gone: string[]): void => setFrames(all => Object.fromEntries(Object.entries(all).filter(([id]) => !gone.includes(id))))
    if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < CLICK_SLOP_PX) {
      dropFrames(ids)
      return
    }
    const next = cardFrameAt(d, { x: e.clientX, y: e.clientY }, camRef.current.zoom, minOf(d.id))
    const magnet = d.kind === 'move' && matchesShortcut('tile', { key: '', ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey })
    const frame = d.kind === 'move'
      ? magnet ? { ...next, pos: { x: Math.round(tileSnapped(d, next, e).pos.x), y: Math.round(tileSnapped(d, next, e).pos.y) } } : { ...next, pos: { x: snap(next.pos.x), y: snap(next.pos.y) } }
      : { ...next, size: { w: snap(next.size.w), h: snap(next.size.h) } }
    const patch = d.kind === 'move' ? { pos: frame.pos } : { size: frame.size }
    // Mantém o drop até a confirmação pelo snapshot, sem voltar à posição antiga entre IPCs.
    setFrames(all => ({ ...all, ...Object.fromEntries(ids.map((id) => [id, frame])) }))
    const tokens = new Map<string, symbol>()
    for (const id of ids) {
      const token = Symbol(id)
      tokens.set(id, token)
      clearPendingFrame(id)
      const timer = setTimeout(() => {
        if (pendingFrames.current.get(id)?.token !== token) return
        clearPendingFrame(id)
        dropFrames([id])
      }, 2000)
      pendingFrames.current.set(id, { frame, kind: d.kind, token, timer })
    }
    const commit = window.palco.history.commit(ws.id, ids.map(id => ({ type: 'node.patch', id, patch })))
    void commit.catch(() => {
      for (const id of ids) {
        if (pendingFrames.current.get(id)?.token !== tokens.get(id)) continue
        clearPendingFrame(id)
        dropFrames([id])
        console.warn(t('canvas.Canvas.nao_foi_possivel_salvar_a_posi'))
      }
    })
  }

  /** Duplo clique num arquivo da árvore: abre um nó arquivo ao lado dela. */
  const openFileNear = (tree: CanvasNode, path: string): void => {
    const name = path.split('/').pop() || path
    void window.palco.node.add({
      kind: 'file', floorId: tree.floorId, name, path,
      pos: { x: snap(tree.pos.x + tree.size.w + 40), y: snap(tree.pos.y) }, size: { w: 520, h: 420 }
    }).catch((err: unknown) => console.warn('arquivo recusado:', err))
  }

  const failed = (title: string) => (err: unknown): void => { if (onFail) onFail(title, err); else console.warn(title, err) }
  const addAndSelect = async (node: Parameters<typeof window.palco.node.add>[0]): Promise<void> => { onSelectMany?.([await window.palco.node.add(node)]) }
  const nodeNames = (): string[] => Object.values(ws.nodes).map((n) => n.name)

  /** Um preset do submenu Terminal: cria na hora, sem diálogo, no ponto do clique. */
  const createFromPreset = async (tile: QuickTile, at: Vec): Promise<void> => {
    const accounts = tile.preset?.account ? (await window.palco.accounts?.list()) ?? [] : []
    const form = { ...emptyForm(), ...quickTileForm(tile, accounts) }
    await addAndSelect(toNewNode(form, placementFrame(at, at, 'terminal', 20, prefs), ws.activeFloor, nodeNames()))
  }

  /** Colar no ponto: os elementos copiados; senão os arquivos, a imagem ou o endereço da área de transferência do sistema. */
  /** `repeats`: pelo teclado, cada colagem dos mesmos elementos desce um degrau. */
  const pasteAt = async (at: Vec, repeats = false): Promise<void> => {
    const system = (await window.palco.clipboard?.read()) ?? { text: '', files: [], image: false }
    const source = decidePaste(system, elementClipboard.get())
    if (source.kind === 'elements') {
      const { data } = source.clip
      commitGroup(pasteOperations(data, pasteOffset(data.box, at, repeats ? source.clip.pastes ?? 0 : 0), nodeNames(), ws.activeFloor), true)
      if (repeats) source.clip.pastes = (source.clip.pastes ?? 0) + 1
    } else if (source.kind === 'url') {
      const card = linkNode(source.url, at, ws.activeFloor, nodeNames())
      if (card) await addAndSelect(card)
    } else if (source.kind === 'files' || source.kind === 'image') {
      const saved = source.kind === 'image' ? await window.palco.clipboard.saveImage() : null
      const paths = source.kind === 'files' ? source.files : saved ? [saved] : []
      const infos = await Promise.all(paths.map(async (path) => {
        const k = await window.palco.files.kindOf(path).catch(() => null)
        const text = k?.note ? await window.palco.files.noteText(path).catch(() => null) : null
        return { path, kind: k?.kind ?? null, note: k?.note === true && text != null, text }
      }))
      const copies: Record<string, string> = {}
      if (prefs.alwaysCopyAttachments) for (const i of infos) if (i.kind === 'file' && !i.note) copies[i.path] = await window.palco.files.storeAttachment(i.path)
      for (const node of nodesForDrop(infos, at, prefs, ws.activeFloor, copies)) await addAndSelect(node)
    }
  }

  const scoreItem = (state: MenuState, payload: string[]) => scoresMenu({ hasPayload: payload.length > 0, hasSaved: state.hasSavedScore, run: (action) => onPartitura?.(action, action === 'open' ? [] : payload) })

  /** Dispara uma ação do menu e leva o erro dela para a tela. */
  const act = (run: () => unknown): void => { void (async () => { await run() })().catch(failed(t('ctx.nao_foi_possivel'))) }
  const confirm = (ask: Parameters<NonNullable<Props['onConfirm']>>[0]): void => { onConfirm?.(ask) }
  const webviewOf = (id: string): (Element & { reload?(): void }) | null => root.current?.querySelector(`[data-node-id="${CSS.escape(id)}"] webview`) ?? null

  const pasteIntoTerminal = async (id: string): Promise<void> => {
    const system = await window.palco.clipboard.read()
    const saved = system.image && !system.files.length ? await window.palco.clipboard.saveImage() : null
    const paths = system.files.length ? system.files : saved ? [saved] : []
    const text = paths.length ? `${paths.map(quotePath).join(' ')} ` : system.text
    if (text) terminalHandle(id)?.paste(text)
    terminalHandle(id)?.focus()
  }

  /** Alinhar e organizar a seleção (nós e desenhos): o que está bloqueado não se move. Um nível só de desfazer. */
  const arrange = (nodeIds: string[], drawingIds: string[], next: (frames: Array<{ id: string; pos: Vec; size: Size }>) => Array<{ id: string; pos: Vec }>): void => {
    const nodes = movableNodeIds(ws, nodeIds).map((id) => ({ id, pos: ws.nodes[id]!.pos, size: ws.nodes[id]!.size }))
    const drawings = (ws.drawings ?? []).filter((d) => drawingIds.includes(d.id) && !d.locked).map((d) => { const b = drawingBox(d); return { id: d.id, pos: { x: b.x, y: b.y }, size: { w: b.w, h: b.h } } })
    const from = new Map([...nodes, ...drawings].map((f) => [f.id, f.pos]))
    const ops = next([...nodes, ...drawings]).flatMap((p): HistoryOperation[] => {
      const old = from.get(p.id)!, dx = p.pos.x - old.x, dy = p.pos.y - old.y
      if (!dx && !dy) return []
      const d = ws.drawings?.find((x) => x.id === p.id)
      if (!d) return [{ type: 'node.patch', id: p.id, patch: { pos: p.pos } }]
      const shift = (v: Vec): Vec => ({ x: v.x + dx, y: v.y + dy })
      return [{ type: 'drawing.patch', id: d.id, patch: { points: d.points.map(shift), ...(d.control ? { control: shift(d.control) } : {}) } }]
    })
    commitGroup(ops, false)
  }

  const duplicate = (nodeIds: string[], drawingIds: string[]): void =>
    commitGroup(pasteOperations(captureSelection(ws, nodeIds, drawingIds), DUPLICATE_OFFSET, nodeNames(), ws.activeFloor), true)

  const groupAct = (run: () => Promise<unknown>): void => { void run().catch(failed(t('groups.failed'))) }
  /** Agrupar abre o nome só quando nasce um grupo novo (somar a um que já existe não). */
  const createGroup = (ids: string[]): void => groupAct(async () => { const id = await window.palco.group.create(ids); if (id && !ws.groups?.[id]) setRenamingGroup(id) })
  /** Arrastar o cabeçalho leva os membros destravados juntos, num nível só de desfazer (o mesmo arrasto da seleção). */
  const dragGroup = (id: string, e: ReactPointerEvent): void => {
    if (e.button !== 0 || linkFrom) return
    const ids = movableNodeIds(ws, floorGroups(ws, ws.activeFloor).find((g) => g.id === id)?.members.map((m) => m.id) ?? [])
    if (!ids.length) return
    const origins = Object.fromEntries(ids.map((m) => { const n = ws.nodes[m]!; return [m, frames[m] ?? { pos: n.pos, size: n.size }] }))
    begin(e, { kind: 'group', start: { x: e.clientX, y: e.clientY }, ids, drawings: [], origins, alt: e.altKey })
  }
  const groupEntries = (state: MenuState, id: string): MenuEntry[] => {
    const found = floorGroups(ws, ws.activeFloor).find((g) => g.id === id)
    if (!found) return []
    const ids = found.members.map((m) => m.id)
    return groupMenu(found.group, {
      rename: () => setRenamingGroup(id),
      copy: () => { elementClipboard.set(captureSelection(ws, ids, [])) },
      color: (color) => groupAct(() => window.palco.group.color(id, color)),
      scores: scoreItem(state, ids),
      ungroup: () => groupAct(() => window.palco.group.ungroup(ids))
    })
  }

  /** Abre o endereço no navegador do sistema, ou num portal à direita do cartão. */
  const openLink = (node: LinkNode, inPortal: boolean): void => {
    if (!inPortal) return act(() => window.palco.shell.openExternal(node.url))
    act(() => addAndSelect({ kind: 'portal', floorId: node.floorId, name: uniquePortalName('', nodeNames()), url: node.url, storage: prefs.defaultPortalStorage, pos: { x: node.pos.x + node.size.w + 20, y: node.pos.y }, size: { w: Math.max(800, node.size.w), h: Math.max(600, node.size.h) } }))
  }

  const nodeEntries = (state: MenuState, node: CanvasNode): MenuEntry[] => {
    const id = node.id, inSelection = selection.has(id)
    const selected = selectedNodeIds(), selectedInk = inSelection ? [...selectedDrawings] : []
    // A banda não é um card: copiar, duplicar e apagar valem para os membros dela.
    const own = node.kind === 'band' ? node.members.filter((m) => ws.nodes[m]) : membersOf(id)
    /** Recarregar, descarregar, desfocar e apagar valem para a seleção inteira quando o clicado está nela. */
    const scope = inSelection ? selected : [id]
    const kindsIn = (ids: string[], kinds: Array<CanvasNode['kind']>): string[] => ids.filter((x) => kinds.includes(ws.nodes[x]?.kind as CanvasNode['kind']))
    const patch = (change: Record<string, unknown>): void => act(() => window.palco.node.patch(id, change))
    const reloadOne = (target: string): unknown => {
      const n = ws.nodes[target]
      if (n?.kind === 'terminal') return window.palco.terminal.restart(target)
      if (n?.kind !== 'portal') return
      if (n.unloaded) return window.palco.nodeState.wake(target)
      webviewOf(target)?.reload?.()
    }
    const count = selected.length + selectedInk.length
    const toGroup = inSelection ? kindsIn(selected, ['terminal', 'note', 'portal', 'text', 'file', 'filetree', 'link']) : []
    const grouped = scope.filter((x) => ws.nodes[x]?.groupId !== undefined)
    const inBand = new Set(Object.values(ws.nodes).flatMap((n) => (n.kind === 'band' ? n.members : [])))
    const bandable = kindsIn(selected, ['terminal']).filter((x) => !inBand.has(x))
    const loose = selected.filter((x) => { const n = ws.nodes[x]; return n?.kind === 'note' && !n.stackId })
    const removed = inSelection ? selected : own
    // A trava: o clicado bloqueado (ou o fichário/banda que o contém) deixa Apagar desabilitado.
    const bandHeld = node.kind === 'band' && (node.positionLocked === true || own.some((m) => ws.nodes[m]?.positionLocked))
    const canRemove = !bandHeld && !node.positionLocked && deleteOperations(ws, node.kind === 'band' ? [id] : own, []).length > 0
    return elementMenu(node, ws, prefs, {
      rename: () => setRenaming(id),
      copyElement: () => { elementClipboard.set(captureSelection(ws, own, [])) },
      duplicate: () => duplicate(own, []),
      scores: scoreItem(state, node.kind === 'band' ? [id, ...own] : inSelection ? selected : own),
      toggleLock: () => { const positionLocked = node.positionLocked !== true; for (const m of node.kind === 'band' ? [id] : own) act(() => window.palco.node.patch(m, { positionLocked })) },
      canRemove,
      remove: () => { commitGroup(deleteOperations(ws, removed, []), false); if (inSelection) { onSelectOnly?.(null); setSelectedDrawings(new Set()) } },
      patch,
      savePreferences: (change) => act(() => window.palco.preferences.set(change)),
      reload: () => { for (const target of scope) act(() => reloadOne(target)) },
      unload: () => act(() => window.palco.nodeState.unload(kindsIn(scope, ['terminal', 'portal']))),
      toggleRedaction: () => {
        const on = !((node.kind === 'terminal' || node.kind === 'note') && node.redacted)
        commitGroup(kindsIn(scope, ['terminal', 'note']).map((x) => ({ type: 'node.patch', id: x, patch: { redacted: on } })), false)
      },
      terminal: {
        selection: state.termSelection,
        copy: () => act(() => window.palco.clipboard.writeText(state.termSelection)),
        paste: () => act(() => pasteIntoTerminal(id)),
        selectAll: () => terminalHandle(id)?.selectAll(),
        edit: () => onEditTerminal?.(id),
        joinBand: (band) => act(() => window.palco.band.add(band, id)),
        clearChat: () => confirm({ title: t('ctx.limpar_historico_pergunta', { name: node.name }), body: t('ctx.limpar_historico_detalhe'), confirmLabel: t('ctx.limpar'), danger: true, onConfirm: () => act(() => window.palco.chat.clearHistory(id)) })
      },
      // O que está no editor ainda pode não ter sido gravado: vale o texto da tela.
      copyContents: () => act(() => window.palco.clipboard.writeText(root.current?.querySelector<HTMLTextAreaElement>(`[data-node-id="${CSS.escape(id)}"] .note-text`)?.value ?? (node.kind === 'note' ? node.content : ''))),
      // A bloqueada fica onde está (no lugar do fichário); as livres descem em fila a partir da vaga seguinte.
      unstack: () => {
        let slot = own.some((m) => ws.nodes[m]?.positionLocked) ? 1 : 0
        commitGroup(own.map((m): HistoryOperation => ({ type: 'node.patch', id: m, patch: ws.nodes[m]?.positionLocked ? { stackId: null } : { stackId: null, pos: { x: node.pos.x + slot++ * (node.size.w + 40), y: node.pos.y } } })), false)
      },
      unfile: () => { const out = unfileNote(ws, id); if (out) patch(out.patch as Record<string, unknown>) },
      portal: {
        edit: () => onEditPortal?.(id),
        reload: () => { for (const target of scope) act(() => reloadOne(target)) },
        setStorage: (storage) => patch({ storage }),
        clearStorage: () => confirm({ title: t('ctx.limpar_armazenamento_pergunta', { name: node.name }), body: t('ctx.limpar_armazenamento_detalhe'), confirmLabel: t('ctx.limpar'), danger: true, onConfirm: () => act(async () => { await window.palco.nodeState.clearPortalStorage(id); webviewOf(id)?.reload?.() }) }),
        screenshot: () => act(async () => { if (!await window.palco.nodeState.copyScreenshot(id)) throw new Error(t('ctx.nao_foi_possivel_capturar')) }),
        openExternal: () => act(() => window.palco.shell.openExternal(node.kind === 'portal' ? node.url : ''))
      },
      moveNoteOut: () => void window.palco.noteFile.moveOut(id).catch(failed(t('ctx.nao_foi_possivel_mudar_o_arquivo'))),
      unlinkNote: () => void window.palco.noteFile.unlink(id).catch(failed(t('ctx.nao_foi_possivel_mudar_o_arquivo'))),
      reveal: () => act(() => window.palco.nodeState.reveal(id)),
      link: {
        open: () => { if (node.kind === 'link') openLink(node, false) },
        openInPortal: () => { if (node.kind === 'link') openLink(node, true) },
        copyUrl: () => act(() => window.palco.clipboard.writeText(node.kind === 'link' ? node.url : ''))
      },
      resetToRoot: () => { if (node.kind === 'filetree') act(() => window.palco.node.patch(id, { current: node.root })) },
      renameStack: () => { if (node.kind === 'note' && node.stackId) setRenamingStack(node.stackId) },
      openFile: () => act(async () => { if (await window.palco.nodeState.open(id) === 'revealed') onNotice?.(t('ctx.mostrado_na_pasta')) }),
      copyFile: () => act(async () => { if (!await window.palco.nodeState.copyFile(id)) throw new Error(t('ctx.nao_foi_possivel_copiar_arquivo')) }),
      band: {
        allUnloaded: node.kind === 'band' && own.every((m) => { const n = ws.nodes[m]; return n?.kind === 'terminal' && n.unloaded === true }),
        loadAll: () => {
          const all = own.every((m) => { const n = ws.nodes[m]; return n?.kind === 'terminal' && n.unloaded === true })
          if (all) for (const m of own) act(() => window.palco.terminal.restart(m))
          else act(() => window.palco.nodeState.unload(own))
        },
        dissolve: () => act(() => window.palco.band.dissolve(id)),
        remove: () => confirm({ title: t('ctx.apagar_banda_pergunta', { name: node.name, count: own.length }), body: t('ctx.apagar_banda_detalhe'), confirmLabel: t('ctx.apagar_banda'), danger: true, onConfirm: () => commitGroup(deleteOperations(ws, [id, ...own], []), false) })
      },
      ...(toGroup.length >= 2 && node.kind !== 'band' ? { group: () => createGroup(toGroup) } : {}),
      ...(grouped.length ? { ungroup: () => groupAct(() => window.palco.group.ungroup(grouped)) } : {}),
      ...(inSelection && count >= 2 && node.kind !== 'band' ? {
        multi: {
          count,
          ...(movableNodeIds(ws, selected).length >= 2 ? { tidy: () => arrange(selected, [], (frames) => tidyFrames(frames, 'grid')) } : {}),
          align: (action: AlignId) => arrange(selected, selectedInk, (frames) => alignFrames(action, frames)),
          ...(bandable.length >= 2 ? { createBand: () => onCreateBand?.(bandable) } : {}),
          ...(loose.length >= 2 ? { file: () => commitGroup(fileNotes(ws, loose, `f-${crypto.randomUUID()}`).map((p) => ({ type: 'node.patch', id: p.id, patch: p.patch })), false) } : {})
        }
      } : {})
    }, node.kind === 'note' && own.length >= 2)
  }

  const drawingEntries = (id: string): MenuEntry[] => {
    const inSelection = selectedDrawings.has(id), ids = inSelection ? [...selectedDrawings] : [id]
    const nodeIds = inSelection ? selectedNodeIds() : []
    // Na ordem da pilha: assim o grupo mantém quem está por cima de quem.
    const targets = (ws.drawings ?? []).filter((d) => ids.includes(d.id))
    const patchAll = (list: typeof targets, patch: DrawingPatch): void => commitGroup(list.map((d) => ({ type: 'drawing.patch', id: d.id, patch })), false)
    return drawingMenu(targets, {
      count: targets.length + nodeIds.length,
      align: (action) => arrange(nodeIds, ids, (frames) => alignFrames(action, frames)),
      front: () => patchAll(targets, { order: 'front' }),
      back: () => patchAll([...targets].reverse(), { order: 'back' }),
      toggleLock: () => patchAll(targets, { locked: !targets.some((d) => d.locked) }),
      duplicate: () => duplicate([], ids),
      remove: () => { commitGroup(deleteOperations(ws, [], ids), false); setSelectedDrawings(new Set()) }
    })
  }

  const menuEntries = (state: MenuState): MenuEntry[] => {
    const { target } = state
    if (target.kind === 'node') { const node = ws.nodes[target.id]; return node ? nodeEntries(state, node) : [] }
    if (target.kind === 'drawing') return drawingEntries(target.id)
    if (target.kind === 'group') return groupEntries(state, target.id)
    return canvasMenu({
      presets: state.presets,
      place: (kind) => onPlace?.(kind, placementFrame(state.world, state.world, kind, 20, prefs)),
      preset: (tile) => void createFromPreset(tile, state.world).catch(failed(t('ctx.nao_foi_possivel_criar'))),
      paste: () => void pasteAt(state.world).catch(failed(t('ctx.nao_foi_possivel_colar'))),
      scores: scoreItem(state, selectedNodeIds())
    })
  }
  const menuLabel = (target: MenuTarget): string => t(target.kind === 'node' ? 'ctx.menu_do_elemento' : target.kind === 'drawing' ? 'ctx.menu_do_desenho' : target.kind === 'group' ? 'ctx.menu_do_grupo' : 'ctx.menu_do_canvas')

  const openContextMenu = (e: { target: EventTarget; clientX: number; clientY: number; preventDefault(): void }): void => {
    if (linkFrom) return
    const el = e.target as Element
    // Campos de texto ficam com o menu do próprio sistema; a nota e o terminal (o xterm põe o textarea dele sob o ponteiro) são elementos.
    if (el.closest('input, [contenteditable="true"], textarea:not(.note-text):not(.xterm-helper-textarea), .composer, [role="dialog"], .rope-popover, .tree-row')) return
    const nodeId = el.closest('[data-node-id]')?.getAttribute('data-node-id'), drawingId = el.closest('[data-drawing-id]')?.getAttribute('data-drawing-id')
    const groupId = el.closest('[data-group-id]')?.getAttribute('data-group-id')
    const target: MenuTarget = groupId ? { kind: 'group', id: groupId } : nodeId && ws.nodes[nodeId] ? { kind: 'node', id: nodeId } : drawingId ? { kind: 'drawing', id: drawingId } : { kind: 'canvas' }
    e.preventDefault()
    cancelRef.current(); closeRopeMenu()
    const state: MenuState = { target, at: { x: e.clientX, y: e.clientY }, world: screenToWorld(localPoint(e), camRef.current), presets: quickStartTiles([]), hasSavedScore: false, termSelection: target.kind === 'node' ? terminalHandle(target.id)?.selection() ?? '' : '' }
    setCtxMenu(state)
    const update = (patch: Partial<MenuState>): void => setCtxMenu((now) => (now && now.at === state.at ? { ...now, ...patch } : now))
    void window.palco.presets?.list().then((list) => update({ presets: quickStartTiles(list) })).catch(() => {})
    void window.palco.partitura?.list().then((list) => update({ hasSavedScore: list.length > 0 })).catch(() => {})
  }

  // Só o floor ativo é desenhado; a banda não é uma caixa: a moldura sai dos membros (inclusive durante o arrasto).
  const onFloor = nodesOnFloor(ws)
  // Fichário: só a nota da frente aparece (com as abas); as outras compartilham o frame dela.
  const stacks = stackView(onFloor.filter((n) => n.kind !== 'band'), stackFront)
  const nodes = onFloor.filter((n) => n.kind !== 'band' && !stacks.hidden.has(n.id))
  const bands = onFloor.flatMap((n) => (n.kind === 'band' ? [n] : []))
  const bandFrames: Frames = {}
  for (const band of bands) {
    const members = band.members.flatMap((id) => {
      const m = ws.nodes[id]
      return m ? [frames[id] ?? { pos: m.pos, size: m.size }] : []
    })
    const f = bandFrame(members)
    if (f) bandFrames[band.id] = f
  }
  const connections = visibleConnections(ws).filter((c) => (ws.nodes[c.a]?.kind !== 'band' || bandFrames[c.a]) && (ws.nodes[c.b]?.kind !== 'band' || bandFrames[c.b]))

  return (
    <div
      ref={root}
      className={`canvas${liftedId && ws.nodes[liftedId] ? ' lift-on' : ''}${linkFrom ? ' linking' : ''}${tool === 'draw' || placing ? ' drawing-mode' : ''}${panHeld || panToggle ? ' pan-mode' : ''}`}
      style={{ backgroundPosition: `${camera.offset.x}px ${camera.offset.y}px`, backgroundSize: `${20 * camera.zoom}px ${20 * camera.zoom}px`, ...(glideMs ? { transition: `background-position ${glideMs}ms ease-out` } : {}) }}
      tabIndex={0}
      onContextMenu={openContextMenu}
      onPointerDownCapture={(e) => {
        // Moving/selecting a card gives the canvas keyboard ownership; editors keep their focus.
        if (ownsHistoryFocus(root.current!, e.target)) root.current?.focus({ preventScroll: true })
        // Com a tecla de pan segurada o arrasto move a vista mesmo sobre desenho ou corda; em card, o clique é do card.
        // A decisão usa o próprio evento: o Ctrl pode ter sido apertado com o foco num editor.
        const mods = { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey }
        if (!linkFrom && e.button === 0 && (matchesShortcut('panHold', { key: '', ...mods }) || [...heldPanKeys.current.values()].some(h => matchesShortcut('panHold', { ...h, ...mods }))) && isPanSurface(e.target, e.currentTarget)) {
          begin(e, { kind: 'pan', start: { x: e.clientX, y: e.clientY }, offset: camera.offset, click: { onRoot: e.target === e.currentTarget } })
          return
        }
        if (!linkFrom || e.button !== 0) return
        e.preventDefault(); e.stopPropagation()
        const target = (e.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id')
        onLink(target && ws.nodes[target] ? target : linkFrom)
      }}
      onPointerDown={(e) => {
        // O botão direito é do menu (e do arrasto dele, em right-drag.ts): não limpa seleção, não desenha e não recolhe nada.
        if (e.button === 2) return
        // Clicar no fundo recolhe o elemento elevado.
        if (liftedId && e.target === e.currentTarget) { onDock?.(dismissLift(dock)); return }
        onSelectConn(null)
        if (placing && e.button === 0) {
          gesture.current.prefs = prefs
          gesture.current.begin(tool, screenToWorld(localPoint(e), camera))
          setPlacePreview(gesture.current.preview)
          begin(e, { kind: 'place' })
          return
        }
        if (tool === 'draw' && e.button === 0) {
          const p = screenToWorld(localPoint(e), camera)
          const t = drawStyle.tool
          setLive({ floorId: ws.activeFloor, points: [p], color: drawStyle.color, width: drawStyle.width, tool: kindOf(t), ...styleFields(drawStyle) })
          clearTimeout(armTimer.current)
          begin(e, { kind: 'draw', last: { x: e.clientX, y: e.clientY }, tool: t, raw: [p] })
          return
        }
        // Fundo: botão do meio ou o pan ligado (H) arrastam a vista; o esquerdo faz o laço. (A tecla segurada é tratada na captura.)
        if (e.button === 1 || panToggle || linkFrom) {
          begin(e, { kind: 'pan', start: { x: e.clientX, y: e.clientY }, offset: camera.offset, ...(e.button === 0 && panToggle ? { click: { onRoot: e.target === e.currentTarget } } : {}) })
          return
        }
        if (e.button !== 0) return
        begin(e, { kind: 'lasso', start: screenToWorld(localPoint(e), camera), startScreen: { x: e.clientX, y: e.clientY }, additive: e.shiftKey })
      }}
      onPointerOver={(e) => {
        // Focar ao passar o cursor: foca o campo do nó sob o ponteiro, sem interromper arrasto, ligação, edição ou diálogo.
        const el = (e.target as Element).closest?.('[data-node-id]'), active = document.activeElement
        if (!el || !root.current) return
        const editable = isEditingElsewhere(active, el)
        if (!shouldHoverFocus({ enabled: prefs.focusNodeOnHover, dragging: drag.current !== null, linking: linkFrom !== null, editing: editable, dialogOpen: Boolean(document.querySelector('dialog[open], .settings-dialog')), alreadyFocused: el.contains(active) })) return
        el.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: true })
      }}
      onDragOver={(e) => { if (onDropFiles && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={(e) => {
        const files = [...(e.dataTransfer?.files ?? [])]
        if (!onDropFiles || !files.length) return
        e.preventDefault(); onDropFiles(files, screenToWorld(localPoint(e), camRef.current))
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => cancelRef.current()}
    >
      <GroupFrames
        groups={floorGroups(ws, ws.activeFloor).flatMap((g) => {
          const frame = groupFrame(g.members.map((m) => frames[m.id] ?? { pos: m.pos, size: m.size }), camera)
          return frame ? [{ id: g.id, name: g.group.name, ...(g.group.color !== undefined && { color: g.group.color }), frame }] : []
        })}
        renaming={renamingGroup}
        onRenaming={setRenamingGroup}
        onRename={(id, name) => groupAct(() => window.palco.group.rename(id, name))}
        onHeaderDown={dragGroup}
      />
      <div
        className="world"
        style={{ transform: `translate(${camera.offset.x}px, ${camera.offset.y}px) scale(${camera.zoom})`, ...(glideMs ? { transition: `transform ${glideMs}ms ease-out` } : {}) }}
      >
        {bands.map((band) =>
          bandFrames[band.id] ? (
            <div key={band.id} data-node-id={band.id} style={{ display: 'contents' }}><BandFrame band={band} frame={bandFrames[band.id]!} linking={linkFrom !== null} isLinkSource={linkFrom === band.id} onLink={onLink} renaming={renaming === band.id} onRename={setRenaming} /></div>
          ) : null
        )}
        <Connections
          nodes={ws.nodes}
          connections={connections}
          frames={{ ...frames, ...bandFrames }}
          selected={selectedConn}
          onSelect={onSelectConn}
          onRopeMenu={tool === 'select' && !linkFrom ? (ids, at) => setRopeMenu({ ids, at }) : undefined}
          highlighted={ropeLit}
          linkFrom={linkFrom}
          viewport={root}
          camera={camera}
          zoom={camera.zoom}
        />
        <span role="status" aria-live="polite" className="sr-only">{ropeStatus}</span>
        {ropeMenu && <RopePopover ws={ws} ropeIds={ropeMenu.ids} at={ropeMenu.at} onClose={closeRopeMenu} onHighlight={setRopeLit} onStatus={setRopeStatus} onFocus={(id, floor) => onFocusNode?.(id, floor)} />}
        {nodes.map((n) => (
          <NodeFrame
            key={n.id}
            node={n}
            frame={(() => { const p = panelRect(n); if (!p) return frames[n.id] ?? { pos: n.pos, size: n.size }; const f = liftFrame(p.rect, camera), off = panelDrag?.id === n.id ? panelDrag : null; return off ? { ...f, pos: { x: f.pos.x + off.dx / camera.zoom, y: f.pos.y + off.dy / camera.zoom } } : f })()}
            completed={completed.has(n.id)}
            lifted={panelRect(n)?.mode === 'lift'}
            docked={panelRect(n)?.mode === 'dock' ? dock.edge : undefined}
            onUnlift={() => onDock?.(dock.liftedId === n.id ? dismissLift(dock) : { ...dock, dockedId: null })}
            linking={linkFrom !== null}
            isLinkSource={linkFrom === n.id}
            selected={selection.has(n.id)}
            peers={crossFloorPeers(ws, n.id)}
            remotePeers={crossWorkspacePeers(crossLinks, n.id)}
            workspaceId={ws.id}
            onCutRemote={window.palco?.links?.remove ? cutRemote : undefined}
            onGoToFloor={onGoToFloor}
            onToggleSelect={(id) => { bodySelected.current = null; onToggleSelect(id) }}
            onBodyFocus={() => {
              if (linkFrom) { onLink(n.id); return }
              bodySelected.current = n.id
              if (!selection.has(n.id)) onSelectOnly?.(n.id)
            }}
            onHeaderFocus={() => { bodySelected.current = null }}
            onSelectOnly={(id) => onSelectOnly?.(id)}
            renaming={renaming === n.id}
            onRename={setRenaming}
            sizeReadout={n.kind === 'portal' && (prefs.portalSizeReadout === 'always' || (prefs.portalSizeReadout === 'onResize' && drag.current?.kind === 'resize' && drag.current.id === n.id))}
            onUnredact={() => commitGroup([{ type: 'node.patch', id: n.id, patch: { redacted: false } }], false)}
            onLink={onLink}
            onHeaderDown={(e) => {
              if (panelRect(n)) { begin(e, { kind: 'panel', id: n.id, start: { x: e.clientX, y: e.clientY } }); return }
              // Card de uma seleção maior (ou Alt): arrasta a seleção inteira; Alt solta cópias.
              const own = membersOf(n.id), inSel = selection.has(n.id)
              const ids = inSel ? selectedNodeIds() : own, drawings = inSel ? [...selectedDrawings] : []
              // Nota travada não se move sozinha; numa seleção maior ela fica e o resto vai.
              if (!e.altKey && ids.length + drawings.length <= own.length && (own.every((id) => ws.nodes[id] && isLockedNode(ws.nodes[id]!)) || isHeld(ws.nodes, n))) return
              if (e.altKey || ids.length + drawings.length > own.length) {
                const origins = Object.fromEntries(ids.flatMap((id) => { const m = ws.nodes[id]; return m ? [[id, frames[id] ?? { pos: m.pos, size: m.size }]] : [] }))
                begin(e, { kind: 'group', start: { x: e.clientX, y: e.clientY }, ids, drawings, origins, alt: e.altKey })
                return
              }
              begin(e, { kind: 'move', id: n.id, start: { x: e.clientX, y: e.clientY }, frame: frames[n.id] ?? { pos: n.pos, size: n.size } })
            }}
            held={isHeld(ws.nodes, n)}
            onResizeDown={(e) => { const p = panelRect(n); if (!p && isHeld(ws.nodes, n)) return; if (p) { if (p.mode === 'dock') begin(e, { kind: 'dockresize', id: n.id, start: { x: e.clientX, y: e.clientY }, width: p.rect.w, edge: dock.edge }); return } begin(e, { kind: 'resize', id: n.id, start: { x: e.clientX, y: e.clientY }, frame: frames[n.id] ?? { pos: n.pos, size: n.size } }) }}
            onOpenFile={(path) => openFileNear(n, path)}
            onOpenLink={(inPortal) => { if (n.kind === 'link') openLink(n, inPortal) }}
            tabs={stacks.tabs.get(n.id)}
            stack={n.kind === 'note' && n.stackId && stacks.tabs.has(n.id) ? {
              name: ws.stackNames?.[n.stackId], renaming: renamingStack === n.stackId, start: () => setRenamingStack(n.stackId!),
              done: (next) => { setRenamingStack(null); if (next !== null && next !== (ws.stackNames?.[n.stackId!] ?? '')) void window.palco.stack.rename(n.stackId!, next || null).catch(failed(t('ctx.nao_foi_possivel_renomear_fichario'))) }
            } : undefined}
            onTab={(id) => {
              const stack = ws.nodes[id]
              if (stack?.kind === 'note' && stack.stackId) setStackFront((prev) => ({ ...prev, [stack.stackId!]: id }))
              onSelectOnly?.(id)
            }}
          />
        ))}
        <Drawings
          drawings={(ws.drawings ?? []).filter((d) => d.floorId === ws.activeFloor)}
          live={live}
          selected={selectedDrawings}
          shift={groupShift}
          interactive={tool === 'select' && !linkFrom}
          overrides={overrides}
          zoom={camera.zoom}
          onTransformStart={(target, e) => begin(e, { kind: 'transform', target, start: { x: e.clientX, y: e.clientY }, startLocal: localPoint(e) })}
          editingTextId={editingText?.id ?? null}
          onEditText={(id) => { const d = (ws.drawings ?? []).find((x) => x.id === id); if (d && d.tool && isAreaShape(d.tool)) { setSelectedDrawings(new Set([id])); setEditingText({ id, value: d.text ?? '' }) } }}
          onControlStart={(id, e) => begin(e, { kind: 'control', id })}
          onSelect={(id, additive) => {
            if (additive) setSelectedDrawings((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
            else { setSelectedDrawings(new Set([id])); onSelectOnly?.(null) }
          }}
        />
        {editingText && (() => {
          const d = (ws.drawings ?? []).find((x) => x.id === editingText.id)
          return d ? <DrawingTextEditor drawing={d} value={editingText.value} onChange={(value) => setEditingText({ id: d.id, value })} onCommit={commitText} /> : null
        })()}
        <PlacementLayer frame={placePreview} />
        {lasso && <div className="lasso" style={{ left: lasso.pos.x, top: lasso.pos.y, width: lasso.size.w, height: lasso.size.h }} />}
      </div>
      {ctxMenu && (() => { const entries = menuEntries(ctxMenu); return entries.length ? <ContextMenu entries={entries} at={ctxMenu.at} label={menuLabel(ctxMenu.target)} onClose={closeCtxMenu} /> : null })()}
      {tool === 'select' && !linkFrom && selectedDrawings.size > 0 && (() => {
        const st = selectionStyle(ws, [...selectedDrawings])
        return st ? (
          <div className="contextual-row draw-selection-row">
            <DrawingSelectionToolbar value={st.value} hasArea={st.hasArea} onlyBrush={st.onlyBrush}
              onChange={(patch) => { const ops = styleOperations(ws, [...selectedDrawings], patch); if (ops.length) void window.palco.history.commit(ws.id, ops).catch((err: unknown) => console.warn('estilo recusado:', err)) }} />
          </div>
        ) : null
      })()}
      {panelDrag?.zone && <div className={`dock-zone ${panelDrag.zone}`} style={panelDrag.zone === 'leading' ? { left: leadingInset } : undefined} />}
      {/* No modo desenho, uma película sobre os nós recebe o traço (terminais não roubam o arrasto). */}
      {!linkFrom && (tool === 'draw' || placing) && <div className="draw-layer" />}
      {showMinimap && view.w > 0 && <Minimap nodes={nodes} camera={camera} view={view} onCamera={onCamera} />}
    </div>
  )
}

interface FrameProps {
  node: CanvasNode
  frame: { pos: Vec; size: { w: number; h: number }; scale?: number }
  /** Elevado ao painel central: do tamanho real da tela, por cima de tudo, sem arrasto nem redimensionamento. */
  /** Turno concluído e ainda não visto: selo ✓ no cabeçalho do card. */
  completed?: boolean
  lifted?: boolean
  /** Encaixado numa borda: painel lateral do tamanho real da tela, que se arrasta pelo cabeçalho e se alarga pela borda de dentro. */
  docked?: DockEdge
  onUnlift?(): void
  linking: boolean
  isLinkSource: boolean
  selected: boolean
  peers: CrossFloorPeer[]
  onGoToFloor(id: FloorId): void
  /** Cordas com nós de outros workspaces (`Nome @ Workspace`). */
  remotePeers?: CrossWorkspacePeer[]
  /** Workspace do nó: a partição do portal em armazenamento Workspace. */
  workspaceId: string
  /** Desfaz uma corda entre workspaces (botão × do chip). */
  onCutRemote?: (linkId: string) => void
  onToggleSelect(id: string): void
  onSelectOnly(id: string): void
  onBodyFocus(): void
  onHeaderFocus(): void
  renaming: boolean
  onRename(id: string | null): void
  /** Preso no lugar (bloqueado, ou fichário com um bloqueado): sem alça de redimensionar. */
  held?: boolean
  /** Mostra "largura × altura" sobre o portal (Mostrar Tamanho). */
  sizeReadout?: boolean
  onUnredact?(): void
  onLink(id: string): void
  onHeaderDown(e: ReactPointerEvent): void
  onResizeDown(e: ReactPointerEvent): void
  onOpenFile(path: string): void
  /** Abas do fichário (só na nota da frente). */
  onOpenLink?(inPortal: boolean): void
  tabs?: StackTab[]
  /** Nome do fichário na frente: mostrado junto das abas e renomeado por duplo clique ou pelo menu. */
  stack?: { name?: string; renaming: boolean; start(): void; done(next: string | null): void }
  onTab?(id: string): void
}

function NodeFrame({ node, frame, completed = false, lifted = false, docked, onUnlift, linking, isLinkSource, selected, peers, remotePeers = [], onCutRemote, workspaceId, onGoToFloor, onToggleSelect, onSelectOnly, onBodyFocus, onHeaderFocus, renaming, onRename, onLink, onHeaderDown, onResizeDown, onOpenFile, tabs, stack, onOpenLink, onTab, sizeReadout = false, onUnredact, held = false }: FrameProps) {
  const kindClass = node.kind === 'terminal' ? node.agent : node.kind
  return (
    <div
      data-node-id={node.id}
      className={`node ${kindClass}${lifted ? ' lifted' : ''}${docked ? ' lifted docked' : ''}${selected ? ' selected' : ''}${isLinkSource ? ' link-source' : ''}${linking && !isLinkSource ? ' link-target' : ''}`}
      style={{ left: frame.pos.x, top: frame.pos.y, width: frame.size.w, height: frame.size.h, ...(frame.scale ? { transform: `scale(${frame.scale})`, transformOrigin: '0 0' } : {}), ...(node.kind === 'note' ? paperVars(node.color) : {}) }}
      onPointerDownCapture={(e) => {
        if (e.button === 2 || linking || e.shiftKey) return
        const header = e.target instanceof Element && e.target.closest('.node-header')
        if (header) {
          onHeaderFocus()
          if (!selected) onSelectOnly(node.id)
        } else onBodyFocus()
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (e.button === 2) return
        if (linking && !isLinkSource) onLink(node.id)
        else if (!linking && !e.shiftKey && !selected) onSelectOnly(node.id)
      }}
    >
      {tabs && (
        <div className="note-tabs" role="tablist" aria-label={t('canvas.Canvas.notas_do_fichario')} onPointerDown={(e) => e.stopPropagation()}>
          {stack && (stack.renaming
            ? <StackRename name={stack.name ?? ''} onDone={stack.done} />
            : stack.name !== undefined && <span className="stack-name" title={stack.name} onDoubleClick={(e) => { e.stopPropagation(); stack.start() }}>{stack.name}</span>)}
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.active} className={`note-tab${t.active ? ' active' : ''}`} title={t.name} onClick={() => onTab?.(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div
        className="node-header"
        onDoubleClick={node.kind === 'link' ? (e) => { e.stopPropagation(); onOpenLink?.(e.shiftKey) } : undefined}
        onPointerDown={(e) => {
          if (linking || e.button === 2) return
          // Shift+clique soma/tira o nó da seleção (para agrupar em banda) em vez de arrastar.
          if (e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            onToggleSelect(node.id)
            return
          }
          if (!selected) onSelectOnly(node.id)
          onHeaderDown(e)
        }}
      >
        {/* O cartão de link é só o cabeçalho: ele inteiro arrasta e abre. */}
        {node.kind === 'link' ? <LinkCard node={node} onOpen={(inPortal) => onOpenLink?.(inPortal)} /> : <>
        {node.kind === 'terminal' && node.icon
          ? <span className="node-icon" style={{ color: node.color }}><TerminalIcon icon={node.icon} size={14} /></span>
          : <span className={`dot ${kindClass}`} style={node.kind === 'terminal' && node.color ? { background: node.color } : undefined} />}
        {renaming ? (
          <input
            className="rename"
            autoFocus
            defaultValue={node.name}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={() => onRename(null)}
            onKeyDown={(e) => {
              if (matchesShortcut('cancel', e)) onRename(null)
              if (e.key === 'Enter') {
                const v = e.currentTarget.value.trim()
                if (v !== '' && v !== node.name) void window.palco.node.patch(node.id, { name: v })
                onRename(null)
              }
            }}
          />
        ) : (
          <span className="node-name" onDoubleClick={() => { if (!(node.kind === 'note' && node.linkedFile)) onRename(node.id) }}>
            {node.name}
          </span>
        )}
        {node.kind === 'note' && node.linkedFile && (
          <>
            <span className="note-file" title={node.linkedFile} aria-label={t('notes.linkedFile')} role="img"><FileSymlink size={12} aria-hidden="true" /></span>
            {node.fileMissing && <span className="file-flag">{t('notes.fileMissing')}</span>}
          </>
        )}
        {completed && <span className="completion-badge" data-completion-for={node.id} role="img" aria-label={t('canvas.Canvas.turno_concluido')} title={t('canvas.Canvas.turno_concluido')}><Check size={12} strokeWidth={3} aria-hidden="true" /></span>}
        {(lifted || docked) && <button type="button" className="lift-close" aria-label={docked ? t('canvas.Canvas.desencaixar_elemento') : t('canvas.Canvas.recolher_elemento_elevado')} title={docked ? t('canvas.Canvas.desencaixar') : t('canvas.Canvas.recolher_esc')} onPointerDown={(e) => e.stopPropagation()} onClick={onUnlift}>⤡</button>}
        {node.kind === 'terminal' && node.environment && node.environment.kind !== 'local' && (
          <span className="env-chip" title={t('canvas.Canvas.executa_em_v1', { v1: environmentLabel(node.environment) })}>{environmentLabel(node.environment)}</span>
        )}
        {node.kind === 'terminal' && chatToggle(node).visible && (
          <ChatHeaderButton node={node} />
        )}
        {peers.map((peer) => (
          <span key={peer.connectionId} className="peer-chip" title={t('canvas.Canvas.conectado_a_peername_no_floor_', { peerName: peer.peerName, floorLabel: peer.floorLabel })} onPointerDown={(e) => e.stopPropagation()}>
            <button className="peer-go" title={t('canvas.Canvas.ir_ao_floor_floorlabel', { floorLabel: peer.floorLabel })} onClick={() => onGoToFloor(peer.floorId)}>
              ↔ {peer.peerName} ({peer.floorLabel})
            </button>
            <button className="peer-cut" title={t('canvas.Canvas.desconectar')} onClick={() => void cutConnections(window.palco.history, workspaceId, [peer.connectionId])}>
              ×
            </button>
          </span>
        ))}
        {remotePeers.map((peer) => (
          <span key={peer.linkId} className="peer-chip remote" title={t('canvas.Canvas.ligado_a_label_outro_workspace', { label: peer.label })} onPointerDown={(e) => e.stopPropagation()}>
            <button className="peer-go" title={t('canvas.Canvas.ir_ate_label', { label: peer.label })} onClick={() => void window.palco.links?.goTo(peer.peerId)}>
              ⇄ {peer.label}
            </button>
            {onCutRemote && (
              <button className="peer-cut" title={t('canvas.Canvas.desconectar_de_label', { label: peer.label })} aria-label={t('canvas.Canvas.desconectar_de_label', { label: peer.label })} onClick={() => onCutRemote(peer.linkId)}>
                ×
              </button>
            )}
          </span>
        ))}
        </>}
      </div>
      {node.kind !== 'link' && <div className="node-body">
        {(node.kind === 'terminal' || node.kind === 'portal') && node.unloaded ? <UnloadedCard onWake={() => void window.palco.nodeState.wake(node.id).catch((err: unknown) => console.warn(t('ctx.nao_foi_possivel'), err))} />
          : node.kind === 'terminal' ? <TerminalFace node={node} />
          : node.kind === 'note' ? <NoteView id={node.id} content={node.content} color={node.color} fontSize={node.fontSize} fontFamily={node.fontFamily} locked={node.locked} render={node.render} />
          : node.kind === 'portal' ? <PortalView node={node} workspaceId={workspaceId} onFocus={onBodyFocus} />
          : node.kind === 'text' ? <TextView id={node.id} text={node.text} fontSize={node.fontSize} />
          : node.kind === 'file' ? <FileView path={node.path} />
          : node.kind === 'filetree' ? <FileTreeView root={node.root} {...(node.current !== undefined ? { current: node.current } : {})} onNavigate={(path) => void window.palco.node.patch(node.id, { current: path })} onOpenFile={onOpenFile} />
          : null}
        {(node.kind === 'terminal' || node.kind === 'note') && node.redacted && <RedactedFace onReveal={() => onUnredact?.()} />}
        {sizeReadout && <span className="portal-size" aria-live="off">{Math.round(frame.size.w)} × {Math.round(frame.size.h)}</span>}
      </div>}
      {node.kind === 'terminal' && !node.unloaded && !node.redacted && <Composer node={node} />}
      {docked ? <div className={`dock-resize ${docked}`} aria-label={t('canvas.Canvas.alargar_painel')} onPointerDown={onResizeDown} /> : !lifted && !held && <div className="resize-handle" onPointerDown={onResizeDown} />}
    </div>
  )
}
