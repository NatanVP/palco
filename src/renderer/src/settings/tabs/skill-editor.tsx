import { useState } from 'react'
import type { SkillBase, SkillDraft } from '../../../../shared/agent-libraries'
import { IconPicker } from './preset-editor'
import { t } from '../../i18n'

export const SKILL_ICON = 'folder'
/** O caminho sem `~/` e sem barras sobrando, para comparar o digitado com o que já existe. */
const plain = (path: string): string => path.trim().replace(/^~\//, '').replace(/(?<=.)\/+$/, '')

/** Novo/Editar local de skill: abre dentro da aba, no lugar da lista. O main valida de novo (links, pasta do app). */
export function SkillEditor({ initial, existing, busy, error, onSave, onCancel }: { initial: SkillDraft; existing: SkillBase[]; busy: boolean; error: string; onSave(draft: SkillDraft): void; onCancel(): void }) {
  const [draft, setDraft] = useState<SkillDraft>({ ...initial, icon: initial.icon || SKILL_ICON })
  const title = draft.id ? t('settings.tabs.agent-libraries.editar_caminho_do_skill') : t('settings.tabs.agent-libraries.novo_caminho_de_skill')
  const path = plain(draft.path)
  const problem = !path ? null
    : path.includes('..') ? t('settings.agentes.caminho_com_pontos')
    : !/^[\p{L}\p{N}/._-]+$/u.test(path) ? t('settings.agentes.caminho_com_caracteres')
    : existing.some(b => b.id !== draft.id && [b.path, b.display ?? b.path].some(p => plain(p) === path)) ? t('settings.agentes.caminho_repetido') : null
  const valid = !!draft.name.trim() && !!path && !problem
  return <form className="preset-editor" aria-label={title} data-inline-editor="" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) onCancel() } }}
    onSubmit={e => { e.preventDefault(); if (valid && !busy) onSave({ ...draft, name: draft.name.trim(), path: draft.path.trim() }) }}>
    <h3>{title}</h3>
    <label className="preset-field"><span>{t('settings.preset.nome')}</span><input autoFocus aria-label={t('settings.tabs.agent-libraries.nome')} maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    <label className="preset-field"><span>{t('settings.tabs.agent-libraries.caminho')}</span><input className="is-mono" aria-label={t('settings.tabs.agent-libraries.caminho')} aria-invalid={!!problem} spellCheck={false} placeholder="~/.claude/skills" value={draft.path} onChange={e => setDraft({ ...draft, path: e.target.value })} /></label>
    {problem && <p role="alert">{problem}</p>}
    <label className="preset-field"><span>{t('settings.tabs.agent-libraries.caminho_ssh')}</span><input className="is-mono" disabled placeholder={t('settings.tabs.agent-libraries.instalacao_de_skills_em_hosts_')} /></label>
    <IconPicker value={draft.icon!} onPick={icon => setDraft(d => ({ ...d, icon }))} />
    {error && <p role="alert">{error}</p>}
    <div className="preset-editor-footer"><button type="button" className="is-ghost" disabled={busy} onClick={onCancel}>{t('settings.tabs.presets-panel.cancelar')}</button>
      <button type="submit" className="is-primary" disabled={!valid || busy}>{t('settings.tabs.presets-panel.salvar')}</button></div>
  </form>
}
