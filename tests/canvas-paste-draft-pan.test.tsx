// @vitest-environment happy-dom
// Navegação do canvas e interações auxiliares preservam foco e estado.
import { readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Canvas } from '../src/renderer/src/canvas/Canvas'
import { Composer } from '../src/renderer/src/composer/Composer'
import { ContextualBar } from '../src/renderer/src/canvas/ContextualBar'
import { readEditor, setEditorSelection } from '../src/renderer/src/composer/editor'
import { setComposerMode } from '../src/renderer/src/composer/composer-mode'
import { clearDraft } from '../src/renderer/src/composer/composer-drafts'
import { useHudGeometry } from '../src/renderer/src/composer/hud-geometry'
import { adoptPreferences, suspendShortcuts } from '../src/renderer/src/settings/preferences'
import { createPastedFiles, MAX_PASTED_BYTES } from '../src/main/pasted-files'
import { defaultPreferences } from '../src/shared/preferences'
import { defaultShortcuts, matchShortcut } from '../src/shared/shortcuts'
import { setLocale } from '../src/shared/i18n/runtime'
import type { TerminalNode, Workspace } from '../src/shared/model'
vi.mock('../src/renderer/src/nodes/TerminalView', () => ({ TerminalView: () => null }))

const node: TerminalNode = { id: 'mn', kind: 'terminal', name: 'A', agent: 'claude', command: 'claude', cwd: '/tmp', floorId: null, pos: { x: 0, y: 0 }, size: { w: 600, h: 300 } }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, send: ReturnType<typeof vi.fn>, materialize: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); suspendShortcuts(false); setLocale('pt-BR'); clearDraft(node.id)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  send = vi.fn(async () => ({ accepted: true })); materialize = vi.fn(async () => '/tmp/palco-anexos-x/1-imagem-colada.png')
  Object.assign(window, { palco: { chat: { send, state: () => new Promise(() => {}), onChange: () => () => {} }, files: { pathOf: (f: File) => (f.name === 'doc.txt' ? '/home/eu/doc.txt' : ''), materialize }, workspace: { get: async () => ({ nodes: {}, floors: {} }), onChange: () => () => {} }, workspaces: { sidebar: async () => ({ workspaces: [] }) } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setComposerMode(node.id, 'off'); vi.unstubAllGlobals(); vi.useRealTimers() })
const mount = async () => { setComposerMode(node.id, 'overlay'); await act(async () => root.render(<Composer node={node} />)) }
const editor = () => host.querySelector<HTMLDivElement>('[data-composer-editor]')!
const type = async (text: string) => act(async () => { const a = editor(); a.focus(); a.replaceChildren(document.createTextNode(text)); setEditorSelection(a, text.length); a.dispatchEvent(new Event('input', { bubbles: true })) })
const enter = async () => act(async () => { editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
const paste = async (files: File[], text = '') => act(async () => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => text } }); editor().dispatchEvent(event); await new Promise((r) => setTimeout(r, 10))
})

