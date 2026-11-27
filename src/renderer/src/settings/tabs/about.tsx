import { t } from '../../i18n'
import{useEffect,useId,useState}from'react'
import{ChevronRight}from'lucide-react'
import{SettingsModal}from'../controls/SettingsModal'
import{SettingsDivider,SettingsSection}from'../controls/Section'
import './about.css'

type Notices=typeof import('../../../../shared/third-party-notices.json')

/** Um pacote por linha; o texto da licença só entra na tela quando pedem. */
function PackageRow({item,texts}:{item:Notices['packages'][number];texts:string[]}){
 const[open,setOpen]=useState(false),id=useId()
 return<li><button type="button" className="third-party-row" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><ChevronRight size={11} aria-hidden="true"/><span className="third-party-name">{item.name}</span><span className="third-party-meta">{item.version} · {item.license}</span></button>
  <div id={id}>{open&&<>{'note' in item&&item.note&&<small>{item.note}</small>}<pre>{item.texts.map(i=>texts[i]).join('\n')}</pre></>}</div></li>
}
function Acknowledgements({onError}:{onError(job:()=>Promise<unknown>):void}){
 const[open,setOpen]=useState(false),[notices,setNotices]=useState<Notices|null>(null),id=useId()
 // O inventário é grande: carrega só quando a seção abre.
 useEffect(()=>{if(!open||notices)return;let alive=true;onError(async()=>{const loaded=await import('../../../../shared/third-party-notices.json');if(alive)setNotices(loaded.default)});return()=>{alive=false}},[open])
 return<section className="settings-section" aria-label={t('settings.tabs.about.agradecimentos')}>
  <h3 className="settings-section-title"><button type="button" className="about-disclosure" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><ChevronRight size={12} aria-hidden="true"/>{t('settings.tabs.about.agradecimentos')}</button></h3>
  <div id={id} className="settings-section-body" hidden={!open}>{open&&<>
   <p className="settings-hint">{t('settings.tabs.about.agradecimentos_introducao')}</p>
   <button type="button" className="about-action" onClick={()=>onError(()=>window.palco.about.openRuntimeLicenses())}>{t('settings.tabs.about.licencas_do_runtime')}</button>
   {notices?<ul className="third-party-list">{notices.packages.map(p=><PackageRow key={p.name+'@'+p.version} item={p} texts={notices.texts}/>)}</ul>:<p className="settings-hint" aria-busy="true">{t('settings.tabs.about.carregando')}</p>}
  </>}</div>
 </section>
}
export function AboutTab(){
 const api=window.palco.about,[info,setInfo]=useState<{version:string;contact:string|null}|null>(null),[report,setReport]=useState<string|null>(null),[dialog,setDialog]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{let alive=true;void api.info().then(v=>{if(alive)setInfo(v)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[])
 const fail=(e:unknown)=>setError(e instanceof Error?e.message:t('settings.tabs.about.nao_foi_possivel_concluir'))
 const run=(job:()=>Promise<unknown>)=>{setBusy(true);setError('');void job().catch(fail).finally(()=>setBusy(false))}
 return<>
  <div className="about-identity"><span className="about-name">palco</span><span>{t('settings.tabs.about.versao', { version: info?.version ?? t('settings.tabs.about.carregando') })}</span><small>{t('settings.tabs.about.canvas_espacial_de_terminais_p')}</small></div>
  {error&&!dialog&&<p role="alert">{error}</p>}<SettingsDivider/>
  {info?.contact&&<><SettingsSection title={t('settings.tabs.about.contato')}><button type="button" className="about-action" disabled={busy} onClick={()=>run(()=>api.openContact())}>{t('settings.tabs.about.contato')}</button></SettingsSection><SettingsDivider/></>}
  <SettingsSection title={t('settings.tabs.about.relatar_um_problema_2')}><p className="settings-hint">{t('settings.tabs.about.gere_um_diagnostico_para_acomp')}</p><button type="button" className="about-action" disabled={busy} onClick={()=>{setDialog(true);setReport(null)}}>{t('settings.tabs.about.relatar_um_problema')}</button></SettingsSection><SettingsDivider/>
  <Acknowledgements onError={job=>{setError('');void job().catch(fail)}}/><SettingsDivider/>
  <SettingsSection title={t('settings.tabs.about.introducao')}><div className="settings-option"><div className="settings-row"><span className="settings-label">{t('settings.tabs.about.reabrir_onboarding')}</span><button disabled={busy} onClick={()=>run(()=>api.reopenOnboarding())}>{t('settings.tabs.about.mostrar_novamente')}</button></div></div></SettingsSection>
  {dialog&&<SettingsModal title={t('settings.tabs.about.relatar_um_problema_2')} close={()=>{if(!busy)setDialog(false)}}><h3>{t('settings.tabs.about.relatar_um_problema_2')}</h3><p>{t('settings.tabs.about.gere_um_diagnostico_para_acomp')}</p>{error&&<p role="alert">{error}</p>}
   <button disabled={busy} onClick={()=>run(async()=>setReport(await api.report()))}>{t('settings.tabs.about.previa')}</button>{' '}<button disabled={busy} onClick={()=>run(()=>api.saveReport())}>{t('settings.tabs.about.baixar')}</button>
   {report!==null&&<pre style={{whiteSpace:'pre-wrap',maxHeight:'45vh',overflow:'auto'}} aria-label={t('settings.tabs.about.previa_do_diagnostico')}>{report}</pre>}
   <button disabled={busy} onClick={()=>setDialog(false)}>{t('settings.tabs.about.fechar')}</button>
  </SettingsModal>}
 </>
}
