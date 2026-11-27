// @vitest-environment happy-dom
// endereço colado vira cartão de link.
import { act } from 'react'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { parseNewNode, parseNodePatch } from '../src/main/validate'
import { PartituraStore } from '../src/main/partituras/partitura-store'
import { capturePartitura } from '../src/main/partituras/insert'
import { captureSelection } from '../src/renderer/src/canvas/selection/group'
import { elementClipboard } from '../src/renderer/src/canvas/selection/clipboard'
import { linkNode, linkText } from '../src/renderer/src/nodes/link'
import { cardFrameAt } from '../src/renderer/src/canvas/card-frame'
import { emptyWorkspace, mountApp, type Harness } from './helpers/app-harness'
import type { NewNode } from '../src/shared/model'

const link = (url: string, extra: object = {}): NewNode => ({ kind: 'link', floorId: null, name: 'exemplo.dev', url, pos: { x: 0, y: 0 }, size: { w: 280, h: 48 }, ...extra }) as NewNode

describe('o nó de link', () => {
  it('nasce 280×48 centrado no ponto, com o nome do servidor como título', () => {
    expect(linkNode('https://www.exemplo.dev/a/b?q=1', { x: 500, y: 300 }, null, [])).toEqual({ kind: 'link', floorId: null, name: 'www.exemplo.dev', url: 'https://www.exemplo.dev/a/b?q=1', pos: { x: 360, y: 276 }, size: { w: 280, h: 48 } })
    expect(linkNode('https://exemplo.dev', { x: 0, y: 0 }, null, ['exemplo.dev'])!.name).toBe('exemplo.dev 2')
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', 'não é url']) expect(linkNode(bad, { x: 0, y: 0 }, null, []), bad).toBeNull()
  })
  it('mostra servidor e caminho', () => {
    expect(linkText('https://exemplo.dev/')).toBe('exemplo.dev'); expect(linkText('https://exemplo.dev/doc/guia?x=1#y')).toBe('exemplo.dev/doc/guia')
  })
  it('o main só aceita http e https, e a altura de 40 em diante', () => {
    expect(parseNewNode(link('https://exemplo.dev/'))).toMatchObject({ kind: 'link', url: 'https://exemplo.dev/', size: { w: 280, h: 48 } })
    for (const bad of ['javascript:1', 'file:///x', 'x']) expect(() => parseNewNode(link(bad)), bad).toThrow()
    expect(parseNodePatch({ size: { w: 140, h: 40 } }, 'link')).toEqual({ size: { w: 140, h: 40 } })
    expect(() => parseNodePatch({ size: { w: 200, h: 40 } }, 'note')).toThrow()
  })
  it('redimensiona até 140×40', () => {
    expect(cardFrameAt({ kind: 'resize', start: { x: 0, y: 0 }, frame: { pos: { x: 0, y: 0 }, size: { w: 280, h: 48 } } }, { x: -500, y: -500 }, 1, { w: 140, h: 40 }).size).toEqual({ w: 140, h: 40 })
  })
  it('persiste, é copiado e vai em partitura; arquivo com endereço perigoso é recusado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'palco-link-'))
    try {
      const store = new WorkspaceStore(join(dir, 'ws.json')), id = store.addNode(link('https://exemplo.dev/a')); store.flush(); store.dispose()
      const again = new WorkspaceStore(join(dir, 'ws.json'))
      expect(again.get().nodes[id]).toMatchObject({ kind: 'link', url: 'https://exemplo.dev/a' }); expect(again.warning).toBeUndefined()
      expect(captureSelection(again.get(), [id], []).nodes[0]).toMatchObject({ kind: 'link', url: 'https://exemplo.dev/a' })
      const lib = new PartituraStore(join(dir, 'lib'))
      lib.save({ ...capturePartitura(again.get(), null, { noteText: true }), name: 'L', createdAt: '2026-11-25' })
      expect(lib.get('L').nodes[0]).toMatchObject({ kind: 'link' })
      expect(() => lib.import(JSON.stringify({ format: 'palco-partituras', version: 1, partituras: [{ name: 'M', createdAt: '2026-11-25', bands: [], connections: [], nodes: [{ key: 'a', ...link('javascript:alert(1)') }] }] }))).toThrow()
      again.dispose()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('no canvas', () => {
  let app: Harness
  const add = vi.fn(async (_node: object) => 'novo'), open = vi.fn(async () => {}), write = vi.fn(async () => {}), commit = vi.fn(async () => [])
  const clipboard = { text: '', files: [] as string[], image: false }
  const card = (over: object = {}) => ({ id: 'l', kind: 'link', name: 'exemplo.dev', url: 'https://exemplo.dev/doc', floorId: null, pos: { x: 200, y: 200 }, size: { w: 280, h: 48 }, ...over })
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); vi.clearAllMocks(); elementClipboard.clear(); Object.assign(clipboard, { text: '', files: [], image: false }) })
  afterEach(async () => { await app.unmount(); vi.unstubAllGlobals() })
  const mount = async (nodes: object = { l: card() }) => { app = await mountApp({ workspace: emptyWorkspace({ nodes: nodes as never }), api: { 'node.add': add as never, 'shell.openExternal': open, 'clipboard.read': async () => clipboard, 'clipboard.writeText': write, 'history.commit': commit as never } }) }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const body = () => app.host.querySelector<HTMLElement>('.link-card')!
  const fire = async (event: Event, el: Element = body()) => { await act(async () => { el.dispatchEvent(event) }); await settle() }
  const items = () => [...document.querySelectorAll('[role^=menuitem]')].map((e) => e.textContent!.trim())
  const choose = async (label: string) => { const el = [...document.querySelectorAll<HTMLElement>('[role^=menuitem]')].find((e) => e.textContent!.trim() === label)!; expect(el, label).toBeTruthy(); await act(async () => el.click()); await settle() }
  const context = () => fire(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))

  it('mostra ícone, título e endereço, sem corpo separado', async () => {
    await mount()
    expect(body().querySelector('svg')).toBeTruthy(); expect(body().querySelector('.link-title')!.textContent).toBe('exemplo.dev'); expect(body().querySelector('.link-url')!.textContent).toBe('exemplo.dev/doc')
    expect(app.host.querySelector('[data-node-id="l"] .node-body')).toBeNull()
  })
  it('duplo clique abre no navegador; com Shift, num portal ao lado', async () => {
    await mount()
    await fire(new MouseEvent('dblclick', { bubbles: true })); expect(open).toHaveBeenCalledWith('https://exemplo.dev/doc'); expect(add).not.toHaveBeenCalled()
    await fire(new MouseEvent('dblclick', { bubbles: true, shiftKey: true }))
    expect(add).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'portal', url: 'https://exemplo.dev/doc', pos: { x: 500, y: 200 }, size: { w: 800, h: 600 } }))
    open.mockClear(); await fire(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(open).toHaveBeenCalledOnce()
  })
  it('o duplo clique chega pelo cabeçalho: o arrasto captura o ponteiro nele, e é lá que o navegador entrega o evento', async () => {
    await mount()
    await fire(new MouseEvent('dblclick', { bubbles: true }), app.host.querySelector('[data-node-id="l"] .node-header')!)
    expect(open).toHaveBeenCalledOnce()
  })
  it('o menu tem Abrir, Abrir em Portal e Copiar URL antes da cauda', async () => {
    await mount(); await context()
    expect(items().slice(0, 5)).toEqual(['Abrir', 'Abrir em Portal', 'Copiar URL', 'Copiar Elemento', 'Duplicar'])
    await choose('Copiar URL'); expect(write).toHaveBeenCalledWith('https://exemplo.dev/doc')
    await context(); await choose('Abrir'); expect(open).toHaveBeenCalledWith('https://exemplo.dev/doc')
    await context(); await choose('Abrir em Portal'); expect(add).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'portal' }))
  })
  it('colar um endereço pelo menu ou por Ctrl+V cria o cartão', async () => {
    await mount({})
    clipboard.text = ' https://exemplo.dev/colado '
    const canvas = app.host.querySelector('.canvas')!
    await fire(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 }), canvas); await choose('Colar')
    expect(add).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'link', url: 'https://exemplo.dev/colado', name: 'exemplo.dev' }))
    add.mockClear()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true })) }); await settle()
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'link', url: 'https://exemplo.dev/colado' }))
  })
  it('Ctrl+V continua colando os elementos copiados, e um texto comum não cria nada', async () => {
    await mount()
    const clip = elementClipboard.set(captureSelection(emptyWorkspace({ nodes: { l: card() } as never }), ['l'], []))
    const paste = async () => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true })) }); await settle() }
    clipboard.text = clip.token; await paste(); expect(commit).toHaveBeenCalledOnce(); expect(add).not.toHaveBeenCalled()
    commit.mockClear(); clipboard.text = 'só um texto'; await paste(); expect(commit).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled()
  })
})
