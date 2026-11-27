import { t } from '../i18n'
import { useEffect, useState } from 'react'
import type { AccountView } from '../../../shared/account-settings'
import type { TerminalNode } from '../../../shared/model'
import { SettingsModal } from '../settings/controls/SettingsModal'
/** A troca mantém o processo até a escolha explícita de reiniciá-lo. */
export function TerminalAccountPicker({node}:{node:TerminalNode}) {
 const [accounts,setAccounts]=useState<AccountView[]>([]),[selection,setSelection]=useState(node.accountId??''),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{let alive=true;void window.palco.accountSettings.list().then(a=>{if(alive)setAccounts(a.filter(a=>a.agent===node.agent))}).catch(()=>{if(alive)setError(t('settings.accounts.loadError'))});return()=>{alive=false}},[node.agent])
 const assign=async(restart:boolean)=>{if(pending===null)return;setBusy(true);setError('');try{await window.palco.accountSettings.assign(node.id,pending||null,restart);setSelection(pending);setPending(null)}catch{setError(t('settings.accounts.switchError'))}finally{setBusy(false)}}
 if(!['claude','codex','antigravity'].includes(node.agent))return null
 return <div className="nt-field"><label className="nt-label" htmlFor="edit-terminal-account">{t('settings.accounts.account')}</label><select id="edit-terminal-account" className="nt-select" value={selection} disabled={busy} onChange={e=>setPending(e.target.value)}><option value="">{t('settings.accounts.default')}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>{error&&<p role="alert">{error}</p>}
 {pending!==null&&<SettingsModal title={t('settings.accounts.switchTitle')} close={()=>{if(!busy)setPending(null)}}><p>{t('settings.accounts.switchBody')}</p>{error&&<p role="alert">{error}</p>}<div className="settings-confirm-actions"><button type="button" disabled={busy} onClick={()=>setPending(null)}>{t('settings.accounts.cancel')}</button><button type="button" disabled={busy} onClick={()=>void assign(false)}>{t('settings.accounts.next')}</button><button type="button" disabled={busy} onClick={()=>void assign(true)}>{t('settings.accounts.restart')}</button></div></SettingsModal>}</div>
}
