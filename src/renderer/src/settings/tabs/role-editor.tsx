import { useId, useState } from 'react'
import type { RoleDraft, RoleEntry } from '../../../../shared/agent-libraries'
import { ColorRow, IconPicker } from './preset-editor'
import type { Workspace } from './library-picker'
import { t } from '../../i18n'

export const ROLE_ICON = 'contact'
export const ROLE_COLOR = '#007AFF'

/** Nova/Editar Responsabilidade: abre dentro da aba, no lugar da lista. */
export function RoleEditor({ initial, existing, workspaces, busy, error, onSave, onCancel }: { initial: RoleDraft; existing: RoleEntry[]; workspaces: Workspace[]; busy: boolean; error: string; onSave(draft: RoleDraft): void; onCancel(): void }) {
  const [draft, setDraft] = useState<RoleDraft>({ ...initial, icon: initial.icon || ROLE_ICON, color: initial.color || ROLE_COLOR })
  const id = useId()
  const title = draft.id ? t('settings.tabs.agent-libraries.editar_responsabilidade') : t('settings.tabs.agent-libraries.nova_responsabilidade')
  const name = draft.name.trim().toLocaleLowerCase()
  const taken = !!name && existing.some(r => r.name !== draft.id && r.displayName.trim().toLocaleLowerCase() === name)
  const valid = !!name && !!draft.text.trim() && !taken
  const removed = draft.workspaceId !== null && !workspaces.some(w => w.id === draft.workspaceId)
  return <form className="preset-editor" aria-label={title} data-inline-editor="" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) onCancel() } }}
    onSubmit={e => { e.preventDefault(); if (valid && !busy) onSave({ ...draft, name: draft.name.trim() }) }}>
    <h3>{title}</h3>
    <label className="preset-field"><span>{t('settings.preset.nome')}</span><input autoFocus aria-label={t('settings.tabs.agent-libraries.nome_da_responsabilidade')} aria-invalid={taken} maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    {taken && <p role="alert">{t('settings.agentes.nome_repetido')}</p>}
    <label className="preset-field"><span>{t('settings.tabs.agent-libraries.instrucoes')}</span><textarea rows={5} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label>
    {(workspaces.length > 0 || removed) && <label className="preset-field" htmlFor={id}><span>{t('settings.tabs.agent-libraries.espaco_de_trabalho')}</span>
      <select id={id} value={draft.workspaceId ?? ''} onChange={e => setDraft({ ...draft, workspaceId: e.target.value || null })}>
        <option value="">{t('settings.tabs.agent-libraries.global_todos_os_espacos_de_tra')}</option>
        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        {removed && <option value={draft.workspaceId!}>{t('settings.tabs.agent-libraries.espaco_removido', { id: draft.workspaceId! })}</option>}
      </select></label>}
    <IconPicker value={draft.icon!} onPick={icon => setDraft(d => ({ ...d, icon }))} />
    <ColorRow value={draft.color!} onPick={color => setDraft(d => ({ ...d, color }))} />
    <p><small>{t('settings.tabs.agent-libraries.as_instrucoes_sao_aplicadas_no')}</small></p>
    {error && <p role="alert">{error}</p>}
    <div className="preset-editor-footer"><button type="button" className="is-ghost" disabled={busy} onClick={onCancel}>{t('settings.tabs.presets-panel.cancelar')}</button>
      <button type="submit" className="is-primary" disabled={!valid || busy}>{t('settings.tabs.presets-panel.salvar')}</button></div>
  </form>
}
