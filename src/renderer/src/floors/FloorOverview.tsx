import { matchesShortcut } from '../settings/preferences'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Layers, X } from 'lucide-react'
import type { Floor, FloorId, Workspace } from '../../../shared/model'
import { FloorBar } from './FloorBar'
import { t } from '../i18n'

interface OverviewState { open: boolean; floor: FloorId }
type Action = { kind: 'open' | 'preview' | 'choose'; floor: FloorId } | { kind: 'close' }
export const initialOverview = (floor: FloorId): OverviewState => ({ open: false, floor })
export function overviewTransition(state: OverviewState, action: Action): OverviewState {
  if (action.kind === 'close') return { ...state, open: false }
  if (action.kind === 'open') return { open: true, floor: action.floor }
  if (action.kind === 'choose') return { open: false, floor: action.floor }
  return state.open ? { ...state, floor: action.floor } : state
}
export function floorTransform(height: number, open: boolean) {
  return { perspective: Number.isFinite(height) && height > 0 ? height * 2 : 1600, rotateX: open ? 55 : 0, scale: open ? .55 : 1, y: open ? 130 : 0 }
}
export function ghostTransform(relative: number) {
  return { rotateX: 55, scale: .55, y: -130 * relative + 130 - 30 * Math.max(-1, Math.min(1, relative)), opacity: relative === 0 ? 0 : relative > 0 ? .35 : .7 }
}
const STAGE_SPRING = { type: 'spring' as const, stiffness: 246.740110, damping: 31.415927, mass: 1 }
const GHOST_SPRING = { type: 'spring' as const, stiffness: 157.913670, damping: 18.849556, mass: 1 }
interface Props {
  ws: Workspace
  onSwitch(id: FloorId): void | boolean | Promise<void | boolean>
  onCreate(): void
  onLand(floor: Floor): void
  onDelete(floor: Floor): void
  children: ReactNode
  controls?: ReactNode
}

