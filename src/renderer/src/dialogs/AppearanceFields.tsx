import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { COLORS, DEFAULT_COLOR } from './new-terminal'
import { t, tr } from '../i18n'

interface IconProps {
  /** Nome lucide (chave de `icons`) ou um emoji. */
  icon: string
  icons: Readonly<Record<string, LucideIcon>>
  onIcon(icon: string): void
  /** Ícone usado quando o campo de emoji é esvaziado. */
  fallback: string
  /** Célula extra antes do emoji (a imagem própria do workspace). */
  leading?: ReactNode
  /** `true` quando a célula extra é a escolhida (nenhum ícone fica marcado). */
  leadingActive?: boolean
}

/** Grade de 8 colunas: [célula extra] · emoji · ícones lucide. */
export function IconGrid({ icon, icons, onIcon, fallback, leading, leadingActive = false }: IconProps) {
  const isEmoji = !icons[icon]
  return (
    <fieldset className="nt-fieldset">
      <legend className="nt-label">{t('dialogs.AppearanceFields.icone')}</legend>
      <div className="nt-icons" role="group" aria-label={t('dialogs.AppearanceFields.icone')}>
        {leading}
        <input
          className={`nt-emoji${isEmoji && !leadingActive ? ' active' : ''}`} aria-label={t('dialogs.AppearanceFields.emoji')} placeholder="😀" maxLength={8}
          value={isEmoji ? icon : ''} onChange={(e) => onIcon(e.target.value.trim() || fallback)}
        />
        {Object.entries(icons).map(([name, Icon]) => {
          const on = !leadingActive && icon === name
          return (
            <button key={name} type="button" title={name} aria-label={name} aria-pressed={on} className={`nt-icon${on ? ' active' : ''}`} onClick={() => onIcon(name)}>
              <Icon size={16} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

interface ColorProps {
  /** `null` = sem cor (só quando `allowNone`). */
  color: string | null
  onColor(color: string | null): void
  allowNone?: boolean
}

/** "Sem cor" (opcional) · as 8 cores fixas · cor personalizada. */
export function ColorRow({ color, onColor, allowNone = false }: ColorProps) {
  const custom = color !== null && !COLORS.some((c) => c.hex.toLowerCase() === color.toLowerCase())
  return (
    <fieldset className="nt-fieldset">
      <legend className="nt-label">{t('dialogs.AppearanceFields.cor')}</legend>
      <div className="nt-colors">
        {allowNone && (
          <button type="button" title={t('dialogs.AppearanceFields.sem_cor')} aria-label={t('dialogs.AppearanceFields.sem_cor')} aria-pressed={color === null} className={`nt-dot nt-none${color === null ? ' active' : ''}`} onClick={() => onColor(null)} />
        )}
        {COLORS.map((c) => {
          const on = color?.toLowerCase() === c.hex.toLowerCase()
          return <button key={c.hex} type="button" title={tr(c.name)} aria-label={tr(c.name)} aria-pressed={on} className={`nt-dot${on ? ' active' : ''}`} style={{ background: c.hex }} onClick={() => onColor(c.hex)} />
        })}
        <label className={`nt-dot nt-custom${custom ? ' active' : ''}`} title={t('dialogs.AppearanceFields.cor_personalizada')}>
          <input type="color" aria-label={t('dialogs.AppearanceFields.cor_personalizada')} value={custom ? color! : DEFAULT_COLOR} onChange={(e) => onColor(e.target.value.toUpperCase())} />
        </label>
      </div>
    </fieldset>
  )
}
