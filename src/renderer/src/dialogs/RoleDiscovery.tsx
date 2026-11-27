import { useState } from 'react'
import { FileSearch } from 'lucide-react'
import type { RoleCandidate } from '../../../shared/agent-libraries'
import { SettingsModal } from '../settings/controls/SettingsModal'
import { CheckMark } from '../settings/controls/Toggle'
import { TerminalIcon } from '../nodes/terminal-icons'
import { t } from '../i18n'
import '../settings/settings.css'
import './role-discovery.css'

/** A folha "Descobrir Responsabilidades": caixas à esquerda, prévia à direita. Tudo nasce marcado. */
export function RoleDiscovery({ candidates, busy, error, onImport, onClose }: { candidates: RoleCandidate[]; busy: boolean; error: string | null; onImport(chosen: RoleCandidate[]): void; onClose(): void }) {
  const [marked, setMarked] = useState<number[]>(() => candidates.map((_, i) => i)), [focus, setFocus] = useState(0)
  const all = candidates.length > 0 && marked.length === candidates.length, current = candidates[focus]
  const title = t('settings.tabs.agent-libraries.descobrir_responsabilidades')
  return <SettingsModal title={title} close={onClose}><div className="role-discovery">
    <h3>{title}</h3>
    {error && <p role="alert">{error}</p>}
    {candidates.length === 0 ? <div className="role-discovery-empty"><FileSearch size={24} aria-hidden="true" /><p>{t('settings.agentes.nada_encontrado')}</p></div> : <>
      <div className="role-discovery-head"><p>{t('settings.agentes.escolha_o_que_importar')}</p><button type="button" className="role-discovery-all" onClick={() => setMarked(all ? [] : candidates.map((_, i) => i))}>{all ? t('settings.tabs.agent-libraries.desmarcar_tudo') : t('settings.tabs.agent-libraries.selecionar_tudo')}</button></div>
      <div className="role-discovery-body">
        <ul>{candidates.map((c, i) => <li key={c.name} className={i === focus ? 'focused' : ''}>
          <CheckMark label={t('settings.agentes.importar_nome', { name: c.name })} checked={marked.includes(i)} onChange={on => setMarked(on ? [...marked, i] : marked.filter(n => n !== i))} />
          <button type="button" aria-current={i === focus} onClick={() => setFocus(i)}><TerminalIcon icon={c.icon || 'contact'} size={14} {...(c.color ? { color: c.color } : {})} /><span>{c.name}</span></button>
        </li>)}</ul>
        <section aria-label={current?.name}><strong>{current?.name}</strong><p>{current?.text}</p></section>
      </div>
    </>}
    <div className="role-discovery-foot"><button type="button" disabled={busy} onClick={onClose}>{t('settings.tabs.agent-libraries.cancelar')}</button>
      <button type="button" className="is-primary" disabled={busy || !marked.length} onClick={() => onImport([...marked].sort((a, b) => a - b).map(i => candidates[i]!))}>{marked.length ? t('settings.agentes.importar_n', { total: marked.length }) : t('settings.agentes.importar')}</button></div>
  </div></SettingsModal>
}
