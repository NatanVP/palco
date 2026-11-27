import { t } from '../../i18n'
import{useEffect,useState}from'react'
import type{GitHostView}from'../../../../shared/about-git'
import{SettingsConfirm}from'../controls/SettingsModal'
const STATE:Record<GitHostView['state'],string>={get bundled() { return t('settings.tabs.git.integrado') },get modified() { return t('settings.tabs.git.modificado') },get outOfDate() { return t('settings.tabs.git.desatualizado') },get custom() { return t('settings.tabs.git.personalizado') },get requiresNewVersion() { return t('settings.tabs.git.requer_uma_versao_mais_recente') },get invalid() { return t('settings.tabs.git.invalido') }}
export function GitSettings(){
 const api=window.palco.gitHosts,[state,setState]=useState<{directory:string;providers:GitHostView[];missing:string[]}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState<GitHostView|null>(null),[checking,setChecking]=useState<string|null>(null)
 const refresh=async()=>setState(await api.state())
 useEffect(()=>{let alive=true;void api.state().then(v=>{if(alive)setState(v)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[])
 const run=(job:()=>Promise<unknown>)=>{setBusy(true);setError('');void job().then(refresh).catch(e=>setError(e instanceof Error?e.message:t('settings.tabs.git.a_operacao_falhou'))).finally(()=>{setBusy(false);setChecking(null)})}
 return<section aria-label={t('settings.tabs.git.provedores_de_pull_request')}><h3 className="settings-section-title">{t('settings.tabs.git.provedores_de_pull_request')}</h3>{error&&<p role="alert">{error}</p>}
  <p>{t('settings.tabs.git.as_clis_cuidam_da_autenticacao')}</p>
  {state?.providers.map(p=><article key={p.id}><h4>{p.name} · {STATE[p.state]}</h4><p>{p.command}{p.account?` · ${p.account.state==='connected'?t('settings.tabs.git.conectada'):p.account.state==='disconnected'?t('settings.tabs.git.nao_conectada'):t('settings.tabs.git.nao_foi_possivel_verificar')}`:''}{p.account?.detail?` · ${p.account.detail}`:''}</p>{p.problem&&<p>{p.problem}</p>}
   <button disabled={busy||!p.digest||['invalid','requiresNewVersion'].includes(p.state)} onClick={()=>{setChecking(p.id);run(()=>api.check(p.id))}}>{checking===p.id?t('settings.tabs.git.verificando'):t('settings.tabs.git.verificar')}</button>{' '}{(p.state==='modified'||p.state==='outOfDate'||p.integrated&&p.state!=='bundled'&&p.digest)&&<button disabled={busy} onClick={()=>setConfirm(p)}>{t('settings.tabs.git.restaurar_padrao')}</button>}
  </article>)}
  <p><code>{state?.directory??t('settings.tabs.git.carregando')}</code></p><button disabled={busy} onClick={()=>run(()=>api.copyPath())}>{t('settings.tabs.git.copiar_caminho')}</button>{' '}<button disabled={busy} onClick={()=>run(()=>api.showFolder())}>{t('settings.tabs.git.mostrar_pasta_de_provedores')}</button>{' '}<button disabled={busy||!state?.missing.length} onClick={()=>run(()=>api.restoreMissing())}>{t('settings.tabs.git.restaurar_provedores_integrado')}</button>{' '}<button disabled={busy} onClick={()=>run(()=>api.reload())}>{t('settings.tabs.git.recarregar')}</button>
  <p><small>{t('settings.tabs.git.adicione_um_arquivo_json_para_')}</small></p>
  {confirm&&<SettingsConfirm title={t('settings.tabs.git.restaurar_provedor')} body={t('settings.tabs.git.substituir_a_definicao_modific', { name: confirm.name })} confirmLabel={t('settings.tabs.git.restaurar')} danger onCancel={()=>setConfirm(null)} onConfirm={()=>{const p=confirm;setConfirm(null);run(()=>api.restore(p.id,p.digest!))}}/>}
 </section>
}
