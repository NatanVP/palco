import type { ReactNode } from 'react'
import { Folder, Globe, MousePointer2, Paperclip, Pencil, ScrollText, SquareTerminal, Type } from 'lucide-react'
import type { PlaceKind } from '../canvas/placement'
import { t } from '../i18n'

/** Ferramenta ativa do canvas: seleção, lápis ou um modo de colocação (desenha a área do nó novo). */
export type Tool = 'select' | 'draw' | PlaceKind

interface Props {
  tool: Tool
  onTool(tool: Tool): void
}

const placeTip = (): string => t('dock.Dock.place_tip')
const TOOLS: Array<{ tool: Exclude<Tool, 'select'>; title: string; icon: ReactNode }> = [
  { tool: 'terminal', get title() { return t('dock.Dock.terminal_ctrl_t_place_tip', { PLACE_TIP: placeTip() }) }, icon: <SquareTerminal size={18} /> },
  { tool: 'note', get title() { return t('dock.Dock.nota_place_tip', { PLACE_TIP: placeTip() }) }, icon: <ScrollText size={18} /> },
  { tool: 'file', get title() { return t('dock.Dock.arquivo_place_tip', { PLACE_TIP: placeTip() }) }, icon: <Paperclip size={18} /> },
  { tool: 'filetree', get title() { return t('dock.Dock.arvore_de_pastas_place_tip', { PLACE_TIP: placeTip() }) }, icon: <Folder size={18} /> },
  { tool: 'portal', get title() { return t('dock.Dock.portal_place_tip', { PLACE_TIP: placeTip() }) }, icon: <Globe size={18} /> },
  { tool: 'text', get title() { return t('dock.Dock.texto_place_tip', { PLACE_TIP: placeTip() }) }, icon: <Type size={18} /> },
  { tool: 'draw', get title() { return t('dock.Dock.desenho_barra_com_caneta_pince') }, icon: <Pencil size={18} /> }
]

/**
 * Dock flutuante no topo e no centro (top 12 px); a barra contextual fica logo abaixo. As ferramentas de criação não criam na hora:
 * ligam um modo em que o usuário arrasta a área no canvas (Esc ou a seta voltam para Seleção).
 */
export function Dock({ tool, onTool }: Props) {
  const button = (key: string, title: string, icon: ReactNode, onClick: () => void, active: boolean): ReactNode => (
    <button key={key} className={`dock-btn${active ? ' active' : ''}`} title={title} aria-label={title} aria-pressed={active} onClick={onClick}>
      {icon}
    </button>
  )

  return (
    <div className="dock" onPointerDown={(e) => e.stopPropagation()}>
      {button('select', t('dock.Dock.selecionar_esc_arraste_o_fundo'), <MousePointer2 size={18} />, () => onTool('select'), tool === 'select')}
      {TOOLS.map((t) => button(t.tool, t.title, t.icon, () => onTool(tool === t.tool ? 'select' : t.tool), tool === t.tool))}
    </div>
  )
}
