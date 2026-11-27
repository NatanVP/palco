import { APPEARANCE_FACES } from '../catalog'
import { OptionList } from '../controls/OptionList'
import { ResetButton } from '../controls/OptionRow'
import { defaultPreferences } from '../../../../shared/preferences'
import { updatePreferences, usePreferences } from '../preferences'
import { PresetsPanel } from './presets-panel'
import { t } from '../../i18n'

export function TerminalTab({ section, face }: { section: string; face: string }) {
  const p = usePreferences()
  if (section === 'Início Rápido') return <PresetsPanel />
  if (section === 'Aparência') {
    const f = (APPEARANCE_FACES as readonly string[]).includes(face) ? face : APPEARANCE_FACES[0]
    const d = defaultPreferences()
    return <>
      <OptionList key={f} tab="terminal" section={section} face={f} />
      {f === 'Terminal' && (p.terminalFontFamily !== d.terminalFontFamily || p.terminalFontSize !== d.terminalFontSize) && <div className="font-reset">
        <ResetButton label={t('settings.tabs.terminal.fonte')} ariaLabel={t('settings.tabs.terminal.redefinir_a_fonte_do_terminal_')} onReset={() => { void updatePreferences({ terminalFontFamily: d.terminalFontFamily, terminalFontSize: d.terminalFontSize }).catch(() => {}) }} /></div>}
    </>
  }
  return <OptionList tab="terminal" section={section} />
}
