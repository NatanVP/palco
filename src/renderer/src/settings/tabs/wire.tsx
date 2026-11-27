import { OptionList } from '../controls/OptionList'
import { t } from '../../i18n'

/** Acesso remoto ainda indisponível: as sub-abas mantêm os controles desabilitados e explicam o motivo. */
export function WireTab({ section }: { section: string }) {
  return <><p>{t('settings.tabs.wire.wire_acesso_remoto_entre_compu')}</p><OptionList tab="wire" section={section} /></>
}
