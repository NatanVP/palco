import type { KeyboardInputEvent, MenuItemConstructorOptions } from 'electron'
import { mt } from './i18n'

type EditItem = Omit<MenuItemConstructorOptions, 'click'> & { click?: () => void }

/** O canvas trata os atalhos; campos de texto e portais mantêm o desfazer nativo. */
export function canvasEditMenu(focused: () => { sendInputEvent(event: KeyboardInputEvent): void } | undefined): MenuItemConstructorOptions & { submenu: EditItem[] } {
  const history = (direction: 'undo' | 'redo', label: string): EditItem => ({
    id: direction, label, accelerator: direction === 'undo' ? 'CommandOrControl+Z' : 'CommandOrControl+Shift+Z',
    click: () => {
      const contents = focused()
      if (!contents) return
      const modifiers: KeyboardInputEvent['modifiers'] = direction === 'undo' ? ['control'] : ['control', 'shift']
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers })
    }
  })
  return { label: mt('Editar'), submenu: [
    history('undo', mt('Desfazer')), history('redo', mt('Refazer')), { type: 'separator' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' },
    { type: 'separator' }, { role: 'selectAll' }
  ] }
}
