import { Fragment, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Group } from 'lucide-react'
import { MAX_GROUP_NAME } from '../../../../shared/groups'
import { t } from '../../i18n'
import './groups.css'

export interface GroupView { id: string; name: string; color?: string; frame: { x: number; y: number; w: number; h: number } }

interface Props {
  groups: GroupView[]
  renaming: string | null
  onRenaming(id: string | null): void
  onRename(id: string, name: string): void
  onHeaderDown(id: string, e: ReactPointerEvent): void
}

/** Nome do grupo em edição: Enter ou sair grava (vazio vale), Escape desiste. */
function RenameInput({ name, onDone }: { name: string; onDone(next: string | null): void }) {
  const done = useRef(false)
  const finish = (next: string | null): void => { if (done.current) return; done.current = true; onDone(next) }
  return (
    <input
      className="group-rename" autoFocus defaultValue={name} maxLength={MAX_GROUP_NAME} aria-label={t('groups.rename')} placeholder={t('groups.untitled')}
      onFocus={(e) => e.target.select()} onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        else if (e.key === 'Escape') finish(null)
      }}
    />
  )
}

/** Moldura tracejada e cabeçalho de cada grupo, em coordenadas de tela (o cabeçalho não escala com o zoom). */
export function GroupFrames({ groups, renaming, onRenaming, onRename, onHeaderDown }: Props) {
  if (!groups.length) return null
  return (
    <div className="group-layer">
      {groups.map((g) => {
        const tint = (g.color ? { '--group-border': `${g.color}bf`, '--group-fill': `${g.color}1f` } : {}) as CSSProperties
        return (
          <Fragment key={g.id}>
            <div className="group-frame" aria-hidden="true" style={{ left: g.frame.x, top: g.frame.y, width: g.frame.w, height: g.frame.h, ...tint }} />
            <div className="group-head" data-group-id={g.id} style={{ left: g.frame.x, top: g.frame.y, ...tint }}>
              {renaming === g.id
                ? <RenameInput name={g.name} onDone={(next) => { onRenaming(null); if (next !== null && next.trim() !== g.name) onRename(g.id, next.trim()) }} />
                : (
                  <button
                    type="button" className="group-header" aria-label={g.name || t('groups.untitled')}
                    onPointerDown={(e) => onHeaderDown(g.id, e)}
                    onDoubleClick={(e) => { e.stopPropagation(); onRenaming(g.id) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onRenaming(g.id) } }}
                  >
                    <Group size={12} aria-hidden="true" /><span>{g.name || t('groups.untitled')}</span>
                  </button>
                )}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