/** Só o canvas vivo sofre tilt; os controles ficam fora da transformação. */
export function FloorOverview({ ws, onSwitch, onCreate, onLand, onDelete, children, controls }: Props) {
  const [state, setState] = useState(() => initialOverview(ws.activeFloor))
  const [engaged, setEngaged] = useState(false)
  const [height, setHeight] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  const pending = useRef<{ id: FloorId; result: Promise<boolean> } | null>(null)
  const reduced = useReducedMotion()
  const floors = [null, ...Object.values(ws.floors).sort((a, b) => a.createdAt - b.createdAt).map(f => f.id)]
  const update = useCallback((action: Action) => setState(s => overviewTransition(s, action)), [])
  useEffect(() => {
    generation.current++; pending.current = null; setBusy(false); setError(null)
    setState(initialOverview(ws.activeFloor)); setEngaged(false)
    return () => { generation.current++ }
  }, [ws.id])
  useEffect(() => { setState(s => ({ ...s, floor: ws.activeFloor })) }, [ws.activeFloor])
  useEffect(() => {
    const element = root.current
    if (!element) return
    const measure = (): void => setHeight(element.clientHeight)
    const observer = new ResizeObserver(measure)
    measure(); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const close = useCallback(() => update({ kind: 'close' }), [update])
  const toggle = (): void => {
    setError(null)
    if (state.open) close()
    else { setEngaged(true); update({ kind: 'open', floor: ws.activeFloor }) }
  }
  const select = async (id: FloorId, commit: boolean): Promise<void> => {
    if (id !== null && !ws.floors[id]) return
    const version = generation.current
    let operation: Promise<boolean>
    if (pending.current) {
      if (pending.current.id !== id) return
      operation = pending.current.result
    } else {
      setBusy(true); setError(null)
      operation = Promise.resolve().then(() => onSwitch(id)).then(result => result !== false).catch(() => {
        if (version === generation.current) setError(t('floors.FloorOverview.nao_foi_possivel_trocar_de_and'))
        return false
      })
      pending.current = { id, result: operation }
    }
    const ok = await operation
    if (version !== generation.current) return
    pending.current = null; setBusy(false)
    if (ok) update({ kind: commit ? 'choose' : 'preview', floor: id })
  }
  const navigate = (direction: number): void => {
    const index = floors.findIndex(id => id === state.floor)
    const next = floors[Math.max(0, Math.min(floors.length - 1, index + direction))]
    if (next !== undefined && next !== state.floor) void select(next, false)
  }
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
      if (matchesShortcut('floorOverview', event)) { event.preventDefault(); toggle(); return }
      if (!state.open) return
      if (event.key === 'Enter' && event.target instanceof Element && event.target.closest('button,a,[role="button"]')) return
      if (matchesShortcut('cancel', event) || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); close() }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); event.stopPropagation(); navigate(event.key === 'ArrowUp' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const { perspective, ...target } = floorTransform(height, state.open)
  const activeIndex = Math.max(0, floors.indexOf(state.floor))
  const scene = engaged || state.open
  const ghosts = (above: boolean): ReactNode => floors.map((id, index) => {
    const relative = index - activeIndex
    if (relative === 0 || (relative > 0) !== above) return null
    const floor = id === null ? undefined : ws.floors[id]
    const geometry = ghostTransform(relative)
    const camera = floor?.camera ?? ws.camera
    return <motion.div key={id ?? 'ground'} className="floor-ghost" data-floor-layer={above ? 'above' : 'below'} initial={{ ...geometry, opacity: 0 }} animate={{ ...geometry, opacity: state.open ? geometry.opacity : 0 }} transition={reduced ? { duration: 0 } : { ...GHOST_SPRING, opacity: STAGE_SPRING }} aria-hidden="true">
      <div className="floor-ghost-label">{floor?.name ?? t('floors.FloorOverview.ground')}{floor && <small>{floor.branch}</small>}</div>
      <svg className="floor-ghost-nodes" width="100%" height="100%"><g transform={`translate(${camera.offset.x} ${camera.offset.y}) scale(${camera.zoom})`}>
        {Object.values(ws.nodes).filter(n => n.floorId === id).map(n => <g key={n.id}><rect x={n.pos.x} y={n.pos.y} width={n.size.w} height={n.size.h} rx={8} /><text x={n.pos.x + 12} y={n.pos.y + 22}>{n.name}</text></g>)}
      </g></svg>
    </motion.div>
  })
  const wheelState = useRef({ open: state.open, scene, navigate })
  wheelState.current = { open: state.open, scene, navigate }
  useEffect(() => {
    const element = root.current
    if (!element) return
    const wheel = (event: WheelEvent): void => {
      if (event.target instanceof Element && event.target.closest('.floor-chrome')) return
      const current = wheelState.current
      if (!current.scene || event.deltaY === 0) return
      event.preventDefault(); event.stopPropagation()
      if (current.open) current.navigate(event.deltaY < 0 ? 1 : -1)
    }
    element.addEventListener('wheel', wheel, { capture: true, passive: false })
    return () => element.removeEventListener('wheel', wheel, true)
  }, [])
  return <div ref={root} className="floor-overview" data-overview={state.open}>
    <div className="floor-stage" style={{ perspective: scene ? `${perspective}px` : undefined, clipPath: scene ? 'inset(0)' : undefined }}>
      {scene && <><motion.div className="floor-stage-scrim" initial={{ opacity: 0 }} animate={{ opacity: state.open ? 1 : 0 }} transition={reduced ? { duration: 0 } : STAGE_SPRING} />{ghosts(false)}</>}
      <motion.div className="floor-stage-live" inert={scene} animate={{ ...target, clipPath: `inset(0px round ${state.open ? 12 : 0}px)` }} transition={reduced ? { duration: 0 } : STAGE_SPRING} transformTemplate={(_values, transform) => scene ? transform : 'none'} onAnimationComplete={() => { if (!state.open) setEngaged(false) }} style={{ pointerEvents: scene ? 'none' : undefined, willChange: scene ? 'transform' : undefined }}>
        {children}
      </motion.div>
      {scene && <div className="floor-overview-dismiss" onClick={state.open ? close : undefined} aria-hidden="true" />}
      {scene && ghosts(true)}
    </div>
    <div className="floor-chrome">
      {error && <p role="alert" className="floor-overview-error">{error}</p>}
      <FloorBar ws={ws} open={state.open} active={state.floor} height={height} busy={busy} onToggle={toggle} onPreview={id => void select(id, false)} onChoose={id => void select(id, true)} onCreate={() => { close(); onCreate() }} onLand={floor => { close(); onLand(floor) }} onDelete={floor => { close(); onDelete(floor) }} />
      {controls}
    </div>
  </div>
}

/** Folha reutiliza a submissão do app: isolamento git e campos anteriores são mantidos. */
export function FloorCreateSheet({ defaultDir, onSubmit, onCancel }: { defaultDir: string; onSubmit(event: FormEvent<HTMLFormElement>): void; onCancel(): void }) {
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input')?.focus()
    const cancel = (e: KeyboardEvent): void => { if (matchesShortcut('cancel', e)) { e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [onCancel])
  return <form ref={form} className="floor-sheet" role="dialog" aria-modal="true" aria-label={t('floors.FloorOverview.novo_andar')} onPointerDown={e => e.stopPropagation()} onSubmit={onSubmit}>
    <header><span><Layers size={16} />{t('floors.FloorOverview.novo_andar')}</span><button type="button" aria-label={t('floors.FloorOverview.fechar')} onClick={onCancel}><X size={16} /></button></header>
    <p>{t('floors.FloorOverview.um_andar_isolado_em_uma_worktr')}</p>
    <label>{t('floors.FloorOverview.nome')}<input name="name" placeholder={t('floors.FloorOverview.ex_ui')} required maxLength={120} /></label>
    <label>{t('floors.FloorOverview.branch_nova')}<input name="branch" placeholder={t('floors.FloorOverview.padrao_palco_nome')} /></label>
    <label>{t('floors.FloorOverview.repositorio')}<input name="dir" placeholder={t('floors.FloorOverview.pasta_do_repositorio')} defaultValue={defaultDir} required /></label>
    <footer><button type="button" onClick={onCancel}>{t('floors.FloorOverview.cancelar')}</button><button type="submit" className="primary">{t('floors.FloorOverview.criar_andar')}</button></footer>
  </form>
}
