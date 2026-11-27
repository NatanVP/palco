import type { Drawing, DrawingPatch, Vec } from '../../../shared/model'
import { boxCenter, groupBox, HANDLES, isTransformable, pointsBox, type Handle } from './draw/transform'
import { drawingGeometry } from './draw/geometry'
import { drawingTextLayout } from './draw/text'
import { t } from '../i18n'

export { strokePath } from './draw/geometry'

interface Props {
  drawings: Drawing[]
  /** Traço sendo desenhado agora (ainda não gravado). */
  live: Omit<Drawing, 'id'> | null
  selected: ReadonlySet<string>
  /** Arrasto em grupo: estes desenhos aparecem deslocados até o histórico confirmar. */
  shift?: { ids: ReadonlySet<string>; by: Vec } | null
  /** Só no modo seleção os traços recebem clique. */
  interactive: boolean
  /** Shift+clique soma ou tira o desenho da seleção. */
  onSelect(id: string, additive: boolean): void
  /** Mudanças em andamento (ponto de controle, redimensionar, girar, pontas) ainda não gravadas, por desenho. */
  overrides?: ReadonlyMap<string, DrawingPatch>
  /** Zoom do canvas: as alças têm tamanho fixo na tela. */
  zoom?: number
  /** Começa o arrasto de uma alça: redimensionar, girar (um desenho ou o grupo) ou uma ponta de linha/seta. */
  onTransformStart?(target: TransformTarget, e: React.PointerEvent): void
  /** Começa o arrasto do ponto de controle da seta selecionada. */
  onControlStart?(id: string, e: React.PointerEvent): void
  /** Duplo clique numa forma com área: edita o texto dela. */
  onEditText?(id: string): void
  /** Desenho cujo texto está em edição agora (o texto fixo some para não dobrar). */
  editingTextId?: string | null
}

/** O que a alça arrastada faz. */
export type TransformTarget = { mode: 'resize'; ids: string[]; handle: Handle } | { mode: 'rotate'; ids: string[] } | { mode: 'endpoint'; id: string; end: 0 | 1 }

