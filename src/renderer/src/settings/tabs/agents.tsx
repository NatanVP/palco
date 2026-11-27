import { PromptsSettings, RolesSettings, SkillsSettings } from './agent-libraries'
import { AccountsSettings, UsageSettings } from './accounts-usage'
import { OptionList } from '../controls/OptionList'

export function AgentsTab({ section }: { section: string }) {
  if (section === 'Responsabilidades') return <RolesSettings />
  if (section === 'Prompts') return <PromptsSettings />
  if (section === 'Skills') return <SkillsSettings />
  if (section === 'Contas') return <AccountsSettings />
  if (section === 'Uso') return <UsageSettings />
  return <OptionList tab="agents" section={section} />
}
