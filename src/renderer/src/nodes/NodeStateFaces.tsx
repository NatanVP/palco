import { Eye, Moon } from 'lucide-react'
import { t } from '../i18n'

/** Cartão de um terminal ou portal descarregado: o que aconteceu e o botão que o traz de volta. */
export function UnloadedCard({ onWake }: { onWake(): void }) {
  return (
    <div className="node-unloaded" onPointerDown={(e) => e.stopPropagation()}>
      <Moon size={28} aria-hidden="true" />
      <p className="node-unloaded-title">{t('ctx.elemento_descarregado')}</p>
      <p className="node-unloaded-detail">{t('ctx.elemento_descarregado_detalhe')}</p>
      <button type="button" onClick={onWake}>{t('ctx.acordar')}</button>
    </div>
  )
}

/** "Desfocar": o conteúdo continua montado (o processo segue), mas coberto; só o botão do olho o mostra de novo. */
export function RedactedFace({ onReveal }: { onReveal(): void }) {
  return (
    <div className="node-redacted" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" aria-label={t('ctx.remover_desfoque')} title={t('ctx.remover_desfoque')} onClick={onReveal}><Eye size={22} aria-hidden="true" /></button>
    </div>
  )
}
