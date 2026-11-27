import type { BrowserWindowConstructorOptions, Session } from 'electron'
import { isPortalUrl, PORTAL_PARTITION } from '../security'

/** Same URL boundary as the guest; never inherit privileged window/preload preferences. The popup shares the opener's session (login flows). */
export function popupWindowPolicy(url: string, session?: Session): { action: 'deny' } | { action: 'allow'; overrideBrowserWindowOptions: BrowserWindowConstructorOptions } {
  if(url !== 'about:blank' && !isPortalUrl(url)) return { action: 'deny' }
  return { action: 'allow', overrideBrowserWindowOptions: { show: true, webPreferences: {
    ...(session ? { session } : { partition: PORTAL_PARTITION }), nodeIntegration: false, nodeIntegrationInSubFrames: false,
    contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
    webviewTag: false, preload: undefined
  } } }
}
