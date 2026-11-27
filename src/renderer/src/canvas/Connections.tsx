import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useReducedMotion } from 'motion/react'
import { closestEdgePin, closestEdgePins, createRope, ropePath, type RopeFrame } from './rope'
import { PREVIEW_ROPE_ID, RopeScene } from './rope-scene'
import { screenToWorld, type Camera } from './camera'
import { ropesAt, uniqueRopeIds } from './rope-menu'
import { usePreferences } from '../settings/preferences'
import type { CanvasNode, Connection, Vec } from '../../../shared/model'
import { t } from '../i18n'

export type Frames = Record<string, RopeFrame>
export function frameOf(node: CanvasNode, frames: Frames): RopeFrame { return frames[node.id] ?? { pos: node.pos, size: node.size } }
/** Semente só para cordas novas (ou reduced-motion). */
export function curve(a: Vec, b: Vec): string { return ropePath(createRope(a, b)) }
interface Props {
  nodes: Record<string, CanvasNode>
  connections: Connection[]
  frames: Frames
  selected: string | null
  onSelect(id: string): void
  /** Clique (sem arrastar) ou botão direito numa corda: abre o menu da corda com as cordas sob o ponto. Ausente = sem menu. */
  onRopeMenu?(ropeIds: string[], at: { x: number; y: number }): void
  /** Corda destacada pelo menu (linha sob o mouse). */
  highlighted?: string | null
  linkFrom?: string | null
  /** Opcional para uso controlado; o Canvas real fornece viewport/camera, sem estado de cursor. */
  cursor?: Vec | null
  viewport?: RefObject<HTMLDivElement | null>
  camera?: Camera
  zoom?: number
}

