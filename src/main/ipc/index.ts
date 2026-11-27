import { clipboardArea } from './clipboard'
import { nodeStateArea } from './node-state'
import { aboutGitArea } from './about-git'
import { dataArea } from './data'
import { accountSettingsArea } from './account-settings'
import { agentLibrariesArea } from './agent-libraries'
import { systemArea } from './system'
import type { IpcArea } from './area'
import { preferencesArea } from './preferences'
import { chatArea } from './chat'
import { railArea } from './rail'
import { fileOpsArea } from './file-ops'
import { environmentsArea } from './environments'
import { presetsArea } from './presets'
import { terminalMemoryArea } from './terminal-memory'
import { routinesArea } from './routines'
import { voiceArea } from './voice'

/** Áreas de IPC registradas pelo `registerIpc`, com handlers definidos em `src/main/ipc/<área>.ts`. */
export const AREAS: readonly IpcArea[] = [
  preferencesArea,
  systemArea,
  agentLibrariesArea,
  accountSettingsArea,
  dataArea,
  aboutGitArea,
  presetsArea,
  chatArea,
  railArea,
  fileOpsArea,
  clipboardArea,
  nodeStateArea,
  environmentsArea,
  terminalMemoryArea,
  routinesArea,
  voiceArea
]
export { registerAreas } from './area'
export type { IpcArea, IpcAreaContext } from './area'
