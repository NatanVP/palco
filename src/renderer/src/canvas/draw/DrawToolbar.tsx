import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowBigDown, ArrowBigLeft, ArrowBigRight, ArrowBigUp, Circle, Cloud, Diamond, Heart, Hexagon, Highlighter, Minus, MoveUpRight, Paintbrush, Pencil, Plus, Slash, Sparkles, Square, SquareCheck, SquareX, Star, Triangle } from 'lucide-react'
import type { DrawFill, DrawPattern } from '../../../../shared/model'
import { clampTextSize, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP } from './text'
import {
  clampRadius, clampWidth, DRAW_PALETTE, FILL_LABEL, FILLS, isAreaShape, PATTERN_DASH, PATTERN_LABEL, PATTERNS, RADIUS_MAX, RADIUS_MIN, SHAPES, TOOL_LABEL, WIDTH_MAX, WIDTH_MIN,
  type DrawStyle, type DrawTool, type Shape
} from './tools'
import { t } from '../../i18n'

const ICON: Record<DrawTool, ReactNode> = {
  pen: <Pencil size={16} />, brush: <Paintbrush size={16} />, smart: <Sparkles size={16} />, arrow: <MoveUpRight size={16} />,
  highlighter: <Highlighter size={16} />, line: <Slash size={16} />,
  rect: <Square size={16} />, ellipse: <Circle size={16} />, triangle: <Triangle size={16} />, diamond: <Diamond size={16} />,
  hexagon: <Hexagon size={16} />, star: <Star size={16} />,
  oval: <Circle size={16} style={{ transform: 'scaleX(1.25)' }} />, parallelogram: <Square size={16} style={{ transform: 'skewX(-18deg)' }} />, cloud: <Cloud size={16} />, heart: <Heart size={16} />,
  boxX: <SquareX size={16} />, checkbox: <SquareCheck size={16} />,
  arrowLeft: <ArrowBigLeft size={16} />, arrowUp: <ArrowBigUp size={16} />, arrowDown: <ArrowBigDown size={16} />, arrowRight: <ArrowBigRight size={16} />
}
const FREE_TOOLS: DrawTool[] = ['pen', 'brush', 'smart', 'arrow', 'highlighter', 'line']

/** Miniatura do estilo do traço (sólido, tracejado, pontilhado). */
function PatternIcon({ pattern }: { pattern: DrawPattern }) {
  const dash = PATTERN_DASH[pattern].map((n) => n / 3).join(' ')
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
      <line x1="2" y1="5" x2="20" y2="5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={dash || undefined} />
    </svg>
  )
}

