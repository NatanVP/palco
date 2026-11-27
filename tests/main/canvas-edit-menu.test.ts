import { expect, it, vi } from 'vitest'
import { canvasEditMenu } from '../../src/main/canvas-edit-menu'
it.each([['undo', ['control']], ['redo', ['control', 'shift']]] as const)('o menu %s encaminha o atalho para o conteúdo com foco', (direction, modifiers) => {
  const sendInputEvent = vi.fn(), menu = canvasEditMenu(() => ({ sendInputEvent }))
  const item = menu.submenu.find(item => item.id === direction)!
  item.click!()
  expect(sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
    { type: 'keyDown', keyCode: 'Z', modifiers: [...modifiers] },
    { type: 'keyUp', keyCode: 'Z', modifiers: [...modifiers] }
  ])
})
it('o menu sem conteúdo com foco não dispara nenhuma ação', () => {
  expect(() => canvasEditMenu(() => undefined).submenu[0]!.click!()).not.toThrow()
})
