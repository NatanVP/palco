import './agent-libraries.css'
import { Glyph, WORKSPACE_ICONS } from '../../sidebar/workspace-icons'
import { TerminalIcon } from '../../nodes/terminal-icons'
import { ALL, GLOBAL, PickerList, ScopePills, pickerView, type ScopeFilter, type Workspace } from './library-picker'
import { RoleEditor, ROLE_ICON } from './role-editor'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Circle, CircleCheck, FileText, FolderOpen, Plus, RotateCcw, SquarePen, Trash2, TriangleAlert } from 'lucide-react'
import { SkillEditor, SKILL_ICON } from './skill-editor'
import { CopyPathButton } from './copy-path'
import type { PromptDraft, SavedPromptMeta, RoleDraft, RoleEntry, SkillBase, SkillDraft } from '../../../../shared/agent-libraries'
import { SettingsModal as LibraryModal, SettingsConfirm as LibraryConfirm } from '../controls/SettingsModal'
import { t } from '../../i18n'

function useWorkspaces() {
 const [state, setState] = useState<{ workspaces: Workspace[]; active: string | null }>({ workspaces: [], active: null })
 useEffect(() => {
  let alive = true
  const put = (s: { workspaces: Workspace[]; active?: string }): void => { if (alive) setState({ workspaces: s.workspaces, active: s.active ?? null }) }
  const off = window.palco.workspaces.onSidebar(put)
  void window.palco.workspaces.sidebar().then(put).catch(() => {})
  return () => { alive = false; off() }
 }, [])
 return state
}
/**
 * Uma operação da aba: conta as pendentes (a lista só destrava quando todas terminam) e relê também depois de uma falha,
 * porque parte do trabalho pode ter ido para o disco e a tela precisa mostrar o que existe.
 */
function useRun(refresh: () => Promise<void>, setError: (value: string) => void) {
 const [busy, setBusy] = useState(false), pending = useRef(0)
 const run = (fn: () => Promise<unknown>): void => {
  pending.current++; setBusy(true); setError('')
  const fail = (e: unknown): void => setError(message(e))
  void fn().catch(fail).then(refresh).catch(fail).finally(() => { if (--pending.current === 0) setBusy(false) })
 }
 return { busy, run }
}
/** Onde o item novo nasce: no espaço da pílula; em Global, global; em Todos, no espaço atual. */
const newScope = (filter: ScopeFilter, active: string | null): string | null => filter === ALL ? active : filter === GLOBAL ? null : filter
function RoleGlyph({ icon, color }: { icon?: string | undefined; color?: string | undefined }) {
 const name = icon || ROLE_ICON
 return WORKSPACE_ICONS[name] ? <Glyph icon={name} color={color} size={15} /> : <TerminalIcon icon={name} size={15} {...(color ? { color } : {})} />
}
function Scope({ value, change, workspaces }: { value: string; change(value: string): void; workspaces: Workspace[] }) {
 return <label>{t('settings.tabs.agent-libraries.espaco_de_trabalho')}<select value={value} onChange={e => change(e.target.value)}><option value="">{t('settings.tabs.agent-libraries.global_todos_os_espacos_de_tra')}</option>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}{value && !workspaces.some(w => w.id === value) && <option value={value}>{t('settings.tabs.agent-libraries.espaco_removido', { id: value })}</option>}</select></label>
}
const message = (e: unknown): string => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : t('settings.tabs.agent-libraries.nao_foi_possivel_concluir_a_op')