const CURSOR: Record<Handle, string> = { tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', tc: 'ns-resize', bc: 'ns-resize', ml: 'ew-resize', mr: 'ew-resize' }
const place = (b: { x: number; y: number; w: number; h: number }, h: Handle): Vec => ({
  x: h.endsWith('l') ? b.x : h.endsWith('r') ? b.x + b.w : b.x + b.w / 2, y: h.startsWith('t') ? b.y : h.startsWith('b') ? b.y + b.h : b.y + b.h / 2
})

/** Caixa de seleção com as oito alças de redimensionar e a de girar (acima do centro de cima); `deg` gira o conjunto em torno do centro. */
function TransformBox({ box, deg, zoom, ids, onStart }: { box: { x: number; y: number; w: number; h: number }; deg: number; zoom: number; ids: string[]; onStart(t: TransformTarget, e: React.PointerEvent): void }) {
  const c = boxCenter(box), r = 5 / zoom, stem = 24 / zoom
  return (
    <g className="drawing-transform" transform={deg ? `rotate(${deg} ${c.x} ${c.y})` : undefined}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="#4aa3ff" strokeWidth={1 / zoom} pointerEvents="none" />
      <line x1={c.x} y1={box.y} x2={c.x} y2={box.y - stem} stroke="#4aa3ff" strokeWidth={1 / zoom} pointerEvents="none" />
      <circle className="drawing-handle rotate" aria-label={t('canvas.Drawings.girar')} data-rotation-handle="true" cx={c.x} cy={box.y - stem} r={r + 1 / zoom} fill="#fff" stroke="#4aa3ff" strokeWidth={1.5 / zoom} style={{ cursor: 'grab' }} onPointerDown={(e) => onStart({ mode: 'rotate', ids }, e)} />
      {HANDLES.map((h) => {
        const p = place(box, h)
        return <circle key={h} className="drawing-handle" aria-label={t('canvas.Drawings.redimensionar')} data-resize-position={h} cx={p.x} cy={p.y} r={r} fill="#4aa3ff" stroke="#fff" strokeWidth={1 / zoom} style={{ cursor: CURSOR[h] }} onPointerDown={(e) => onStart({ mode: 'resize', ids, handle: h }, e)} />
      })}
    </g>
  )
}

/** Id do padrão de hachura de uma cor (o `#` não vale num id). */
const hatchId = (kind: 'hatch' | 'cross', color: string): string => `hatch-${kind}-${color.replace(/[^a-zA-Z0-9]/g, '')}`

function Shape({ d, className }: { d: Omit<Drawing, 'id'>; className: string }) {
  const g = drawingGeometry(d)
  const fill = g.hatch ? `url(#${hatchId(g.hatch, d.color)})` : g.fill
  return (
    <>
      <path className={className} d={g.d} stroke={g.strokeWidth ? d.color : 'none'} strokeWidth={g.strokeWidth || undefined} fill={fill} fillOpacity={g.fillOpacity}
        opacity={g.opacity === 1 ? undefined : g.opacity} strokeDasharray={g.dash} />
      {g.detail && <path className={`${className} detail`} d={g.detail} fill="none" stroke={d.color} strokeWidth={g.strokeWidth || undefined} strokeDasharray={g.dash} />}
    </>
  )
}

/** Texto dentro da forma: coluna centrada, fonte do sistema, entrelinha 1,2, quebra de linha e de palavra. */
function ShapeText({ d }: { d: Drawing }) {
  const t = drawingTextLayout(d)
  if (!t) return null
  return (
    <foreignObject x={t.x} y={t.y} width={t.width} height={t.height} overflow="visible" pointerEvents="none">
      <div style={{ alignItems: 'center', color: t.color, display: 'flex', fontFamily: 'system-ui, sans-serif', fontSize: t.fontSize, height: '100%', justifyContent: 'center', lineHeight: 1.2, overflow: 'visible', overflowWrap: 'break-word', textAlign: 'center', whiteSpace: 'pre-wrap', width: '100%' }}>
        <span style={{ maxWidth: '100%' }}>{t.text}</span>
      </div>
    </foreignObject>
  )
}

/** Padrões de hachura (45°; a cruzada soma a outra direção) para as cores em uso. */
function HatchDefs({ items }: { items: ReadonlyArray<Omit<Drawing, 'id'>> }) {
  const seen = new Map<string, { kind: 'hatch' | 'cross'; color: string }>()
  for (const d of items) if (d.fill === 'hatch' || d.fill === 'cross') seen.set(hatchId(d.fill, d.color), { kind: d.fill, color: d.color })
  if (!seen.size) return null
  return (
    <defs>
      {[...seen].map(([id, { kind, color }]) => (
        <pattern key={id} id={id} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke={color} strokeWidth="1.5" />
          {kind === 'cross' && <line x1="0" y1="0" x2="8" y2="0" stroke={color} strokeWidth="1.5" />}
        </pattern>
      ))}
    </defs>
  )
}

/** Ponto de controle de uma seta: o salvo, ou o meio da seta enquanto ela é reta. */
export const controlPoint = (d: Pick<Drawing, 'points' | 'control'>): Vec => {
  if (d.control) return d.control
  const a = d.points[0]!, b = d.points[d.points.length - 1]!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Desenhos (caneta, pincel, marca-texto, linha, seta e formas), em coordenadas de mundo, por cima dos nós; só o traço recebe clique. */
export function Drawings({ drawings, live, selected, shift, interactive, onSelect, overrides, zoom = 1, onTransformStart, onControlStart, onEditText, editingTextId = null }: Props) {
  const shown = overrides?.size ? drawings.map((d) => { const o = overrides.get(d.id); return o ? ({ ...d, ...o, ...(o.control === null ? { control: undefined } : {}) } as Drawing) : d }) : drawings
  // Desenho bloqueado não ganha alças (nem o grupo de que faz parte).
  const picked = interactive && !shift ? shown.filter((d) => selected.has(d.id)) : []
  const chosen = picked.some((d) => d.locked) ? [] : picked
  const handleOf = interactive && onControlStart && selected.size === 1 ? shown.find((d) => selected.has(d.id) && d.tool === 'arrow' && !d.locked) : undefined
  return (
    <svg className="drawings" width="1" height="1">
      <HatchDefs items={live ? [...shown, live] : shown} />
      {shown.map((d) => {
        const g = drawingGeometry(d)
        return (
          <g key={d.id} transform={shift?.ids.has(d.id) ? `translate(${shift.by.x} ${shift.by.y})` : undefined}>
            <g transform={g.rotate ? `rotate(${g.rotate.deg} ${g.rotate.cx} ${g.rotate.cy})` : undefined}>
            {interactive && (
              <path
                className="drawing-hit"
                d={g.d}
                strokeWidth={Math.max(Math.max(g.strokeWidth, d.width) + 10, 14)}
                data-drawing-id={d.id}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (e.button === 2) return
                  onSelect(d.id, e.shiftKey)
                }}
                onDoubleClick={onEditText ? (e) => { e.stopPropagation(); onEditText(d.id) } : undefined}
              />
            )}
            <Shape d={d} className={`drawing${selected.has(d.id) ? ' selected' : ''}`} />
            {d.id !== editingTextId && <ShapeText d={d} />}
            </g>
          </g>
        )
      })}
      {live && <Shape d={live} className="drawing" />}
      {onTransformStart && chosen.length === 1 && isTransformable(chosen[0]!) && (() => {
        const d = chosen[0]!, g = drawingGeometry(d)
        return <TransformBox box={pointsBox(d.points)} deg={g.rotate?.deg ?? 0} zoom={zoom} ids={[d.id]} onStart={onTransformStart} />
      })()}
      {onTransformStart && chosen.length > 1 && <TransformBox box={groupBox(chosen)} deg={0} zoom={zoom} ids={chosen.map((d) => d.id)} onStart={onTransformStart} />}
      {onTransformStart && chosen.length === 1 && !isTransformable(chosen[0]!) && ([0, 1] as const).map((end) => {
        const d = chosen[0]!, p = end === 0 ? d.points[0]! : d.points[d.points.length - 1]!
        return <circle key={end} className="drawing-handle" aria-label={end === 0 ? t('canvas.Drawings.ponta_inicial') : t('canvas.Drawings.ponta_final')} data-endpoint-handle={end} cx={p.x} cy={p.y} r={5 / zoom} fill="#4aa3ff" stroke="#fff" strokeWidth={1 / zoom} style={{ cursor: 'move' }} onPointerDown={(e) => onTransformStart({ mode: 'endpoint', id: d.id, end }, e)} />
      })}
      {handleOf && (() => {
        const c = controlPoint(handleOf)
        return <circle className="drawing-handle" aria-label={t('canvas.Drawings.ponto_de_controle_da_seta')} cx={c.x} cy={c.y} r={7} onPointerDown={(e) => onControlStart!(handleOf.id, e)} />
      })()}
    </svg>
  )
}
