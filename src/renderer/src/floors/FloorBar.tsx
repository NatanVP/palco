import { useDismissPopover } from '../canvas/useDismissPopover'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { GitMerge, Layers, Plus, X } from 'lucide-react'
import type { Floor, FloorId, Workspace } from '../../../shared/model'
import { floorTabs } from './floor-view'
import { t } from '../i18n'

interface Props {
  ws: Workspace
  open: boolean
  active: FloorId
  height: number
  busy: boolean
  onToggle(): void
  onPreview(id: FloorId): void
  onChoose(id: FloorId): void
  onCreate(): void
  onLand(floor: Floor): void
  onDelete(floor: Floor): void
}

/** Indicador inferior e lista vertical do overview; Ground não possui ação destrutiva. */
export function FloorBar({ ws, open, active, height, busy, onToggle, onPreview, onChoose, onCreate, onLand, onDelete }: Props) {
  useDismissPopover(open, onToggle, '.floor-indicator')
  const reduced = useReducedMotion()
  const tabs = floorTabs({ ...ws, activeFloor: active }).reverse()
  return <div className="floor-indicator" onPointerDown={e => e.stopPropagation()}>
    <button className={`floor-indicator-button${open ? ' active' : ''}`} aria-label={t('floors.FloorBar.andares')} aria-expanded={open} aria-haspopup="listbox" onClick={onToggle} onContextMenu={e => { e.preventDefault(); if (!open) onToggle() }}>
      <Layers size={13} strokeWidth={2.25} /><span>{open ? t('floors.FloorBar.andares') : active === null ? t('floors.FloorBar.ground') : ws.floors[active]?.name ?? t('floors.FloorBar.ground')}</span>
    </button>
    <div inert={!open}><AnimatePresence>
      {open && <motion.div key="floor-list" className="floor-overview-list" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : .25, ease: 'easeOut' } }} role="listbox" aria-label={t('floors.FloorBar.andares_do_workspace')} aria-busy={busy} style={{ maxHeight: Math.max(height * .7, 200) }}>
        {tabs.map((tab, index) => {
          const floor = tab.id === null ? undefined : ws.floors[tab.id]
          return <motion.div className={`floor-choice${tab.active ? ' active' : ''}`} key={tab.id ?? 'ground'} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : .25, ease: 'easeOut', delay: 0 } }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 631.654682, damping: 50.265482, mass: 1, delay: index * .03 }}>
            <button role="option" aria-selected={tab.active} data-floor-id={tab.id ?? 'ground'} title={tab.tooltip} onClick={() => onPreview(tab.id)} onDoubleClick={() => onChoose(tab.id)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onChoose(tab.id) } }}>
              <span className={`badge ${tab.status?.state ?? ''}`} /><span className="floor-choice-label"><span>{tab.label}</span>{tab.status?.text ? <small className="floor-status-line">{tab.status.text}</small> : floor?.branch ? <small>{floor.branch}</small> : null}</span>
            </button>
            {floor && tab.active && <span className="floor-choice-actions">
              <button aria-label={t('floors.FloorBar.integrar_name', { name: floor.name })} title={t('floors.FloorBar.integrar_andar')} disabled={busy} onClick={() => onLand(floor)}><GitMerge size={12} /></button>
              <button aria-label={t('floors.FloorBar.excluir_name', { name: floor.name })} title={t('floors.FloorBar.excluir_andar')} disabled={busy} onClick={() => onDelete(floor)}><X size={12} /></button>
            </span>}
          </motion.div>
        })}
        <button className="floor-overview-new" aria-label={t('floors.FloorBar.novo_andar')} disabled={busy} onClick={onCreate}><Plus size={10} />{t('floors.FloorBar.novo_andar')}</button>
      </motion.div>}
    </AnimatePresence></div>
  </div>
}