export function PromptsSettings() {
 const { workspaces, active } = useWorkspaces(), [items, setItems] = useState<SavedPromptMeta[]>([]), [bodies, setBodies] = useState<Record<string, string>>({}), [problems, setProblems] = useState<Array<{ id: string; reason: string }>>([])
 const [search, setSearch] = useState(''), [scope, setScope] = useState<ScopeFilter>(ALL), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState(''), [draft, setDraft] = useState<PromptDraft | null>(null), [undo, setUndo] = useState<string | null>(null), [folder, setFolder] = useState<{ scope: ScopeFilter; path: string } | null>(null)
 const alive = useRef(true), revision = useRef(0)
 /** A lista traz só os metadados; o texto (para a descrição aberta e a busca) vem prompt a prompt. */
 const refresh = async (): Promise<void> => {
  const turn = ++revision.current, value = await window.palco.prompts.list()
  if (!alive.current || turn !== revision.current) return
  setItems(value.items); setProblems(value.problems)
  const texts = await Promise.all(value.items.map(p => Promise.resolve().then(() => window.palco.prompts.read(p.id)).then(r => [p.id, r.body] as const).catch(() => [p.id, ''] as const)))
  if (alive.current && turn === revision.current) setBodies(Object.fromEntries(texts))
 }
 useEffect(() => {
  alive.current = true
  const load = (): void => { void refresh().catch(e => { if (alive.current) setError(message(e)) }) }
  // Os arquivos podem ter sido editados por fora (é para isso que o caminho é copiado): relê quando a janela volta.
  load(); window.addEventListener('focus', load)
  return () => { alive.current = false; window.removeEventListener('focus', load) }
 }, [])
 const workspaceScope = scope === ALL || scope === GLOBAL ? null : scope
 useEffect(() => {
  let current = true
  void Promise.resolve().then(() => window.palco.prompts.directory(workspaceScope)).then(path => { if (current) setFolder({ scope, path }) }).catch(() => { if (current) setFolder(null) })
  return () => { current = false }
 }, [scope])
 const { busy, run } = useRun(refresh, setError)
 const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
 const view = pickerView(sorted.map(p => ({ id: p.id, name: p.name, workspaceId: p.workspaceId, description: bodies[p.id] ?? '', haystack: `${p.name} ${p.description} ${bodies[p.id] ?? ''}`, icon: <FileText size={15} className="library-muted" aria-hidden="true" /> })), workspaces, scope, search, t('settings.agentes.espaco_indisponivel'))
 const edit = (id: string): void => run(async () => setDraft(await window.palco.prompts.read(id)))
 return <section aria-label={t('settings.tabs.agent-libraries.prompts_salvos')} className="settings-agent-library">
  <p className="settings-hint">{t('settings.agentes.intro_prompts')}</p>
  {error && !draft && <p role="alert">{error}</p>}
  <div className="library-picker">
   <input className="library-search" placeholder={t('settings.tabs.agent-libraries.buscar_prompts')} aria-label={t('settings.tabs.agent-libraries.buscar_prompts_2')} value={search} onChange={e => setSearch(e.target.value)} />
   <ScopePills workspaces={view.pills} value={scope} onChange={setScope} label={t('settings.agentes.filtrar_prompts')} />
   <PickerList sections={view.sections} selected={selected} disabled={busy} labels={{ list: t('settings.tabs.agent-libraries.prompts_salvos'), newItem: t('settings.tabs.agent-libraries.novo_prompt'), editItem: t('settings.tabs.agent-libraries.editar_prompt') }}
    onSelect={setSelected} onCreate={() => { setError(''); setDraft({ name: '', description: '', body: '', workspaceId: newScope(scope, active) }) }} onEdit={edit} onDelete={ids => run(async () => setUndo(await window.palco.prompts.remove(ids[0]!)))} />
  </div>
  <div role="status" className="library-undo">{undo && <><span>{t('settings.tabs.agent-libraries.prompt_excluido')}</span><button type="button" className="is-ghost" disabled={busy} onClick={() => run(async () => { await window.palco.prompts.undo(undo); setUndo(null) })}>{t('settings.tabs.agent-libraries.desfazer')}</button></>}</div>
  {problems.length > 0 && <aside role="alert" className="library-problems"><p>{t('settings.tabs.agent-libraries.alguns_arquivos_da_pasta_de_pr')}</p><ul>{problems.map(p => <li key={p.id}><TriangleAlert size={12} aria-hidden="true" /><code>{p.id}</code><span>{p.reason}</span></li>)}</ul></aside>}
  <div className="library-folder">
   <button type="button" disabled={busy} onClick={() => run(() => window.palco.prompts.showFolder(workspaceScope))}><FolderOpen size={12} aria-hidden="true" />{t('settings.tabs.agent-libraries.mostrar_pasta_de_prompts')}</button>
   <CopyPathButton path={folder?.scope === scope ? folder.path : null} onError={setError} />
  </div>
  <p className="settings-hint library-folder-hint">{t('settings.agentes.ajuda_pasta_de_prompts')}</p>
  {draft && <LibraryModal title={draft.id ? t('settings.tabs.agent-libraries.editar_prompt') : t('settings.tabs.agent-libraries.novo_prompt')} close={() => { if (!busy) setDraft(null) }}><form aria-label={draft.id ? t('settings.tabs.agent-libraries.editar_prompt') : t('settings.tabs.agent-libraries.novo_prompt')} onSubmit={e => { e.preventDefault(); run(async () => { await window.palco.prompts.save(draft); setDraft(null); setUndo(null) }) }}>
   <h3>{draft.id ? t('settings.tabs.agent-libraries.editar_prompt') : t('settings.tabs.agent-libraries.novo_prompt')}</h3>{error && <p role="alert">{error}</p>}
   <label>{t('settings.tabs.agent-libraries.nome')}<input required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
   <label>{t('settings.tabs.agent-libraries.descricao_opcional')}<input maxLength={2000} value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
   <label>{t('settings.tabs.agent-libraries.prompt')}<textarea required rows={12} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
   <p>{t('settings.tabs.agent-libraries.salvar_em')}</p><Scope value={draft.workspaceId ?? ''} change={v => setDraft({ ...draft, workspaceId: v || null })} workspaces={workspaces} />
   <small>{t('settings.tabs.agent-libraries.sera_salvo_como', { id: `${draft.workspaceId ? `${draft.workspaceId}/` : ''}${draft.id?.slice(draft.id.indexOf('/') + 1) ?? (draft.name.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-') || t('settings.tabs.agent-libraries.nome_do_prompt'))}` })}</small>
   <div><button disabled={busy} type="submit">{t('settings.tabs.agent-libraries.salvar')}</button><button disabled={busy} type="button" onClick={() => setDraft(null)}>{t('settings.tabs.agent-libraries.cancelar')}</button></div>
  </form></LibraryModal>}
 </section>
}

