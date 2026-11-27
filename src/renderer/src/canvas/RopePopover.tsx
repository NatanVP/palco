import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, FolderTree, Globe, Scissors, StickyNote, Type, Layers } from 'lucide-react'
import type { FloorId, Workspace } from '../../../shared/model'
import { TerminalIcon } from '../nodes/terminal-icons'
import { matchesShortcut } from '../settings/preferences'
import { cutConnections } from './connection-cut'
import { popoverPosition, ropeLabel, ropeRows, type RopeEndpoint } from './rope-menu'
import { t } from '../i18n'

const KIND_ICON = { note: StickyNote, portal: Globe, text: Type, file: FileText, filetree: FolderTree, band: Layers } as const

function Glyph({ e }: { e: RopeEndpoint }) {
  const Icon = (KIND_ICON as Record<string, typeof StickyNote>)[e.icon]
  return Icon ? <Icon size={11} aria-hidden="true" /> : <TerminalIcon icon={e.icon} size={11} />
}

/** Tracejado entre as duas pontas: linha de 28x10 com uma bolinha em cada extremo. */
function Connector() {
  return (
    <svg aria-hidden="true" width={28} height={10} className="rope-connector">
      <line x1={5} y1={5} x2={23} y2={5} stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} strokeLinecap="round" strokeDasharray="4 3" />
      <circle cx={2.5} cy={5} r={2.5} fill="currentColor" />
      <circle cx={25.5} cy={5} r={2.5} fill="currentColor" />
    </svg>
  )
}

interface Props {
  ws: Workspace
  /** Cordas sob o clique (a de cima primeiro). */
  ropeIds: readonly string[]
  at: { x: number; y: number }
  onClose(): void
  onFocus(nodeId: string, floorId: FloorId): void
  /** Com mais de uma corda, passar o mouse numa linha destaca a corda no canvas. */
  onHighlight(ropeId: string | null): void
  /** Aviso para o leitor de tela depois de cortar (o menu já fechou; a região viva fica no Canvas). */
  onStatus(message: string): void
}

/**
 * Menu da corda: uma pílula por corda com as duas pontas (ícone e nome), o tracejado entre elas
 * e a tesoura. Clicar numa ponta vai até o nó; a tesoura corta; Esc ou clicar fora fecha.
 */
export function RopePopover({ ws, ropeIds, at, onClose, onFocus, onHighlight, onStatus }: Props) {
  const rows = ropeRows(ws, ropeIds)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const many = rows.length > 1
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (box) setPos(popoverPosition(at, { w: box.width, h: box.height }, { w: window.innerWidth, h: window.innerHeight }))
  }, [at, rows.length])
  useEffect(() => { if (rows.length === 0) onClose() }, [rows.length, onClose])
  useEffect(() => {
    const key = (e: KeyboardEvent): void => { if (matchesShortcut('cancel', e)) { e.stopPropagation(); onClose() } }
    const down = (e: PointerEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', down, true); onHighlight(null) }
  }, [onClose, onHighlight])
  useEffect(() => { ref.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }) }, [])
  const cut = (id: string): void => {
    void cutConnections(window.palco.history, ws.id, [id]).then(() => onStatus(t('canvas.RopePopover.conexao_removida'))).catch(() => {})
    onClose()
  }
  return createPortal(
    <div
        ref={ref} className={`rope-popover${many ? ' many' : ''}`} role="menu" aria-label={t('canvas.RopePopover.conexoes')}
        style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y, visibility: pos ? 'visible' : 'hidden' }}
        // O menu vai para o <body> mas os eventos do React sobem pela árvore até o Canvas (laço, pan, captura do ponteiro): corta aqui.
        onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        {rows.map((row) => (
          <div
            key={row.ropeId} role="group" aria-label={ropeLabel(row)} className="rope-row"
            onPointerEnter={() => many && onHighlight(row.ropeId)} onPointerLeave={() => many && onHighlight(null)} onFocus={() => many && onHighlight(row.ropeId)}
          >
            {row.endpoints.map((e, i) => (
              <span key={e.nodeId} className="rope-ends">
                {i > 0 && <Connector />}
                <button
                  type="button" role="menuitem" className="rope-chip" style={{ ['--chip-tint' as string]: e.tint ?? 'var(--muted)' }}
                  aria-label={t('canvas.RopePopover.enfocar_v1', { v1: e.place ? `${e.name}, ${e.place}` : e.name })}
                  onClick={() => { onClose(); onFocus(e.nodeId, e.floorId) }}
                >
                  <Glyph e={e} />
                  <span className="rope-chip-name">{e.name}</span>
                  {e.place && <span className="rope-chip-place">{e.place}</span>}
                </button>
              </span>
            ))}
            <span className="rope-spacer" />
            <span className="rope-divider" aria-hidden="true" />
            <button type="button" role="menuitem" className="rope-cut" aria-label={t('canvas.RopePopover.remover_conexao_entre_v1', { v1: ropeLabel(row) })} title={t('canvas.RopePopover.remover_conexao')} onClick={() => cut(row.ropeId)}>
              <Scissors size={12} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>,
    document.body
  )
}
