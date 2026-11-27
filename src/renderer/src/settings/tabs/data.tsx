import { useEffect,useState,type ReactNode } from 'react'
import type { BackupSnapshot,DataUsage,PreparedBackup } from '../../../../shared/data-settings'
import { SettingsModal,SettingsConfirm } from '../controls/SettingsModal'
import { OptionRow } from '../controls/OptionRow'
import { SettingsDivider,SettingsSection } from '../controls/Section'
import { optionsOf } from '../options'
import { fmt, getLocale, t, tr } from '../../i18n'
const PATH_MAX=46
/** Caminho longo cortado no meio: o fim (a pasta) é o que importa; o texto inteiro fica no título. */
export function shortPath(path:string):string{if(path.length<=PATH_MAX)return path;const head=Math.floor((PATH_MAX-1)/3);return path.slice(0,head)+'…'+path.slice(-(PATH_MAX-1-head))}
/** Hora do salvamento; de outro dia, a data vai junto. */
const timeOfSave=(iso?:string|null):string=>{if(!iso)return t('settings.tabs.data.nunca');const at=new Date(iso);return at.toDateString()===new Date().toDateString()?new Intl.DateTimeFormat(getLocale(),{timeStyle:'short'}).format(at):fmt().dateTime(at)}
const since=(iso?:string|null):string=>iso?fmt().relative((Date.parse(iso)-Date.now())/1000):t('settings.tabs.data.nunca')
function Row({label,children}:{label:string;children:ReactNode}){return <div className="data-row"><span className="settings-label">{label}</span>{children}</div>}
function StorageUsage({onError}:{onError(message:string):void}){
 const[usage,setUsage]=useState<DataUsage|null>(null),[failed,setFailed]=useState(false)
 useEffect(()=>{let alive=true;void Promise.resolve().then(()=>window.palco.dataSettings.usage()).then(v=>{if(alive)setUsage(v)}).catch(e=>{if(alive){setFailed(true);onError(e instanceof Error?e.message:t('settings.tabs.data.a_operacao_falhou'))}});return()=>{alive=false}},[])
 return <SettingsSection title={t('settings.tabs.data.uso_de_armazenamento')}>
  {!usage?!failed&&<p className="data-value" aria-busy="true">{t('settings.tabs.data.calculando')}</p>:<><Row label={t('settings.tabs.data.total')}><span className="data-value is-mono">{fmt().bytes(usage.total)}</span></Row>
   {usage.workspaces.length>0&&<ul className="data-usage-list">{usage.workspaces.map(w=><li key={w.id} className="data-row"><span className="settings-label">{w.name}</span><span className="data-value is-mono">{fmt().bytes(w.size)}</span></li>)}</ul>}</>}
 </SettingsSection>
}
export function DataTab({section}:{section:string}){
 const api=window.palco.dataSettings,[state,setState]=useState<Awaited<ReturnType<typeof window.palco.dataSettings.state>>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[manager,setManager]=useState(false),[expanded,setExpanded]=useState<string[]>([])
 const[confirm,setConfirm]=useState<{title:string;body:string;label:string;run():Promise<unknown>}|null>(null)
 const refresh=async()=>{setState(await api.state())}
 useEffect(()=>{let alive=true;void api.state().then(v=>{if(alive){setState(v);if(new Set(v.snapshots.map(s=>s.workspaceId)).size===1)setExpanded([...new Set(v.snapshots.map(s=>s.workspaceId))])}}).catch(e=>{if(alive)setError(e instanceof Error?e.message:t('settings.tabs.data.nao_foi_possivel_carregar_os_d'))});return()=>{alive=false}},[])
 const run=(job:()=>Promise<unknown>)=>{setBusy(true);setError('');void job().then(refresh).catch(e=>setError(e instanceof Error?e.message:t('settings.tabs.data.a_operacao_falhou'))).finally(()=>setBusy(false))}
 const restore=(p:PreparedBackup)=>setConfirm({title:p.kind==='workspace'?t('settings.tabs.data.restaurar_snapshot'):t('settings.tabs.data.substituir_espacos_de_trabalho'),body:t('settings.tabs.data.restaurar_corpo', { count: p.workspaceCount, date: fmt().dateTime(new Date(p.createdAt)) }),label:p.kind==='workspace'?t('settings.tabs.data.restaurar'):t('settings.tabs.data.substituir_espacos_de_trabalho_2'),run:()=>api.restore(p.token)})
 const reset=async()=>{const failed=await api.signOutAll();if(!failed.length)return api.reset();setConfirm({title:t('settings.tabs.data.algumas_contas_nao_puderam_sai'),body:t('settings.tabs.data.nao_foi_possivel_encerrar_os_l', { v1: failed.join(', ') }),label:t('settings.tabs.data.continuar'),run:()=>api.reset()})}
 const groups=[...new Set(state?.snapshots.map(s=>s.workspaceId)??[])]
 return <section aria-label={t('settings.tabs.data.dados')}>
  {error&&<p role="alert">{error}</p>}{state?.warning&&<p role="alert">{state.warning}</p>}
  {section==='Armazenamento'&&<>
   <SettingsSection title={t('settings.tabs.data.local_de_armazenamento')}>
    <Row label={t('settings.tabs.data.local')}>{state?<code className="data-path" title={state.root}>{shortPath(state.root)}</code>:<span className="data-value">{t('settings.tabs.data.carregando')}</span>}</Row>
    <div className="data-actions"><button type="button" disabled={busy} onClick={()=>run(async()=>{const path=await api.pickRoot();if(path)setConfirm({title:t('settings.tabs.data.alterar_raiz_de_dados'),body:t('settings.tabs.data.mover_os_dados_para_path_o_des', { path }),label:t('settings.tabs.data.alterar_e_reiniciar'),run:()=>api.moveRoot(path)})})}>{t('settings.tabs.data.alterar')}</button><button type="button" disabled={busy} onClick={()=>run(()=>api.showFolder())}>{t('settings.tabs.data.mostrar_na_pasta')}</button></div>
   </SettingsSection><SettingsDivider/>
   <StorageUsage onError={setError}/><SettingsDivider/>
   <SettingsSection title={t('settings.tabs.data.redefinir')}><div className="data-actions"><button type="button" className="is-destructive" disabled={busy} onClick={()=>setConfirm({title:t('settings.tabs.data.apagar_todos_os_dados'),body:t('settings.tabs.data.todos_os_espacos_de_trabalho_p'),label:t('settings.tabs.data.apagar_tudo'),run:reset})}>{t('settings.tabs.data.apagar_todos_os_dados_2')}</button></div></SettingsSection>
  </>}
  {section==='Backups'&&<>
   <SettingsSection title={t('settings.tabs.data.salvamento_automatico')}><Row label={t('settings.tabs.data.ultimo_salvamento')}><span className="data-value">{state?timeOfSave(state.lastSaveAt):t('settings.tabs.data.carregando')}</span></Row></SettingsSection><SettingsDivider/>
   <SettingsSection title={t('settings.tabs.data.backup_e_restauracao')}>
    <Row label={t('settings.tabs.data.ultimo_backup_automatico')}><span className="data-value" title={state?.lastBackupAt?fmt().dateTime(new Date(state.lastBackupAt)):undefined}>{state?since(state.lastBackupAt):t('settings.tabs.data.carregando')}</span></Row>
    <div className="data-actions is-split"><button type="button" disabled={busy} onClick={()=>{setManager(true);run(async()=>{})}}>{t('settings.tabs.data.gerenciar_backups')}</button><span className="data-actions-end"><button type="button" disabled={busy} onClick={()=>run(()=>api.exportZip())}>{t('settings.tabs.data.exportar_backup_completo')}</button><button type="button" disabled={busy} onClick={()=>run(async()=>{const p=await api.pickImport();if(p)restore(p)})}>{t('settings.tabs.data.importar_backup')}</button></span></div>
   </SettingsSection>
  </>}
  {section==='Armazenamento dos Portais'&&<SettingsSection title={tr(section)}>
   {optionsOf('data',section).map(o=><OptionRow key={o.key} def={o}/>)}
   <div className="data-shared"><div className="data-row"><span className="settings-label">{t('settings.tabs.data.dados_compartilhados')}</span><button type="button" className="is-destructive" aria-describedby="data-shared-note" disabled={busy} onClick={()=>setConfirm({title:t('settings.tabs.data.apagar_armazenamento_global'),body:t('settings.tabs.data.cookies_logins_cache_e_dados_d'),label:t('settings.tabs.data.limpar'),run:()=>api.clearGlobal()})}>{t('settings.tabs.data.apagar_armazenamento_global_2')}</button></div><small id="data-shared-note">{t('settings.tabs.data.dados_compartilhados_descricao')}</small></div>
  </SettingsSection>}
  {manager&&<SettingsModal title={t('settings.tabs.data.gerenciar_backups_2')} close={()=>{if(!busy)setManager(false)}}><h3>{t('settings.tabs.data.gerenciar_backups_2')}</h3><p><small>{t('settings.tabs.data.backups_automaticos_a_cada', { minutes: state?.backupIntervalMinutes??60 })} {t('settings.tabs.data.os_zips_nao_incluem_cookies_do')}</small></p>{error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={()=>run(()=>api.backupNow())}>{t('settings.tabs.data.fazer_backup_agora')}</button>{' '}<button disabled={busy} onClick={()=>run(()=>api.showFolder(true))}>{t('settings.tabs.data.mostrar_na_pasta')}</button>
   {!groups.length&&<p>{t('settings.tabs.data.ainda_nao_ha_snapshots')}</p>}{groups.map(id=>{const list=state!.snapshots.filter(s=>s.workspaceId===id),name=list[0]!.workspaceName;return<section key={id}><h4><button aria-expanded={expanded.includes(id)} onClick={()=>setExpanded(expanded.includes(id)?expanded.filter(x=>x!==id):[...expanded,id])}>{t('settings.tabs.data.mostrar_os_instantaneos_de', { name })}</button></h4><button disabled={busy} onClick={()=>setConfirm({title:t('settings.tabs.data.excluir_todos_os_snapshots'),body:t('settings.tabs.data.excluir_todos_os_snapshots_de_', { name }),label:t('settings.tabs.data.excluir_tudo'),run:()=>api.deleteGroup(id)})}>{t('settings.tabs.data.excluir_tudo')}</button>{expanded.includes(id)&&<ul>{list.map(s=><li key={s.id}>{fmt().dateTime(new Date(s.createdAt))} · {Math.ceil(s.size/1024)} {t('settings.tabs.data.kb')}{' '}<button disabled={busy} onClick={()=>run(async()=>restore(await api.prepareSnapshot(s.id)))}>{t('settings.tabs.data.restaurar')}</button>{' '}<button disabled={busy} onClick={()=>setConfirm({title:t('settings.tabs.data.apagar_snapshot'),body:t('settings.tabs.data.apagar_snapshot_de', { name, date: fmt().dateTime(new Date(s.createdAt)) }),label:t('settings.tabs.data.apagar'),run:()=>api.deleteSnapshot(s.id)})}>{t('settings.tabs.data.apagar')}</button></li>)}</ul>}</section>})}<button disabled={busy} onClick={()=>setManager(false)}>{t('settings.tabs.data.concluido')}</button>
  </SettingsModal>}
  {confirm&&<SettingsConfirm title={confirm.title} body={confirm.body} confirmLabel={confirm.label} danger onCancel={()=>setConfirm(null)} onConfirm={()=>{const job=confirm.run;setConfirm(null);run(job)}}/>}
 </section>
}