export function RolesSettings() {
 const { workspaces, active } = useWorkspaces(), [items, setItems] = useState<RoleEntry[]>([]), [search, setSearch] = useState(''), [scope, setScope] = useState<ScopeFilter>(ALL), [error, setError] = useState('')
 const [selected, setSelected] = useState<string[]>([]), [removing, setRemoving] = useState<string[] | null>(null), [draft, setDraft] = useState<RoleDraft | null>(null)
 const refresh = async (): Promise<void> => { setItems(await window.palco.roles.list()) }
 useEffect(() => { let alive = true; void window.palco.roles.list().then(v => { if (alive) setItems(v) }).catch(e => { if (alive) setError(message(e)) }); return () => { alive = false } }, [])
 const { busy, run } = useRun(refresh, setError)
 const terminalCount = items.filter(r => removing?.includes(r.name)).reduce((n, r) => n + (r.terminalCount ?? 0), 0)
 const view = pickerView(items.map(r => ({ id: r.name, name: r.displayName, workspaceId: r.workspaceId, description: r.text, haystack: r.displayName, usage: r.terminalCount, icon: <RoleGlyph icon={r.icon} color={r.color} /> })), workspaces, scope, search)
 const edit = (name: string): void => { const r = items.find(x => x.name === name); if (r) { setError(''); setDraft({ id: r.name, name: r.displayName, text: r.text, workspaceId: r.workspaceId, icon: r.icon, color: r.color }) } }
 return <section aria-label={t('settings.tabs.agent-libraries.responsabilidades_de_agentes')} className="settings-agent-library">
  {draft ? <RoleEditor initial={draft} existing={items} workspaces={workspaces} busy={busy} error={error} onCancel={() => { setDraft(null); setError('') }} onSave={value => run(async () => { await window.palco.roles.save(value); setDraft(null) })} /> : <>
   <p className="settings-hint">{t('settings.agentes.intro_responsabilidades')}</p>
   {error && <p role="alert">{error}</p>}
   <div className="library-picker">
    <input className="library-search" placeholder={t('settings.tabs.agent-libraries.buscar_responsabilidades')} aria-label={t('settings.tabs.agent-libraries.buscar_responsabilidades_2')} value={search} onChange={e => setSearch(e.target.value)} />
    <ScopePills workspaces={view.pills} value={scope} onChange={setScope} label={t('settings.agentes.filtrar_responsabilidades')} />
    <PickerList sections={view.sections} selected={selected} multi disabled={busy} labels={{ list: t('settings.tabs.agent-libraries.responsabilidades_de_agentes'), newItem: t('settings.tabs.agent-libraries.nova_responsabilidade'), editItem: t('settings.tabs.agent-libraries.editar_responsabilidade') }}
     onSelect={setSelected} onCreate={() => { setError(''); setDraft({ name: '', text: '', workspaceId: newScope(scope, active) }) }} onEdit={edit} onDelete={setRemoving} />
   </div>
  </>}
  {removing && <LibraryConfirm title={t('settings.tabs.agent-libraries.excluir_responsabilidade')} body={`${t('settings.tabs.agent-libraries.excluir_n_responsabilidades_pergunta', { count: removing.length })} ${terminalCount ? t('settings.tabs.agent-libraries.terminais_serao_desatribuidos', { count: terminalCount }) : t('settings.tabs.agent-libraries.nenhum_terminal_sera_afetado')} ${t('settings.tabs.agent-libraries.referencias_removidas')}`} confirmLabel={t('settings.tabs.agent-libraries.excluir_length_responsabilidad', { length: removing.length })} danger onCancel={() => setRemoving(null)} onConfirm={() => { const names = removing; setRemoving(null); run(async () => { await window.palco.roles.remove(names); setSelected(s => s.filter(n => !names.includes(n))) }) }} />}
 </section>
}