/** Miniatura do preenchimento (nenhum, hachura, hachura cruzada, tom, sólido). */
function FillIcon({ fill }: { fill: DrawFill }) {
  const id = `fi-${fill}`
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {(fill === 'hatch' || fill === 'cross') && <defs><pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1.2" />{fill === 'cross' && <line x1="0" y1="0" x2="4" y2="0" stroke="currentColor" strokeWidth="1.2" />}</pattern></defs>}
      <rect x="2" y="2" width="12" height="12" rx="2" fill={fill === 'solid' ? 'currentColor' : fill === 'tint' ? 'currentColor' : fill === 'none' ? 'none' : `url(#${id})`} fillOpacity={fill === 'tint' ? 0.25 : undefined} stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

type Pop = 'shape' | 'color' | 'pattern' | 'fill' | null

/** O que os controles de estilo mostram e alteram: o estilo da ferramenta ou o do desenho selecionado. */
export interface StyleValue { color: string; width: number; pattern: DrawPattern; fill: DrawFill; radius: number; /** Só na barra de seleção: tamanho do texto das formas (8–200). */ textSize?: number }

/** Fecha o popover aberto ao clicar fora da barra. */
function usePopover(): { pop: Pop; setPop(p: Pop): void; toggle(p: Exclude<Pop, null>): void; root: React.RefObject<HTMLDivElement | null> } {
  const [pop, setPop] = useState<Pop>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pop) return
    const close = (e: PointerEvent): void => { if (!root.current?.contains(e.target as Node)) setPop(null) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [pop])
  return { pop, setPop, toggle: (p) => setPop((cur) => (cur === p ? null : p)), root }
}

/**
 * Cor, espessura (− N pt +), estilo do traço e, nas formas com área, preenchimento e raio dos cantos.
 * Serve à barra de desenho (estilo da ferramenta) e à barra de seleção (estilo em lote dos desenhos escolhidos).
 */
function StyleControls({ value, onChange, area, brush, pop, setPop, toggle }: {
  value: StyleValue; onChange(patch: Partial<StyleValue>): void; area: boolean; brush: boolean
  pop: Pop; setPop(p: Pop): void; toggle(p: Exclude<Pop, null>): void
}) {
  return (
    <>
      <span className="draw-anchor">
        <button type="button" className="draw-btn" aria-label={t('canvas.draw.DrawToolbar.cor')} title={t('canvas.draw.DrawToolbar.cor')} aria-expanded={pop === 'color'} onClick={() => toggle('color')}>
          <span className="draw-dot" style={{ background: value.color }} />
        </button>
        {pop === 'color' && (
          <div className="draw-pop draw-colors" role="menu" aria-label={t('canvas.draw.DrawToolbar.cor')}>
            {DRAW_PALETTE.map((c) => (
              <button key={c} type="button" role="menuitemradio" aria-checked={value.color.toUpperCase() === c} aria-label={c} title={c}
                className={`draw-swatch${value.color.toUpperCase() === c ? ' active' : ''}`} style={{ background: c }} onClick={() => { onChange({ color: c }); setPop(null) }} />
            ))}
            <label className="draw-swatch draw-custom" title={t('canvas.draw.DrawToolbar.cor_personalizada')}>
              <input type="color" aria-label={t('canvas.draw.DrawToolbar.cor_personalizada')} value={/^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : '#ff3b30'} onChange={(e) => onChange({ color: e.target.value.toUpperCase() })} />
            </label>
          </div>
        )}
      </span>
      <span className="draw-sep" />
      <button type="button" className="draw-btn" aria-label={t('canvas.draw.DrawToolbar.diminuir_espessura')} title={t('canvas.draw.DrawToolbar.diminuir_espessura_2')} disabled={value.width <= WIDTH_MIN}
        onClick={() => onChange({ width: clampWidth(value.width - 1) })}><Minus size={14} /></button>
      <span className="draw-width" title={t('canvas.draw.DrawToolbar.espessura_role_a_roda_para_aju')} onWheel={(e) => onChange({ width: clampWidth(value.width + (e.deltaY < 0 ? 1 : -1)) })}>{value.width}{t('canvas.draw.DrawToolbar.pt')}</span>
      <button type="button" className="draw-btn" aria-label={t('canvas.draw.DrawToolbar.aumentar_espessura')} title={t('canvas.draw.DrawToolbar.aumentar_espessura_2')} disabled={value.width >= WIDTH_MAX}
        onClick={() => onChange({ width: clampWidth(value.width + 1) })}><Plus size={14} /></button>
      <span className="draw-sep" />
      <span className="draw-anchor">
        <button type="button" className="draw-btn wide" aria-label={t('canvas.draw.DrawToolbar.estilo_do_traco')} title={t('canvas.draw.DrawToolbar.estilo_do_traco_v1', { v1: PATTERN_LABEL[value.pattern] })}
          aria-expanded={pop === 'pattern'} disabled={brush} onClick={() => toggle('pattern')}>
          <PatternIcon pattern={value.pattern} />
        </button>
        {pop === 'pattern' && (
          <div className="draw-pop draw-patterns" role="menu" aria-label={t('canvas.draw.DrawToolbar.estilo_do_traco')}>
            {PATTERNS.map((p) => (
              <button key={p} type="button" role="menuitemradio" aria-checked={value.pattern === p} className={`draw-row${value.pattern === p ? ' active' : ''}`}
                onClick={() => { onChange({ pattern: p }); setPop(null) }}>
                <PatternIcon pattern={p} /> {PATTERN_LABEL[p]}
              </button>
            ))}
          </div>
        )}
      </span>
      {area && (
        <>
          <span className="draw-sep" />
          <span className="draw-anchor">
            <button type="button" className="draw-btn" aria-label={t('canvas.draw.DrawToolbar.preenchimento')} title={t('canvas.draw.DrawToolbar.preenchimento_v1', { v1: FILL_LABEL[value.fill] })} aria-expanded={pop === 'fill'} onClick={() => toggle('fill')}>
              <FillIcon fill={value.fill} />
            </button>
            {pop === 'fill' && (
              <div className="draw-pop draw-patterns" role="menu" aria-label={t('canvas.draw.DrawToolbar.preenchimento')}>
                {FILLS.map((fl) => (
                  <button key={fl} type="button" role="menuitemradio" aria-checked={value.fill === fl} className={`draw-row${value.fill === fl ? ' active' : ''}`}
                    onClick={() => { onChange({ fill: fl }); setPop(null) }}>
                    <FillIcon fill={fl} /> {FILL_LABEL[fl]}
                  </button>
                ))}
              </div>
            )}
          </span>
          <button type="button" className="draw-btn" aria-label={t('canvas.draw.DrawToolbar.diminuir_raio')} title={t('canvas.draw.DrawToolbar.diminuir_o_raio_dos_cantos')} disabled={value.radius <= RADIUS_MIN}
            onClick={() => onChange({ radius: clampRadius(value.radius - 2) })}><Minus size={14} /></button>
          <span className="draw-width" title={t('canvas.draw.DrawToolbar.raio_dos_cantos_role_a_roda_pa')} aria-label={t('canvas.draw.DrawToolbar.raio_radius', { radius: value.radius })} onWheel={(e) => onChange({ radius: clampRadius(value.radius + (e.deltaY < 0 ? 2 : -2)) })}>r {value.radius}</span>
          {value.textSize !== undefined && (
            <>
              <span className="draw-sep" />
              <button type="button" className="draw-btn" aria-label={t('canvas.draw.DrawToolbar.diminuir_texto')} title={t('canvas.draw.DrawToolbar.diminuir_o_texto_das_formas')} disabled={value.textSize <= TEXT_SIZE_MIN} onClick={() => onChange({ textSize: clampTextSize(value.textSize! - TEXT_SIZE_STEP) })}><Minus size={14} /></button>
              <span className="draw-width" title={t('canvas.draw.DrawToolbar.tamanho_do_texto_role_a_roda_p')} aria-label={t('canvas.draw.DrawToolbar.texto_textsize', { textSize: value.textSize })} onWheel={(e) => onChange({ textSize: clampTextSize(value.textSize! + (e.deltaY < 0 ? TEXT_SIZE_STEP : -TEXT_SIZE_STEP)) })}>{t('canvas.draw.DrawToolbar.aa')} {value.textSize}</span>
              <button type="button" className="draw-btn" aria-label={t('canvas.draw.DrawToolbar.aumentar_texto')} title={t('canvas.draw.DrawToolbar.aumentar_o_texto_das_formas')} disabled={value.textSize >= TEXT_SIZE_MAX} onClick={() => onChange({ textSize: clampTextSize(value.textSize! + TEXT_SIZE_STEP) })}><Plus size={14} /></button>
              <span className="draw-sep" />
            </>
          )}
          <button type="button" className="draw-btn" aria-label={t('canvas.draw.DrawToolbar.aumentar_raio')} title={t('canvas.draw.DrawToolbar.aumentar_o_raio_dos_cantos')} disabled={value.radius >= RADIUS_MAX}
            onClick={() => onChange({ radius: clampRadius(value.radius + 2) })}><Plus size={14} /></button>
        </>
      )}
    </>
  )
}

interface Props {
  style: DrawStyle
  onStyle(next: DrawStyle): void
}

/**
 * Barra de desenho (aparece no modo desenho, logo abaixo do dock): caneta, pincel, desenho inteligente, seta,
 * marca-texto, linha e formas; depois cor, espessura (− N pt +), estilo do traço e, nas formas, preenchimento e raio.
 */
export function DrawToolbar({ style, onStyle }: Props) {
  const { pop, setPop, toggle, root } = usePopover()
  const set = (patch: Partial<DrawStyle>): void => onStyle({ ...style, ...patch })
  const shapeActive = (SHAPES as readonly string[]).includes(style.tool)
  const tool = (t: DrawTool): ReactNode => (
    <button key={t} type="button" className={`draw-btn${style.tool === t ? ' active' : ''}`} aria-label={TOOL_LABEL[t]} title={TOOL_LABEL[t]}
      aria-pressed={style.tool === t} onClick={() => { set({ tool: t }); setPop(null) }}>
      {ICON[t]}
    </button>
  )

  return (
    <div ref={root} className="draw-toolbar" role="toolbar" aria-label={t('canvas.draw.DrawToolbar.desenho')} onPointerDown={(e) => e.stopPropagation()}>
      {FREE_TOOLS.map(tool)}
      <span className="draw-anchor">
        <button type="button" className={`draw-btn${shapeActive ? ' active' : ''}`} aria-label={t('canvas.draw.DrawToolbar.formas')} title={t('canvas.draw.DrawToolbar.formas_v1_b_arma_o_retangulo', { v1: TOOL_LABEL[style.shape] })}
          aria-pressed={shapeActive} aria-expanded={pop === 'shape'} onClick={() => { set({ tool: style.shape }); toggle('shape') }}>
          {ICON[style.shape]}
        </button>
        {pop === 'shape' && (
          <div className="draw-pop draw-shapes" role="menu" aria-label={t('canvas.draw.DrawToolbar.formas')}>
            {SHAPES.map((sh: Shape) => (
              <button key={sh} type="button" role="menuitemradio" aria-checked={style.tool === sh} aria-label={TOOL_LABEL[sh]} title={TOOL_LABEL[sh]}
                className={`draw-btn${style.tool === sh ? ' active' : ''}`} onClick={() => { set({ tool: sh, shape: sh }); setPop(null) }}>
                {ICON[sh]}
              </button>
            ))}
          </div>
        )}
      </span>
      <span className="draw-sep" />
      <StyleControls value={style} onChange={(patch) => set(patch)} area={isAreaShape(style.tool)} brush={style.tool === 'brush'} pop={pop} setPop={setPop} toggle={toggle} />
    </div>
  )
}

/**
 * Barra de estilo dos desenhos selecionados (modo seleção): os mesmos controles, aplicados a todos de uma vez
 * (um nível no histórico). Mostra o estilo do primeiro desenho; preenchimento e raio só aparecem se algum for forma com área.
 */
export function DrawingSelectionToolbar({ value, hasArea, onlyBrush, onChange }: { value: StyleValue; hasArea: boolean; onlyBrush: boolean; onChange(patch: Partial<StyleValue>): void }) {
  const { pop, setPop, toggle, root } = usePopover()
  return (
    <div ref={root} className="draw-toolbar draw-selection" role="toolbar" aria-label={t('canvas.draw.DrawToolbar.estilo_dos_desenhos_selecionad')} onPointerDown={(e) => e.stopPropagation()}>
      <StyleControls value={value} onChange={onChange} area={hasArea} brush={onlyBrush} pop={pop} setPop={setPop} toggle={toggle} />
    </div>
  )
}
