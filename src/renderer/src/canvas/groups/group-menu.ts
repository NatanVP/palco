import { Copy, Palette, Pencil, Ungroup } from 'lucide-react'
import type { CanvasGroup } from '../../../../shared/model'
import { NOTE_COLOR_HEX } from '../../../../shared/new-item'
import { NOTE_COLORS } from '../../../../shared/preferences'
import { noteLight } from '../../nodes/note-colors'
import { t, type MessageKey } from '../../i18n'
import type { MenuEntry, MenuItem } from '../ContextMenu'

/** Menu do cabeçalho do grupo, com os itens e a ordem do palco. As cores são os pastéis das notas. */
export function groupMenu(group: CanvasGroup, a: { rename(): void; copy(): void; color(color: string | null): void; scores: MenuItem; ungroup(): void }): MenuEntry[] {
  const swatch = (id: string, label: string, color: string | null): MenuItem => ({ id: `group.color.${id}`, label, radio: true, checked: (group.color ?? null) === color, run: () => a.color(color) })
  return [
    { id: 'group.rename', label: t('ctx.renomear'), icon: Pencil, run: a.rename },
    { id: 'group.copy', label: t('ctx.copiar_elemento'), icon: Copy, run: a.copy },
    { id: 'group.color', label: t('ctx.cor'), icon: Palette, items: [swatch('neutral', t('ctx.cor_neutra'), null), ...NOTE_COLORS.map((c) => swatch(c, t(`ctx.cor.${c}` as MessageKey), noteLight(NOTE_COLOR_HEX[c]).fill))] },
    'separator',
    a.scores,
    'separator',
    { id: 'group.ungroup', label: t('ctx.desagrupar'), icon: Ungroup, run: a.ungroup }
  ]
}
