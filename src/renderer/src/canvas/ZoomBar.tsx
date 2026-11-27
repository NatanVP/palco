import { usePreferences } from '../settings/preferences'
import { Map as MapIcon, Minus, Plus } from 'lucide-react'
import { UsagePill } from '../usage/UsagePanel'
import { MAX_ZOOM, MIN_ZOOM } from './camera'
import { zoomStepBy } from './screen-options'
import { t } from '../i18n'

interface Props {
  zoom: number
  /** Recebe o zoom atual (o mais recente, não o do render) e devolve o novo. */
  onZoom(next: (current: number) => number): void
  minimap: boolean
  onToggleMinimap(): void
  onOpenUsage(): void
}

/** Controles de uso, minimapa e zoom; o overview fornece seu próprio indicador. */
export function ZoomBar({ zoom, onZoom, minimap, onToggleMinimap, onOpenUsage }: Props) {
  const preferences = usePreferences()
  return (
    <div className="zoombar" onPointerDown={(e) => e.stopPropagation()}>
      {preferences.usageEnabled && <UsagePill onOpen={onOpenUsage} />}
      <button data-toggle-minimap className={`bar-btn${minimap ? ' active' : ''}`} title={t('canvas.ZoomBar.minimapa')} aria-label={t('canvas.ZoomBar.minimapa')} aria-pressed={minimap} onClick={onToggleMinimap}>
        <MapIcon size={16} />
      </button>
      <span className="bar-sep" />
      <button className="bar-btn" title={t('canvas.ZoomBar.diminuir_zoom')} aria-label={t('canvas.ZoomBar.diminuir_zoom')} disabled={zoom <= MIN_ZOOM + 1e-9} onClick={() => onZoom((z) => zoomStepBy(z, -1, preferences.zoomStepPercent))}>
        <Minus size={14} />
      </button>
      <button className="zoom-pct" title={t('canvas.ZoomBar.voltar_a_100')} onClick={() => onZoom(() => 1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="bar-btn" title={t('canvas.ZoomBar.aumentar_zoom')} aria-label={t('canvas.ZoomBar.aumentar_zoom')} disabled={zoom >= MAX_ZOOM - 1e-9} onClick={() => onZoom((z) => zoomStepBy(z, 1, preferences.zoomStepPercent))}>
        <Plus size={14} />
      </button>
    </div>
  )
}
