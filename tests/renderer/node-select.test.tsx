// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyWorkspace, mountApp, type Harness } from '../helpers/app-harness'
import type { CanvasNode, FileNode, FileTreeNode, NoteNode, PortalNode, TextNode } from '../../src/shared/model'

let app: Harness | undefined
afterEach(async () => { await app?.unmount(); app = undefined; vi.unstubAllGlobals() })

const position = (x: number) => ({ x, y: 0 })
const size = { w: 360, h: 260 }
const nodes: CanvasNode[] = [
  { id: 'nota', kind: 'note', floorId: null, name: 'Nota', content: 'texto', pos: position(0), size } as NoteNode,
  { id: 'texto', kind: 'text', floorId: null, name: 'Texto', text: 'texto livre', fontSize: 14, pos: position(400), size } as TextNode,
  { id: 'arquivo', kind: 'file', floorId: null, name: 'Arquivo', path: '/tmp/amostra.txt', pos: position(800), size } as FileNode,
  { id: 'arvore', kind: 'filetree', floorId: null, name: 'Árvore', root: '/tmp/amostras', pos: position(1200), size } as FileTreeNode,
  { id: 'portal', kind: 'portal', floorId: null, name: 'Portal', url: 'https://example.test', pos: position(1600), size } as PortalNode
]

async function open(commit = vi.fn(async () => []), extra: Record<string, (...args: never[]) => unknown> = {}): Promise<(id: string) => HTMLElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  app = await mountApp({
    workspace: emptyWorkspace({ nodes: Object.fromEntries(nodes.map(node => [node.id, node])) }),
    api: {
      'files.read': (async () => ({ kind: 'text', data: 'amostra', truncated: false })) as never,
      'files.list': (async () => []) as never,
      'history.commit': commit as never,
      'terminal.attach': (async () => ({ data: '', seq: 0, gen: 0 })) as never,
      ...extra
    }
  })
  return id => app!.host.querySelector<HTMLElement>(`.node[data-node-id="${id}"]`)!
}

const press = (element: Element, init: PointerEventInit = {}) => act(async () => {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ...init }))
})

const removeKey = () => act(async () => {
  app!.host.querySelector('.canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
})

describe('seleção pelo corpo do card', () => {
  it('seleciona nota, texto, arquivo e árvore pelo conteúdo, trocando a seleção', async () => {
    const node = await open()
    const bodies: Array<[string, string]> = [
      ['nota', '.note-text'], ['texto', '.text-free'], ['arquivo', '.filebox'], ['arvore', '.treebox']
    ]
    for (const [id, selector] of bodies) {
      await press(node(id).querySelector(selector)!)
      expect(node(id).classList.contains('selected'), id).toBe(true)
      for (const other of nodes.filter(item => item.id !== id)) expect(node(other.id).classList.contains('selected'), other.id).toBe(false)
    }
  })

  it('o foco do webview seleciona o portal mesmo sem evento de clique do conteúdo', async () => {
    const node = await open()
    const webview = node('portal').querySelector('webview')!
    await act(async () => { webview.dispatchEvent(new FocusEvent('focus')) })
    expect(node('portal').classList.contains('selected')).toBe(true)
  })

  it('botão direito e Shift+clique no corpo mantêm a seleção atual', async () => {
    const node = await open()
    await press(node('nota').querySelector('.node-header')!)
    await press(node('arquivo').querySelector('.filebox')!, { button: 2 })
    await press(node('arquivo').querySelector('.filebox')!, { shiftKey: true })
    expect(node('nota').classList.contains('selected')).toBe(true)
    expect(node('arquivo').classList.contains('selected')).toBe(false)
  })

  it('clique no corpo não arma Delete, mas cabeçalho continua permitindo apagar', async () => {
    const commit = vi.fn(async () => [])
    const node = await open(commit)
    await press(node('arquivo').querySelector('.filebox')!)
    expect(node('arquivo').classList.contains('selected')).toBe(true)
    await removeKey()
    expect(commit).not.toHaveBeenCalled()

    await press(node('arquivo').querySelector('.node-header')!)
    await removeKey()
    expect(commit).toHaveBeenCalled()
  })

  it('selecionar outro card por fora (notificação, atalho) volta a permitir apagar', async () => {
    const commit = vi.fn(async () => [])
    let focus: ((id: string) => void) | undefined
    const node = await open(commit, { 'terminal.onFocusRequest': ((cb: (id: string) => void) => { focus = cb; return () => {} }) as never })
    await press(node('arquivo').querySelector('.filebox')!)
    await act(async () => focus!('nota'))
    expect(node('nota').classList.contains('selected')).toBe(true)
    await removeKey()
    expect(commit).toHaveBeenCalledWith('ws1', expect.arrayContaining([{ type: 'node.remove', id: 'nota' }]))
  })

  it('a seleção por laço continua permitindo apagar', async () => {
    const commit = vi.fn(async () => [])
    const node = await open(commit)
    const canvas = app!.host.querySelector<HTMLElement>('.canvas')!
    await act(async () => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }))
      canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 100, clientY: 100 }))
    })
    expect(node('nota').classList.contains('selected')).toBe(true)
    await removeKey()
    expect(commit).toHaveBeenCalledWith('ws1', expect.arrayContaining([{ type: 'node.remove', id: 'nota' }]))
  })
})
