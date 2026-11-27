import { app, dialog, Menu, nativeImage, Notification, nativeTheme, powerSaveBlocker, Tray, type BrowserWindow } from 'electron'
import type { SystemPorts } from './controller'
import { localizeMessage, mt } from '../i18n'
import type { SystemNotice } from '../../shared/system'
import { join } from 'node:path'
import { resolveRuntimePaths } from '../runtime-paths'

const iconRoot = resolveRuntimePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }).icons
/** Bandeja: silhueta preta no tema claro e branca no escuro; Windows usa a branca na sobreposição. */
const trayIconPath = (dark: boolean): string => join(iconRoot, `palco-tray-${dark ? 'white' : 'black'}.png`)
const icon = (): Electron.NativeImage => nativeImage.createFromPath(trayIconPath(process.platform === 'win32' || nativeTheme.shouldUseDarkColors))
export function electronSystemPorts(getWindow: () => BrowserWindow | null, focus: (n: SystemNotice) => void): SystemPorts & { dispose(): void; relabel(): void } {
  const shown = new Set<Notification>()
  const tooltip = (n: number): string => (n ? mt('palco · {p1} avisos', { p1: n }) : 'palco')
  // O menu da bandeja é nativo: ao trocar o idioma é preciso montá-lo de novo.
  let relabelTray: (() => void) | null = null
  const show = () => { const w = getWindow(); if (!w || w.isDestroyed()) return; if (w.isMinimized()) w.restore(); w.show(); w.focus() }
  return {
    startPower: () => powerSaveBlocker.start(process.platform === 'win32' ? 'prevent-display-sleep' : 'prevent-app-suspension'),
    stopPower: id => { if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id) },
    badge: count => { app.setBadgeCount(count); const w = getWindow(); if (process.platform === 'win32' && w && !w.isDestroyed()) w.setOverlayIcon(count ? icon() : null, count ? mt('{p1} avisos', { p1: count }) : '') },
    flash: on => { const w = getWindow(); if (w && !w.isDestroyed()) w.flashFrame(on) },
    createTray: callbacks => {
      const tray = new Tray(icon())
      const retheme = (): void => { if (!tray.isDestroyed()) tray.setImage(icon()) }
      nativeTheme.on('updated', retheme)
      let count = 0
      relabelTray = () => {
        tray.setToolTip(tooltip(count))
        tray.setContextMenu(Menu.buildFromTemplate([{ label: mt('Mostrar palco'), click: callbacks.show }, { type: 'separator' }, { label: mt('Encerrar palco'), click: callbacks.quit }]))
      }
      relabelTray()
      tray.on('click', callbacks.show)
      return { destroy: () => { relabelTray = null; nativeTheme.off('updated', retheme); tray.destroy() }, setCount: n => { count = n; tray.setToolTip(tooltip(n)); if (process.platform === 'darwin') tray.setTitle(n ? String(n) : '') } }
    },
    hideWindow: () => getWindow()?.hide(), showWindow: show,
    confirmQuit: async () => {
      const options = { type: 'question' as const, title: mt('Encerrar palco?'), message: mt('Encerrar palco?'), detail: mt('Os processos dos terminais serão encerrados. As sessões compatíveis poderão ser retomadas na próxima abertura.'), buttons: [mt('Cancelar'), mt('Encerrar')], defaultId: 0, cancelId: 0, noLink: true }
      const w = getWindow(), answer = w ? await dialog.showMessageBox(w, options) : await dialog.showMessageBox(options)
      return answer.response === 1
    },
    notify: (notice, click) => {
      if (!Notification.isSupported()) return
      const n = new Notification({ title: localizeMessage(notice.title), body: localizeMessage(notice.body) }); shown.add(n)
      n.on('click', () => { shown.delete(n); show(); click() }); n.on('close', () => shown.delete(n)); n.show()
    },
    focus: notice => { show(); focus(notice) }, quit: () => app.quit(),
    isFocused: () => !!getWindow()?.isFocused(),
    relabel: () => relabelTray?.(),
    dispose: () => { for (const n of shown) n.close(); shown.clear() }
  }
}