export function Connections(props: Props) {
  const { nodes, connections, frames, selected, onSelect, onRopeMenu, highlighted, linkFrom, cursor, viewport, camera, zoom = 1 } = props
  const scene = useRef<RopeScene | null>(null)
  scene.current ??= new RopeScene()
  const routing = usePreferences().ropeRouting
  scene.current.setRouting(routing)
  const latest = useRef(props); latest.current = props
  const paths = useRef(new Map<string, SVGPathElement>())
  const hits = useRef(new Map<string, SVGPathElement>())
  const preview = useRef<SVGGElement>(null), tip = useRef<SVGCircleElement>(null)
  const cursorPoint = useRef<Vec | null>(null), source = useRef<string | null>(null)
  const frame = useRef<number | null>(null), previous = useRef<number | null>(null)
  const alive = useRef(true)
  const down = useRef<{ x: number; y: number } | null>(null)
  /** Cordas sob o ponteiro, da de cima para a de baixo (as `rope-hit` empilhadas no ponto). */
  const openMenu = (e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, secondary: boolean): void => {
    if (!onRopeMenu) return
    const start = down.current; down.current = null
    if (!secondary && (!start || Math.abs(e.clientX - start.x) >= 3 || Math.abs(e.clientY - start.y) >= 3)) return
    if (secondary) { e.preventDefault(); e.stopPropagation() }
    // Limiares adaptativos (3/8/14 px de tela ÷ zoom): duas cordas a ~9 px viram duas linhas. Sem câmera, cai nas linhas empilhadas no ponto.
    const box = viewport?.current?.getBoundingClientRect(), cam = latest.current.camera
    const ids = box && cam
      ? ropesAt([...scene.current!.entries].filter(([id]) => id !== PREVIEW_ROPE_ID).map(([id]) => ({ id, points: scene.current!.polyline(id) })), screenToWorld({ x: e.clientX - box.left, y: e.clientY - box.top }, cam), cam.zoom)
      : uniqueRopeIds(document.elementsFromPoint(e.clientX, e.clientY).map(el => el.getAttribute('data-rope-id')))
    if (ids.length) onRopeMenu(ids, { x: e.clientX, y: e.clientY })
  }
  const [hovered, setHovered] = useState<string | null>(null)
  const reduced = Boolean(useReducedMotion())
  const draw = useCallback((only?: string) => {
    for (const [id] of scene.current!.entries) {
      if (only && id !== only) continue
      const d = scene.current!.path(id)
      paths.current.get(id)?.setAttribute('d', d)
      hits.current.get(id)?.setAttribute('d', d)
    }
    const rope = scene.current!.entries.get(PREVIEW_ROPE_ID)?.rope
    if (preview.current) preview.current.style.display = rope ? '' : 'none'
    if (rope && tip.current) {
      tip.current.setAttribute('cx', String(rope.b.x)); tip.current.setAttribute('cy', String(rope.b.y))
      tip.current.setAttribute('r', String(3 / (latest.current.zoom ?? 1)))
    }
  }, [])
  const start = useCallback(() => {
    if (!alive.current || frame.current !== null || !scene.current!.awake) return
    const tick = (now: number): void => {
      frame.current = null
      if (!alive.current) return
      const awake = scene.current!.advance(previous.current === null ? 1 / 60 : (now - previous.current) / 1000)
      previous.current = now; draw()
      if (awake) frame.current = requestAnimationFrame(tick)
      else previous.current = null
    }
    frame.current = requestAnimationFrame(tick)
  }, [draw])
  useLayoutEffect(() => {
    alive.current = true
    return () => { alive.current = false; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; previous.current = null }
  }, [])
  useLayoutEffect(() => {
    scene.current!.setReduced(reduced)
    scene.current!.synchronize(nodes, connections, frames)
    if (source.current !== (linkFrom ?? null)) cursorPoint.current = cursor ?? null
    else if (cursor !== undefined) cursorPoint.current = cursor
    source.current = linkFrom ?? null
    const from = linkFrom ? nodes[linkFrom] : undefined
    if (from && cursorPoint.current) scene.current!.setPreview(from.id, frameOf(from, frames), cursorPoint.current)
    else scene.current!.clearPreview()
    draw(); start()
  }, [nodes, connections, frames, linkFrom, cursor, reduced, zoom, routing, draw, start])
  useLayoutEffect(() => {
    const element = viewport?.current
    if (!element || !linkFrom) return
    const move = (event: PointerEvent): void => {
      const current = latest.current, from = current.linkFrom ? current.nodes[current.linkFrom] : undefined
      if (!from || !current.camera) return
      const box = element.getBoundingClientRect()
      const point = screenToWorld({ x: event.clientX - box.left, y: event.clientY - box.top }, current.camera)
      cursorPoint.current = point
      scene.current!.setPreview(from.id, frameOf(from, current.frames), point)
      draw(PREVIEW_ROPE_ID); start()
    }
    element.addEventListener('pointermove', move, { capture: true, passive: true })
    return () => element.removeEventListener('pointermove', move, true)
  }, [viewport, linkFrom, draw, start])
  const register = (map: Map<string, SVGPathElement>, id: string, path: SVGPathElement | null): void => { if (path) map.set(id, path); else map.delete(id) }
  const from = linkFrom ? nodes[linkFrom] : undefined
  const point = cursor === undefined ? cursorPoint.current : cursor
  const previewPins = from && point ? { a: closestEdgePin(frameOf(from, frames), point), b: point } : undefined
  return <svg className="connections" width="1" height="1" aria-label={t('canvas.Connections.conexoes')}>
    {connections.map(c => {
      const a = nodes[c.a], b = nodes[c.b]
      if (!a || !b || a.floorId !== b.floorId) return null
      const d = scene.current!.path(c.id, closestEdgePins(frameOf(a, frames), frameOf(b, frames)))
      const active = selected === c.id, highlight = active || hovered === c.id || highlighted === c.id
      return <g key={c.id}>
        <path ref={path => register(paths.current, c.id, path)} className={`rope${active ? ' selected' : ''}`} d={d} style={{ stroke: active ? 'var(--rope-selected)' : highlight ? 'var(--accent)' : 'var(--rope)', strokeWidth: highlight ? 2.5 : 2, strokeDasharray: active ? undefined : '8 6', strokeLinecap: 'round', strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' }} />
        <path ref={path => register(hits.current, c.id, path)} className="rope-hit" d={d} style={{ vectorEffect: 'non-scaling-stroke' }} onPointerEnter={() => setHovered(c.id)} onPointerLeave={() => setHovered(null)} data-rope-id={c.id} onPointerDown={e => { e.stopPropagation(); onSelect(c.id); down.current = onRopeMenu && e.button === 0 ? { x: e.clientX, y: e.clientY } : null }} onPointerUp={e => openMenu(e, false)} onContextMenu={e => openMenu(e, true)} />
      </g>
    })}
    {from && <g ref={preview} data-rope-preview="true" style={{ display: previewPins ? undefined : 'none' }}>
      <path ref={path => register(paths.current, PREVIEW_ROPE_ID, path)} d={scene.current!.path(PREVIEW_ROPE_ID, previewPins)} style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 2.4, strokeDasharray: '8 6', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }} />
      <circle ref={tip} cx={point?.x ?? 0} cy={point?.y ?? 0} r={3 / zoom} fill="var(--accent)" />
    </g>}
  </svg>
}
