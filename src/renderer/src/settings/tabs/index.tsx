import type { TabId } from '../catalog'
import { ShortcutSettings } from '../ShortcutSettings'
import { AboutTab } from './about'
import { AgentsTab } from './agents'
import { DataTab } from './data'
import { GeneralTab } from './general'
import { TerminalTab } from './terminal'
import { WireTab } from './wire'

/** Corpo de cada aba: cada aba das Configurações fica no próprio arquivo. */
export function SettingsBody({ tab, section, face }: { tab: TabId; section: string; face: string }) {
  switch (tab) {
    case 'general': return <GeneralTab section={section} />
    case 'terminal': return <TerminalTab section={section} face={face} />
    case 'agents': return <AgentsTab section={section} />
    case 'shortcuts': return <ShortcutSettings />
    case 'wire': return <WireTab section={section} />
    case 'data': return <DataTab section={section} />
    case 'about': return <AboutTab />
  }
}
