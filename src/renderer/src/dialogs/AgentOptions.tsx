import { useState } from 'react'
import type { AgentKind } from '../../../shared/model'
import { AGENT_OPTIONS, type AgentOption } from '../../../shared/agent-options'
import { readAgentOption, writeAgentOption } from '../../../shared/agent-option-command'
import { commandLineError, firstLine } from '../../../shared/agent-command'
import { Toggle } from '../settings/controls/Toggle'
import { InfoButton } from '../settings/controls/InfoButton'
import { getLocale, t } from '../i18n'
import './agent-options.css'

/** A linha de comando é a fonte do estado; editar o texto também atualiza os interruptores. */
export function AgentOptions({ agent, command, onChange }: { agent: AgentKind; command: string; onChange(command: string): void }) {
  const [search, setSearch] = useState('')
  if (agent !== 'claude' && agent !== 'codex') return null
  const locale = getLocale(), language = locale === 'pt-BR' || locale === 'es' ? locale : 'en'
  const invalid = !firstLine(command) || commandLineError(firstLine(command)) !== null
  const options = AGENT_OPTIONS.filter(o => o.agent === agent && [o.flag, ...o.aliases].some(flag => flag.toLowerCase().includes(search.toLowerCase().trim())))
  const update = (option: AgentOption, values: string[] | null): void => { onChange(writeAgentOption(command, option, values)) }
  return <details className="agent-options">
    <summary>{t('agentOptions.title')}</summary>
    <div className="agent-options-body">
      <input type="search" aria-label={t('agentOptions.search')} placeholder={t('agentOptions.search')} value={search} onChange={e => setSearch(e.target.value)} />
      {invalid && <p role="status">{t('agentOptions.invalid')}</p>}
      {!options.length && <p>{t('agentOptions.empty')}</p>}
      {options.map(option => {
        const values = invalid ? null : readAgentOption(command, option), enabled = values !== null
        const dangerous = option.risk === 'danger' || (enabled && values.some(v => option.dangerValues?.includes(v)))
        const valueLabel = t('agentOptions.value', { flag: option.flag }), value = values?.[0] ?? ''
        return <div key={`${agent}:${option.flag}`} className="agent-option" data-flag={option.flag}>
          <div className="agent-option-row">
            <code>{option.flag}</code>
            <InfoButton label={t('agentOptions.about', { flag: option.flag })} text={option.explanation[language]} />
            {dangerous && <span className="agent-option-danger">{t('agentOptions.danger')}</span>}
            <Toggle label={option.flag} checked={enabled} disabled={invalid} onChange={on => update(option, on ? option.kind === 'choice' ? [option.values![0]!] : [] : null)} />
          </div>
          {enabled && option.kind !== 'boolean' && <div className="agent-option-value">
            {option.kind === 'choice' ? <select aria-label={valueLabel} value={value} onChange={e => update(option, [e.target.value])}>
              {!option.values!.includes(value) && <option value={value}>{value}</option>}
              {option.values!.map(choice => <option key={choice} value={choice}>{choice}{option.dangerValues?.includes(choice) ? ` (${t('agentOptions.danger')})` : ''}</option>)}
            </select> : option.kind === 'list' ? <>
              <textarea aria-label={valueLabel} value={values.join('\n')} spellCheck={false} rows={2} onChange={e => update(option, e.target.value.split('\n'))} />
              <small>{t('agentOptions.listHint')}</small>
            </> : <input aria-label={valueLabel} value={value} spellCheck={false} onChange={e => update(option, e.target.value === '' && option.optionalValue ? [] : [e.target.value])} />}
          </div>}
        </div>
      })}
    </div>
  </details>
}
