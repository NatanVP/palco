import { shortcutLabel, usePreferences, matchesShortcut, getPreferences } from '../settings/preferences'
import { menuShortcut } from './top-menu'
import { useEffect, useState } from 'react'
import { BookOpen, CalendarClock, Check, Ellipsis, Menu, PanelLeft, Settings } from 'lucide-react'
import { t } from '../i18n'
import type { WorkspaceMeta } from '../../../shared/model'
import { Glyph, useWorkspaceImage } from '../sidebar/workspace-icons'

interface Props {
  sidebarHidden: boolean
  onToggleSidebar(): void
  workspaceName: string
  /** O workspace atual, para o ícone da pílula (barra recolhida). */
  workspace?: Pick<WorkspaceMeta, 'id' | 'icon' | 'color'> | undefined
  onRoutines(): void
  onPartituras(): void
  onSettings?(): void
  /** Modo mini ligado com a barra recolhida: o trilho está na tela (marca o item do menu). */
  railOn: boolean
  onToggleRail(): void
}

/** Com a barra recolhida: o workspace atual (ícone e nome) ao lado do menu; o clique abre a barra. */
function WorkspacePill({ name, workspace, onClick }: { name: string; workspace: Props['workspace']; onClick(): void }) {
  const image = useWorkspaceImage(workspace?.id ?? '')
  return (
    <button type="button" className="glass-pill ws-pill" title={t('canvas.TopBar.mostrar_barra_lateral')} onClick={onClick}>
      <span className="ws-pill-icon" style={{ color: workspace?.color ?? 'var(--primary)' }}><Glyph icon={workspace?.icon} color={workspace?.color} image={image} size={16} /></span>
      <span className="ws-pill-name">{name}</span>
    </button>
  )
}

/**
 * Topo flutuante sobre o canvas, sem barra opaca: pílula à esquerda (barra lateral e menu "…")
 * e o botão redondo de Partituras à direita.
 */
export function TopBar({ sidebarHidden, onToggleSidebar, workspaceName, workspace, onRoutines, onPartituras, onSettings, railOn, onToggleRail }: Props) {
  usePreferences()
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    if (!menu) return
    const close = (e: KeyboardEvent): void => { if (matchesShortcut('cancel', e)) setMenu(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menu])

  return (
    <>
      <div className="top-left" onPointerDown={(e) => e.stopPropagation()}>
        <div className="glass-pill">
          <button type="button" className="glass-btn" aria-expanded={!sidebarHidden} title={t(sidebarHidden ? 'canvas.TopBar.mostrar_barra_lateral_atalho' : 'canvas.TopBar.ocultar_barra_lateral_atalho', { shortcut: shortcutLabel('toggleSidebar') })} aria-label={sidebarHidden ? t('canvas.TopBar.mostrar_barra_lateral') : t('canvas.TopBar.ocultar_barra_lateral')} onClick={onToggleSidebar}>
            <Menu size={20} />
          </button>
          <span className="top-menu-anchor">
            <button type="button" className="glass-btn" title={t('canvas.TopBar.mais')} aria-label={t('canvas.TopBar.mais')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <Ellipsis size={20} />
            </button>
            {menu && (
              <>
                <div className="top-menu-back" onPointerDown={() => setMenu(false)} />
                <div className="top-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); onSettings?.() }}>
                    <Settings size={15} aria-hidden="true" /><span>{t('canvas.TopBar.configuracoes')}</span>
                    <small>{menuShortcut(getPreferences().shortcuts.settings[0], /Mac|iPhone|iPad/.test(navigator.platform))}</small>
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); onRoutines() }}>
                    <CalendarClock size={15} aria-hidden="true" /><span>{t('canvas.TopBar.rotinas')}</span>
                  </button>
                  <button type="button" role="menuitemcheckbox" aria-checked={railOn} onClick={() => { setMenu(false); onToggleRail() }}>
                    <PanelLeft size={15} aria-hidden="true" /><span>{t('canvas.TopBar.alternar_mini_barra_lateral')}</span>
                    {railOn && <Check size={14} aria-hidden="true" className="top-menu-check" />}
                  </button>
                </div>
              </>
            )}
          </span>
        </div>
        {sidebarHidden && <WorkspacePill name={workspaceName} workspace={workspace} onClick={onToggleSidebar} />}
      </div>
      <div className="top-right" onPointerDown={(e) => e.stopPropagation()}>
        <span className="round-holder">
          <button type="button" className="round-btn" title={t('canvas.TopBar.partituras_atalho', { shortcut: shortcutLabel('partituras') })} aria-label={t('canvas.TopBar.partituras')} onClick={onPartituras}>
            <BookOpen size={16} />
          </button>
        </span>
      </div>
    </>
  )
}
