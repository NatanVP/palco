import { Fragment, type ReactNode } from 'react'
import type { TabId } from '../catalog'
import { actionsOf, optionsOf } from '../options'
import { ActionRow } from './ActionRow'
import { OptionRow } from './OptionRow'
import { SettingsDivider, SettingsSection } from './Section'

/** As opções e os botões sem efeito de uma sub-aba (ou face), em seções na ordem do inventário. `extra` entra no fim do grupo citado. */
export function OptionList({ tab, section, face, extra }: { tab: TabId; section: string; face?: string; extra?: { group: string; node: ReactNode } }) {
  const items = [
    ...optionsOf(tab, section, face).map(o => ({ group: o.group, node: <OptionRow key={o.key} def={o} /> })),
    ...actionsOf(tab, section, face).filter(a => !a.ready).map(a => ({ group: a.group, node: <ActionRow key={a.label} def={a} /> }))
  ]
  const groups: Array<{ title: string | undefined; nodes: ReactNode[] }> = []
  for (const item of items) {
    const found = groups.find(g => g.title === item.group)
    if (found) found.nodes.push(item.node); else groups.push({ title: item.group, nodes: [item.node] })
  }
  if (extra) groups.find(g => g.title === extra.group)?.nodes.push(<Fragment key="extra">{extra.node}</Fragment>)
  return <>{groups.map((g, i) => <Fragment key={g.title ?? i}>{i > 0 && <SettingsDivider />}{g.title ? <SettingsSection title={g.title}>{g.nodes}</SettingsSection> : <div className="settings-section-body">{g.nodes}</div>}</Fragment>)}</>
}
