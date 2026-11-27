import { GitSettings } from './git'
import { VoiceSettings } from '../../voice/VoiceSettings'
import { useEffect, useState } from 'react'
import { ITEM_FACES } from '../catalog'
import { OptionList } from '../controls/OptionList'
import { t, tr } from '../../i18n'

/** Tela › "Padrões de Novos Itens": o botão Personalizar… abre este painel com Notas, Terminais, Portais e Editor de Arquivos. */
function ItemDefaults({ onBack }: { onBack(): void }) {
  const [face, setFace] = useState<(typeof ITEM_FACES)[number]>(ITEM_FACES[0])
  return <section aria-label={t('settings.tabs.general.padroes_de_novos_itens')}>
    <button type="button" className="settings-back-link" onClick={onBack}>{t('settings.tabs.general.tela')}</button>
    <h3>{t('settings.tabs.general.padroes_de_novos_itens')}</h3>
    <nav aria-label={t('settings.tabs.general.tipos_de_item')} className="settings-faces"><div className="settings-segmented">{ITEM_FACES.map(f => <button key={f} type="button" aria-pressed={f === face} onClick={() => setFace(f)}>{tr(f)}</button>)}</div></nav>
    <OptionList key={face} tab="general" section="Tela" face={face} />
  </section>
}

/** O que existe nesta máquina para cada ambiente (PATH): sem o programa, ligar a opção só gera um aviso ao abrir o terminal. */
function EnvironmentStatus() {
  const [status, setStatus] = useState<{ tmux: string | null; ssh: string | null; docker: string | null; sbx: string | null } | null>(null)
  useEffect(() => { void Promise.resolve(window.palco.environments?.status()).then(s => { if (s) setStatus(s) }).catch(() => {}) }, [])
  if (!status) return null
  const row = (label: string, path: string | null) => <li key={label}><strong>{label}</strong>: {path ? t('settings.tabs.general.encontrado_em_path', { path }) : t('settings.tabs.general.nao_instalado')}</li>
  return <ul className="settings-env-status" aria-label={t('settings.tabs.general.programas_dos_ambientes')}>{row('tmux', status.tmux)}{row('ssh', status.ssh)}{row('docker', status.docker)}{row(t('settings.tabs.general.sbx_docker_sandbox'), status.sbx)}</ul>
}

export function GeneralTab({ section }: { section: string }) {
  const [defaults, setDefaults] = useState(false)
  if (section === 'Git') return <GitSettings />
  if (section === 'Tela' && defaults) return <ItemDefaults onBack={() => setDefaults(false)} />
  return <>
    <OptionList tab="general" section={section} {...(section === 'Tela' ? { extra: { group: t('settings.groups.appearance'), node: <div key="item-defaults" className="settings-option">
      <div className="settings-row"><div className="settings-text"><span className="settings-label">{t('settings.tabs.general.padroes_de_novos_itens')}</span></div>
        <button type="button" onClick={() => setDefaults(true)}>{t('settings.tabs.general.personalizar')}</button></div>
      <small className="settings-hint">{t('settings.tabs.general.cor_tamanho_fonte_e_posicionam')}</small></div> } } : {})} />
    {section === 'Ambientes' && <EnvironmentStatus />}
    {section === 'Sistema' && <VoiceSettings />}
  </>
}
