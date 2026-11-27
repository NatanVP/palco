import type { BandNode, Size, Vec } from '../../../shared/model'
import { TerminalIcon } from './terminal-icons'
import { t } from '../i18n'

interface Props {
  band: BandNode
  frame: { pos: Vec; size: Size }
  linking: boolean
  isLinkSource: boolean
  onLink(id: string): void
  /** "Renomear" do menu da banda: o rótulo vira campo. */
  renaming?: boolean
  onRename?(id: string | null): void
}

/** Moldura tracejada em volta dos membros da banda: rótulo, alça de conexão e dissolver. */
export function BandFrame({ band, frame, linking, isLinkSource, onLink, renaming = false, onRename }: Props) {
  return (
    <div
      className={`band-frame${isLinkSource ? ' link-source' : ''}${linking && !isLinkSource ? ' link-target' : ''}`}
      style={{ left: frame.pos.x, top: frame.pos.y, width: frame.size.w, height: frame.size.h, ...(band.color ? { borderColor: band.color, background: `${band.color}10` } : {}) }}
    >
      <div className="band-label" onPointerDown={(e) => e.stopPropagation()}>
        {band.icon && <TerminalIcon icon={band.icon} size={14} {...(band.color ? { color: band.color } : {})} />}
        {renaming
          ? <input className="rename" aria-label={t('ctx.renomear_banda')} autoFocus defaultValue={band.name} onBlur={() => onRename?.(null)} onKeyDown={(e) => {
              if (e.key === 'Escape') onRename?.(null)
              if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v && v !== band.name) void window.palco.node.patch(band.id, { name: v }); onRename?.(null) }
            }} />
          : <span>{band.name}</span>}
        <button title={t('nodes.BandFrame.ligar_a_banda_a_outro_no_vale_')} onClick={() => onLink(band.id)}>
          {t('nodes.BandFrame.ligar')}
        </button>
        <button disabled={band.positionLocked === true} title={t('nodes.BandFrame.dissolver_a_banda_os_membros_f')} onClick={() => void window.palco.band.dissolve(band.id)}>
          ×
        </button>
      </div>
    </div>
  )
}
