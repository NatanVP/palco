// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyWorkspace, mountApp, type Harness } from '../helpers/app-harness'
import type { TerminalNode } from '../../src/shared/model'

let app: Harness | undefined
afterEach(async () => { await app?.unmount(); app = undefined; vi.unstubAllGlobals() })

const terminal = (id: string, x: number): TerminalNode => ({
  id, kind: 'terminal', floorId: null, name: id, agent: 'shell', command: '', cwd: '/tmp', pos: { x, y: 0 }, size: { w: 400, h: 300 }
})

async function open(): Promise<(id: string) => HTMLElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  app = await mountApp({
    workspace: emptyWorkspace({ nodes: { um: terminal('um', 0), dois: terminal('dois', 500) } }),
    api: { 'terminal.attach': (async () => ({ data: '', seq: 0, gen: 0 })) as never }
  })
  return (id) => app!.host.querySelector<HTMLElement>(`.node[data-node-id="${id}"]`)!
}

const press = (el: Element, init: PointerEventInit = {}) => act(async () => {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ...init }))
})

describe('clique no terminal', () => {
  it('no meio da tela do terminal seleciona o card e tira a seleção do outro', async () => {
    const node = await open()
    await press(node('um').querySelector('.node-header')!)
    expect(node('um').classList.contains('selected')).toBe(true)

    await press(node('dois').querySelector('.terminal-host')!)

    expect(node('dois').classList.contains('selected')).toBe(true)
    expect(node('um').classList.contains('selected')).toBe(false)
  })

  it('no miolo do xterm também seleciona', async () => {
    const node = await open()
    await press(node('dois').querySelector('.terminal-host .xterm') ?? node('dois').querySelector('.terminal-wrap')!)
    expect(node('dois').classList.contains('selected')).toBe(true)
  })

  it('botão direito e Shift+clique no corpo não mudam a seleção', async () => {
    const node = await open()
    await press(node('um').querySelector('.node-header')!)
    await press(node('dois').querySelector('.terminal-host')!, { button: 2 })
    await press(node('dois').querySelector('.terminal-host')!, { shiftKey: true })
    expect(node('um').classList.contains('selected')).toBe(true)
    expect(node('dois').classList.contains('selected')).toBe(false)
  })

  it('na margem em volta do texto, o teclado vai para o terminal', async () => {
    const node = await open()
    const host = node('dois').querySelector('.terminal-host')!
    await press(host)
    expect(host.contains(document.activeElement)).toBe(true)
  })
})
