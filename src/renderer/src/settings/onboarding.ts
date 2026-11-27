import { subscribeLocale, t } from '../i18n'
import{shortcutsSuspended,suspendShortcuts}from'./preferences'
/** The existing preference-effects mount owns this surface; App/canvas remain untouched. */
export function connectOnboarding():()=>void{
 const api=window.palco?.about;if(!api)return()=>{}
 const host=document.createElement('div');let alive=true,opened=false,step=0,revision=0,previous=false,focus:HTMLElement|null=null
 const pages=()=>[[t('settings.onboarding.bem_vindo_ao_palco'),t('settings.onboarding.organize_terminais_notas_e_por')],[t('settings.onboarding.espacos_de_trabalho_e_andares'),t('settings.onboarding.separe_projetos_na_barra_later')],[t('settings.onboarding.seu_ambiente_suas_escolhas'),t('settings.onboarding.em_configuracoes_voce_escolhe_')]]
 const close=()=>{opened=false;host.remove();suspendShortcuts(previous);if(focus?.isConnected)focus.focus()}
 const finish=()=>{void api.completeOnboarding().then(()=>{if(alive)close()}).catch(()=>{const error=document.createElement('p');error.setAttribute('role','alert');error.textContent=t('settings.onboarding.nao_foi_possivel_salvar_tente_');host.querySelector('section')?.append(error)})}
 const render=()=>{host.replaceChildren();const back=document.createElement('div'),panel=document.createElement('section'),title=document.createElement('h2'),text=document.createElement('p');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',t('settings.onboarding.boas_vindas'));Object.assign(back.style,{position:'fixed',inset:'0',background:'#0008',display:'grid',placeItems:'center',zIndex:'10000'});Object.assign(panel.style,{width:'min(460px,90vw)',background:'var(--panel,#222)',color:'var(--text,#eee)',padding:'28px',borderRadius:'14px',border:'1px solid var(--line,#555)'});title.textContent=pages()[step]![0]!;text.textContent=pages()[step]![1]!;panel.append(title,text)
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.onclick=action;panel.append(b);return b}
  if(step>0)button(t('settings.onboarding.voltar'),()=>{step--;render()});const next=button(step===pages().length-1?t('settings.onboarding.concluido'):t('settings.onboarding.proximo'),()=>{if(step===pages().length-1)finish();else{step++;render()}});button(t('settings.onboarding.pular'),finish);back.append(panel);host.append(back);if(!host.isConnected)document.body.append(host);next.focus()
 }
 const show=()=>{if(!alive)return;document.querySelector<HTMLButtonElement>('.settings-dialog header button')?.click();if(!opened){previous=shortcutsSuspended();focus=document.activeElement as HTMLElement|null;suspendShortcuts(true);opened=true}step=0;render()}
 const offLocale=subscribeLocale(()=>{if(opened)render()});const off=api.onOnboarding(()=>{revision++;show()}),initial=revision
 void api.info().then(value=>{if(alive&&initial===revision&&!value.onboardingCompleted)show()}).catch(()=>{})
 const key=(e:KeyboardEvent)=>{if(!opened)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish()}else if(e.key==='Tab'){const all=[...host.querySelectorAll('button')],first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}
 window.addEventListener('keydown',key,true)
 return()=>{alive=false;off();offLocale();window.removeEventListener('keydown',key,true);if(opened)close();else host.remove()}
}
