import { t } from '../i18n'
/** "Redefine em 2 horas", "Redefine amanhã"… a partir do ISO de renovação da janela de uso. */
export function resetText(resetsAt: string | null, now: Date = new Date()): string {
  if (!resetsAt) return ''
  const when = new Date(resetsAt)
  const ms = when.getTime() - now.getTime()
  if (ms <= 0) return t('usage.reset-text.redefine_agora')
  const min = Math.round(ms / 60_000)
  if (min < 60) return t('usage.reset-text.redefine_em_min_min', { min })
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(when) - startOfDay(now)) / 86_400_000)
  if (days === 0) {
    const h = Math.round(min / 60)
    return t('usage.reset-text.redefine_em_horas', { count: h })
  }
  if (days === 1) return t('usage.reset-text.redefine_amanha')
  if (days === 2) return t('usage.reset-text.redefine_depois_de_amanha')
  return t('usage.reset-text.redefine_em_days_dias', { days })
}