describe("colar imagem", () => {
  it('uma imagem sem caminho é materializada e vira anexo; o texto colado junto não se perde', async () => {
    await mount(); await type('veja ')
    await paste([new File([new Uint8Array([0x89, 80, 78, 71])], 'image.png', { type: 'image/png' })], 'legenda do print')
    expect(materialize).toHaveBeenCalledWith('image.png', 'image/png', expect.any(ArrayBuffer))
    expect(host.querySelector('[data-composer-attachment="/tmp/palco-anexos-x/1-imagem-colada.png"]')).toBeTruthy()
    await enter()
    expect(send).toHaveBeenCalledWith(node.id, { text: 'veja legenda do print', attachments: ['/tmp/palco-anexos-x/1-imagem-colada.png'] })
  })
  it('arquivo com caminho não é copiado; o texto que só repete o nome ou o caminho dele não entra duas vezes', async () => {
    await mount(); await paste([new File(['a'], 'doc.txt')], 'file:///home/eu/doc.txt')
    expect(materialize).not.toHaveBeenCalled(); expect(host.querySelectorAll('[data-composer-attachment]')).toHaveLength(1)
    expect(readEditor(editor())).not.toContain('file://')
  })
  it('se não der para guardar a imagem, avisa e ainda cola o texto', async () => {
    materialize.mockRejectedValue(new Error('disco cheio')); await mount()
    await paste([new File(['x'], 'image.png', { type: 'image/png' })], 'texto junto')
    expect(host.querySelector('[role=alert]')?.textContent).toContain('anexar'); expect(readEditor(editor())).toBe('texto junto')
  })
  it('o main grava numa pasta temporária própria (0700/0600), com nome seguro, limite de tamanho e limpeza ao sair', () => {
    const store = createPastedFiles(tmpdir())
    const a = store.write('../../.env', 'image/png', new Uint8Array([1, 2, 3])), b = store.write('', 'image/jpeg', new Uint8Array([4]))
    try {
      expect(dirname(a)).toBe(dirname(b)); expect(dirname(a).startsWith(join(tmpdir(), 'palco-anexos-'))).toBe(true)
      expect(statSync(dirname(a)).mode & 0o777).toBe(0o700); expect(statSync(a).mode & 0o777).toBe(0o600); expect([...readFileSync(a)]).toEqual([1, 2, 3])
      expect(a.slice(dirname(a).length + 1)).toMatch(/^1-[^./][^/]*$/); expect(b.endsWith('2-imagem-colada.jpg')).toBe(true)
      expect(() => store.write('v.png', 'image/png', new Uint8Array(0))).toThrow(); expect(() => store.write('g.png', 'image/png', { byteLength: MAX_PASTED_BYTES + 1 } as never)).toThrow()
      store.dispose(); expect(() => statSync(a)).toThrow()
    } finally { rmSync(dirname(a), { recursive: true, force: true }) }
  })
})
describe("rascunho por terminal, fora do componente", () => {
  it('sobrevive a desmontar o card (trocar de andar ou de workspace), com os anexos', async () => {
    await mount(); await type('meio escrito '); await paste([new File(['a'], 'doc.txt')])
    await act(async () => root.unmount()); root = createRoot(host); await mount()
    expect(readEditor(editor())).toContain('meio escrito'); expect(host.querySelector('[data-composer-attachment="/home/eu/doc.txt"]')).toBeTruthy()
  })
  it('envio que termina depois de o card sair limpa o rascunho: nada é reenviado por engano', async () => {
    let done!: (v: unknown) => void; send.mockImplementation(() => new Promise((ok) => { done = ok }))
    await mount(); await type('uma vez'); await enter()
    await act(async () => root.unmount()); root = createRoot(host); await mount()
    expect(editor().getAttribute('aria-readonly')).toBe('true'); await enter(); expect(send).toHaveBeenCalledTimes(1)
    await act(async () => done({ accepted: true }))
    expect(readEditor(editor())).toBe(''); expect(editor().getAttribute('aria-readonly')).toBeNull()
  })
})
describe('pan por modificador e preservação de seleção', () => {
  it("Ctrl e Espaço seguram o pan por padrão", () => {
    const map = defaultShortcuts()
    expect(map.panHold).toEqual([{ key: '', ctrl: true }, { key: ' ' }])
    const k = (key: string, ctrlKey = false) => ({ key, ctrlKey, metaKey: false, shiftKey: false, altKey: false })
    expect(matchShortcut('panHold', k(' '), map)).toBe(true); expect(matchShortcut('panHold', k('Control', true), map)).toBe(true)
  })
  const ws: Workspace = { id: 'w', name: 'W', nodes: { n: { id: 'n', kind: 'note', name: 'N', content: '', floorId: null, pos: { x: 400, y: 400 }, size: { w: 100, h: 100 } } }, connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 },
    drawings: [{ id: 'd1', floorId: null, points: [{ x: 10, y: 10 }, { x: 200, y: 200 }], color: '#fff', width: 4, tool: 'line' }] }
  const canvas = async (extra: Record<string, unknown> = {}) => {
    const spy = { onCamera: vi.fn(), onSelectConn: vi.fn(), onSelectOnly: vi.fn(), onSelectMany: vi.fn(), onPlace: vi.fn() }
    await act(async () => root.render(createElement(Canvas, { ws, camera: ws.camera!, linkFrom: null, onLink: vi.fn(), selectedConn: null, selection: new Set<string>(), onToggleSelect: vi.fn(), onGoToFloor: vi.fn(), ...spy, ...extra })))
    const el = host.querySelector<HTMLElement>('.canvas')!
    el.setPointerCapture = vi.fn(); el.releasePointerCapture = vi.fn(); el.hasPointerCapture = () => true
    const pointer = async (target: Element, kind: string, x: number, mods: Record<string, unknown> = {}) => act(async () => { target.dispatchEvent(new PointerEvent(kind, { button: 0, buttons: kind === 'pointerup' ? 0 : 1, pointerId: 1, clientX: x, clientY: x, bubbles: true, ...mods })) })
    const press = async (key: string, up = false, mods: Record<string, unknown> = {}) => act(async () => { el.dispatchEvent(new KeyboardEvent(up ? 'keyup' : 'keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, ...mods })) })
    return { el, pointer, press, ...spy }
  }
  const drag = async (c: Awaited<ReturnType<typeof canvas>>, target: Element, mods: Record<string, unknown> = {}) => {
    c.onCamera.mockClear(); await c.pointer(target, 'pointerdown', 10, mods); await c.pointer(c.el, 'pointermove', 50, mods); await c.pointer(c.el, 'pointerup', 50, mods); return c.onCamera.mock.calls.length > 0
  }
  it("Ctrl+arrasto e Espaço+arrasto movem a vista; sem tecla, é laço", async () => {
    const c = await canvas()
    expect(await drag(c, c.el, { ctrlKey: true })).toBe(true)
    await c.press(' '); expect(await drag(c, c.el)).toBe(true); await c.press(' ', true)
    expect(await drag(c, c.el)).toBe(false)
  })
  it("com a tecla segurada o pan vence desenho e fundo; Ctrl+clique num card continua no card", async () => {
    const c = await canvas()
    const drawing = host.querySelector('.drawing-hit')!; expect(drawing).toBeTruthy()
    expect(await drag(c, drawing, { ctrlKey: true })).toBe(true)
    await c.press(' '); expect(await drag(c, drawing)).toBe(true); await c.press(' ', true)
    expect(await drag(c, host.querySelector('[data-node-id="n"]')!, { ctrlKey: true })).toBe(false)
    expect(await drag(c, drawing)).toBe(false) // sem tecla, o desenho é do desenho
  })
  it("pan sem deslocamento vale como clique no fundo; com deslocamento a seleção fica", async () => {
    const c = await canvas({ selection: new Set(['n']) })
    await c.pointer(c.el, 'pointerdown', 10, { ctrlKey: true }); await c.pointer(c.el, 'pointerup', 11, { ctrlKey: true })
    expect(c.onSelectConn).toHaveBeenCalledWith(null); expect(c.onSelectOnly).toHaveBeenCalledWith(null)
    c.onSelectOnly.mockClear(); await drag(c, c.el, { ctrlKey: true }); expect(c.onSelectOnly).not.toHaveBeenCalled()
  })
  it("o H mantém a ordem antiga: com a ferramenta de criar nó armada, ainda cria; no fundo, move a vista", async () => {
    const c = await canvas({ tool: 'note' })
    await c.press('h'); await c.pointer(c.el, 'pointerdown', 10); await c.pointer(c.el, 'pointermove', 300); await c.pointer(c.el, 'pointerup', 300)
    expect(c.onCamera).not.toHaveBeenCalled(); expect(c.onPlace).toHaveBeenCalled()
    await act(async () => root.unmount()); root = createRoot(host)
    const free = await canvas(); await free.press('h'); expect(await drag(free, free.el)).toBe(true)
  })
  it("o cursor de pan não pisca em Ctrl+C: só aparece se o Ctrl ficar segurado; Espaço mostra na hora", async () => {
    vi.useFakeTimers()
    const c = await canvas(), on = () => c.el.classList.contains('pan-mode')
    await c.press('Control', false, { ctrlKey: true }); expect(on()).toBe(false)
    await c.press('c', false, { ctrlKey: true }); await act(async () => { vi.advanceTimersByTime(600) }); expect(on()).toBe(false)
    await c.press('Control', true)
    await c.press('Control', false, { ctrlKey: true }); await act(async () => { vi.advanceTimersByTime(600) }); expect(on()).toBe(true)
    await c.press('Control', true); expect(on()).toBe(false)
    await c.press(' '); expect(on()).toBe(true); await c.press(' ', true); expect(on()).toBe(false)
  })
})
it("o botão do Compositor traduz o nome da barra de espaço no atalho", async () => {
  adoptPreferences({ ...defaultPreferences(), shortcuts: { ...defaultShortcuts(), prompter: [{ key: ' ', mod: true }] } }); setLocale('en')
  const animate = Element.prototype.animate; Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true, writable: true })
  try {
    const ws: Workspace = { id: 'w', name: 'W', nodes: { mn: node }, connections: [], floors: {}, activeFloor: null, camera: { zoom: 1, offset: { x: 0, y: 0 } } }
    await act(async () => root.render(<ContextualBar ws={ws} selection={new Set(['mn'])} linkFrom={null} onLink={vi.fn()} onEdit={vi.fn()} onCreateBand={vi.fn()} onFocus={vi.fn()} onCleared={vi.fn()} onError={vi.fn()} modeHint={null} />))
    expect(host.querySelector('[aria-label="Prompter"]')!.getAttribute('title')).toBe('Prompter (Ctrl/Cmd+Space)')
  } finally { Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true }); setLocale('pt-BR') }
})
it("parada, a HUD não mede a cada quadro; mede de novo quando o zoom (o mundo) muda", async () => {
  const frames = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(0), 1) as unknown as number)
  vi.stubGlobal('requestAnimationFrame', frames); vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  let width = 600
  function Hud() { const ref = useRef<HTMLDivElement>(null); const style = useHudGeometry(ref, 'overlay'); return <div ref={ref} data-testid="hud" data-width={String(style.width ?? '')} /> }
  const world = document.createElement('div'); world.className = 'world'; const card = document.createElement('div'); card.setAttribute('data-node-id', 'z'); world.append(card); host.append(world)
  Object.defineProperty(card, 'offsetWidth', { get: () => 600 }); card.getBoundingClientRect = () => ({ width }) as DOMRect
  const inner = createRoot(card), wait = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })
  await act(async () => inner.render(<Hud />)); await wait()
  const hud = () => card.querySelector('[data-testid="hud"]')!.getAttribute('data-width')
  expect(hud()).toBe('560'); const before = frames.mock.calls.length; await wait(); expect(frames.mock.calls.length - before).toBeLessThanOrEqual(1)
  width = 300; await act(async () => { world.setAttribute('style', 'transform: scale(0.5)') }); await wait(); expect(hud()).toBe('276')
  await act(async () => inner.unmount())
})