export function SkillsSettings() {
 const [items, setItems] = useState<SkillBase[]>([]), [error, setError] = useState(''), [draft, setDraft] = useState<SkillDraft | null>(null), [remove, setRemove] = useState<SkillBase | null>(null), [resetting, setResetting] = useState(false)
 const refresh = async (): Promise<void> => { setItems(await window.palco.skills.list()) }
 useEffect(() => { let alive = true; void window.palco.skills.list().then(v => { if (alive) setItems(v) }).catch(e => { if (alive) setError(message(e)) }); return () => { alive = false } }, [])
 const { busy, run } = useRun(refresh, setError)
 const move = (i: number, delta: number): void => { const ids = items.map(b => b.id); [ids[i], ids[i + delta]] = [ids[i + delta]!, ids[i]!]; run(() => window.palco.skills.reorder(ids)) }
 const fields = (b: SkillBase): SkillDraft => ({ id: b.id, name: b.name, path: b.display ?? b.path, enabled: b.enabled, icon: b.icon || SKILL_ICON })
 return <section aria-label={t('settings.tabs.agent-libraries.locais_dos_skills')} className="settings-agent-library">
  {draft ? <SkillEditor initial={draft} existing={items} busy={busy} error={error} onCancel={() => { setDraft(null); setError('') }} onSave={value => run(async () => { await window.palco.skills.save(value); setDraft(null) })} /> : <>
   <p className="settings-hint">{t('settings.agentes.intro_skills')}</p>
   {error && <p role="alert">{error}</p>}
   {items.length ? <ul className="preset-card" aria-label={t('settings.tabs.agent-libraries.locais_dos_skills')}>{items.map((b, i) => <li key={b.id} className={b.enabled ? '' : 'inactive'}>
    <button type="button" role="checkbox" className="preset-active" aria-checked={b.enabled} aria-label={`${t('settings.tabs.agent-libraries.ativar')} ${b.name}`} disabled={busy} onClick={() => run(() => window.palco.skills.save({ ...fields(b), path: b.path, enabled: !b.enabled }))}>{b.enabled ? <CircleCheck size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}</button>
    <span className="preset-icon"><TerminalIcon icon={b.icon || SKILL_ICON} size={16} /></span>
    <span className="preset-text"><span className="preset-name">{b.name}</span><span className="preset-command skill-path" title={b.path}>{b.display ?? b.path}</span>{(b.unavailable || !!b.conflicts?.length) && <span className="skill-conflict" role="status">{b.unavailable ? t('settings.agentes.caminho_recusado') : t('settings.agentes.skills_nao_instaladas', { names: b.conflicts!.join(', ') })}</span>}</span>
    <span className="preset-actions">
     <button type="button" disabled={busy || i === 0} aria-label={t('settings.tabs.agent-libraries.mover_name_para_cima', { name: b.name })} onClick={() => move(i, -1)}><ChevronUp size={16} aria-hidden="true" /></button>
     <button type="button" disabled={busy || i === items.length - 1} aria-label={t('settings.tabs.agent-libraries.mover_name_para_baixo', { name: b.name })} onClick={() => move(i, 1)}><ChevronDown size={16} aria-hidden="true" /></button>
     <button type="button" disabled={busy} aria-label={t('settings.tabs.presets-panel.editar_name', { name: b.name })} onClick={() => { setError(''); setDraft(fields(b)) }}><SquarePen size={14} aria-hidden="true" /></button>
     <button type="button" disabled={busy} aria-label={t('settings.tabs.presets-panel.excluir_name', { name: b.name })} onClick={() => setRemove(b)}><Trash2 size={14} aria-hidden="true" /></button>
    </span>
   </li>)}</ul> : <p className="skill-empty">{t('settings.agentes.nenhum_local')}</p>}
   <div className="preset-footer"><button type="button" disabled={busy} onClick={() => { setError(''); setDraft({ name: '', path: '', enabled: true }) }}><Plus size={14} aria-hidden="true" />{t('settings.tabs.agent-libraries.adicionar_caminho_personalizad')}</button>
    <button type="button" className="is-ghost" disabled={busy} onClick={() => setResetting(true)}><RotateCcw size={14} aria-hidden="true" />{t('settings.controls.OptionRow.redefinir_para_padrao')}</button></div>
   <p className="settings-hint">{t('settings.agentes.vale_na_hora')}</p>
  </>}
  {remove && <LibraryConfirm title={t('settings.tabs.agent-libraries.excluir_caminho_do_skill')} body={t('settings.tabs.agent-libraries.excluir_name_e_remover_somente', { name: remove.name })} confirmLabel={t('settings.tabs.agent-libraries.excluir')} danger onCancel={() => setRemove(null)} onConfirm={() => { const id = remove.id; setRemove(null); run(() => window.palco.skills.remove(id)) }} />}
  {resetting && <LibraryConfirm title={t('settings.agentes.redefinir_skills_titulo')} body={t('settings.agentes.redefinir_skills_corpo')} confirmLabel={t('settings.preset.redefinir')} danger onCancel={() => setResetting(false)} onConfirm={() => { setResetting(false); run(() => window.palco.skills.reset()) }} />}
 </section>
}
