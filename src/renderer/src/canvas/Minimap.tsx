import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasNode, Size } from '../../../shared/model'
import type { Camera } from './camera'
import { minimapToWorld, minimapTransform, worldToMinimap } from './minimap'

const BOX: Size = { w: 220, h: 150 }

const FILL: Record<string, string> = {
  claude: '#d97757', codex: '#6fa8ff', shell: '#8fd18f', note: '#e5c95b', portal: '#b78cff',
  text: '#c9ced8', file: '#7fc8c0', filetree: '#7fc8c0', link: '#6aa8e8'
}

interface Props {
  nodes: CanvasNode[]
  camera: Camera
  /** Tamanho da área visível do canvas, em pixels de tela. */
  view: Size
  onCamera(c: Camera): void
}

/** Retângulos dos nós, retângulo da viewport; clique ou arrasto centralizam a câmera no ponto. */
export function Minimap({ nodes, camera, view, onCamera }: Props) {
  const dragging = useRef(false)
  const [dragTransform, setDragTransform] = useState<ReturnType<typeof minimapTransform> | null>(null)
  const viewport = {
    pos: { x: -camera.offset.x / camera.zoom, y: -camera.offset.y / camera.zoom },
    size: { w: view.w / camera.zoom, h: view.h / camera.zoom }
  }
  const t = minimapTransform(nodes.map((n) => ({ pos: n.pos, size: n.size })), viewport, BOX)
  // A transformação congela durante o arrasto: senão o mapa muda de escala sob o cursor.
  const frozen = useRef(t)
  if (!dragging.current) frozen.current = t

  const goTo = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const world = minimapToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, frozen.current)
    onCamera({ zoom: camera.zoom, offset: { x: view.w / 2 - world.x * camera.zoom, y: view.h / 2 - world.y * camera.zoom } })
  }

  const shown = dragTransform ?? t
  const rect = (pos: { x: number; y: number }, size: Size) => {
    const a = worldToMinimap(pos, shown)
    return { x: a.x, y: a.y, width: Math.max(size.w * shown.scale, 1.5), height: Math.max(size.h * shown.scale, 1.5) }
  }

  return (
    <div className="minimap" onPointerDown={(e) => e.stopPropagation()}>
      <svg
        width={BOX.w}
        height={BOX.h}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          setDragTransform(frozen.current)
          goTo(e)
        }}
        onPointerMove={(e) => dragging.current && goTo(e)}
        onPointerUp={() => { dragging.current = false; setDragTransform(null) }}
        onPointerCancel={() => { dragging.current = false; setDragTransform(null) }}
        onLostPointerCapture={() => { dragging.current = false; setDragTransform(null) }}
      >
        {nodes.map((n) => (
          <rect key={n.id} {...rect(n.pos, n.size)} rx={1.5} fill={FILL[n.kind === 'terminal' ? n.agent : n.kind] ?? '#888'} opacity={0.75} />
        ))}
        <rect className="minimap-view" {...rect(viewport.pos, viewport.size)} rx={3} />
      </svg>
    </div>
  )
}
