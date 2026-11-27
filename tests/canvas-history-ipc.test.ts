import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import type { IpcDeps } from '../src/main/ipc'
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (ch: string, fn: never) => handlers.set(ch, fn), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() } }))
import { CH, registerIpc } from '../src/main/ipc'
import { localizeMessage, setMainLocaleSource } from '../src/main/i18n'
const note = { kind: 'note', name: 'N', content: '', floorId: null, pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } }
let s: WorkspaceStore, other: WorkspaceStore, dir: string, off: () => void
const spawn = vi.fn(), dispose = vi.fn(), send = vi.fn()
const contents = { send }, event = { sender: contents, senderFrame: { parent: null, url: 'file:///app' } }
const invoke = (ch: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(ch)!(event, ...args))
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'palco-history-ipc-')); s = new WorkspaceStore(join(dir, 'a.json')); other = new WorkspaceStore(join(dir, 'b.json'))
  handlers.clear(); vi.clearAllMocks()
  const registry = {
    active: () => s, activeId: () => s.get().id,
    get: (id: string) => { if (id === s.get().id) return s; if (id === other.get().id) return other; throw new Error('workspace inexistente') },
    storeOfNode: (id: string) => s.hasNode(id) ? s : other.hasNode(id) ? other : undefined,
    node: (id: string) => s.get().nodes[id] ?? other.get().nodes[id],
    onChange: (cb: (id: string, ws: unknown) => void) => s.onChange(ws => cb(ws.id, ws)), onSidebar: () => () => {}, warning: undefined
  }
  off = registerIpc({ registry, terminals: { spawn, dispose, restart: vi.fn(async () => {}), onData: () => () => {}, onExit: () => () => {} }, floors: {}, portals: { register: vi.fn(), unregister: vi.fn() }, isPortalGuest: () => true, getWindow: () => ({ webContents: contents, isDestroyed: () => false }), isTrustedUrl: (url: string) => url === 'file:///app' } as unknown as IpcDeps)
})
afterEach(() => { setMainLocaleSource(() => ({ preference: null, system: 'pt-BR' })); off(); s.dispose(); other.dispose(); rmSync(dir, { recursive: true, force: true }) })
it('registra mutadores existentes, undo/redo IPC e mantém câmera', async () => {
  const id = await invoke(CH.nodeAdd, note) as string
  await invoke(CH.nodePatch, id, { content: 'editado' })
  await invoke(CH.wsCamera, { offset: { x: 1, y: 2 }, zoom: 2 })
  expect(await invoke(CH.historyCanUndo, s.get().id)).toBe(true)
  await invoke(CH.historyUndo, s.get().id); expect(s.get().nodes[id]).toMatchObject({ content: '' }); expect(s.get().camera.zoom).toBe(2)
  expect(await invoke(CH.historyCanRedo, s.get().id)).toBe(true)
  await invoke(CH.historyRedo, s.get().id); expect(s.get().nodes[id]).toMatchObject({ content: 'editado' })
})
it('lote de exclusão misto é um nível, restaura cordas e relança terminal; não deixa órfão ao desfazer criação', async () => {
  const n = s.addNode(note as never), t = await invoke(CH.nodeAdd, { ...note, kind: 'terminal', agent: 'shell', command: '', cwd: '/tmp' }) as string
  const edge = await invoke(CH.connAdd, t, n)
  const d = await invoke(CH.drawAdd, { floorId: null, points: [{ x: 0, y: 0 }], color: '#ffffff', width: 3 })
  await invoke(CH.historyCommit, s.get().id, [{ type: 'node.remove', id: t }, { type: 'node.remove', id: n }, { type: 'drawing.remove', id: d }])
  expect(dispose).toHaveBeenCalledWith(t)
  await invoke(CH.historyUndo, s.get().id); expect(s.get().connections).toEqual([edge]); expect(s.get().drawings).toHaveLength(1); expect(spawn).toHaveBeenCalledTimes(2)
  await invoke(CH.historyUndo, s.get().id); await invoke(CH.historyUndo, s.get().id); await invoke(CH.historyUndo, s.get().id)
  expect(s.get().nodes[t]).toBeUndefined(); expect(dispose).toHaveBeenCalledTimes(2)
})
it('falha no meio reverte lote sem PTY nem snapshots parciais; valida autoridade/workspace/tipos', async () => {
  const t = s.addNode({ ...note, kind: 'terminal', agent: 'shell', command: '', cwd: '/tmp' } as never)
  send.mockClear()
  await expect(invoke(CH.historyCommit, s.get().id, [{ type: 'node.remove', id: t }, { type: 'node.patch', id: 'missing', patch: { name: 'X' } }])).rejects.toThrow()
  expect(s.get().nodes[t]).toBeDefined(); expect(dispose).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled()
  const wsMessages = send.mock.calls.filter(c => c[0] === CH.wsChanged)
  expect(wsMessages.every(c => c[1].nodes[t])).toBe(true)
  const b = other.addNode(note as never)
  await expect(invoke(CH.historyCommit, s.get().id, [{ type: 'node.remove', id: b }])).rejects.toThrow(/outro workspace/)
  await expect(invoke(CH.historyCommit, s.get().id, [{ type: 'fake' }])).rejects.toThrow()
  await expect(invoke(CH.historyCommit, s.get().id, new Array(1001).fill({ type: 'fake' }))).rejects.toThrow()
  await expect(Promise.resolve().then(() => handlers.get(CH.historyUndo)!({ ...event, senderFrame: { parent: null, url: 'https://evil' } }, s.get().id))).rejects.toThrow(/autorizado/)
  expect(await invoke(CH.historyCanUndo, s.get().id)).toBe(false)
})
it("navegação de portal não consome níveis nem invalida redo ou rebobina a URL viva", async () => {
  const portal = s.addNode({ ...note, kind: 'portal', url: 'https://example.com/' } as never)
  const n = s.addNode(note as never)
  await invoke(CH.nodePatch, n, { pos: { x: 80, y: 100 } })
  for (let i = 0; i < 55; i++) await invoke(CH.nodePatch, portal, { url: `https://example.com/#${i}` })
  await invoke(CH.historyUndo, s.get().id)
  expect(s.get().nodes[n]!.pos).toEqual({ x: 0, y: 0 })
  expect(s.get().nodes[portal]).toMatchObject({ url: 'https://example.com/#54' })
  expect(await invoke(CH.historyCanUndo, s.get().id)).toBe(false)
  // A navigation update written by a CLI/agent must be just as harmless to redo.
  s.patchNode(portal, { url: 'https://example.com/agent' })
  expect(await invoke(CH.historyCanRedo, s.get().id)).toBe(true)
  await invoke(CH.historyRedo, s.get().id)
  expect(s.get().nodes[n]!.pos).toEqual({ x: 80, y: 100 })
  expect(s.get().nodes[portal]).toMatchObject({ url: 'https://example.com/agent' })
  await invoke(CH.nodeRemove, portal); await invoke(CH.historyUndo, s.get().id)
  expect(s.get().nodes[portal]).toMatchObject({ url: 'https://example.com/agent' })
})
it.each([CH.historyUndo, CH.historyRedo])('limpeza externa fica silenciosa e só avisa ao tentar %s', async channel => {
  const n = s.addNode(note as never)
  await invoke(CH.nodePatch, n, { pos: { x: 20, y: 0 } })
  s.patchNode(n, { content: 'alterado por agente' })
  expect(await invoke(CH.historyCanUndo, s.get().id)).toBe(false)
  expect(await invoke(CH.metaWarning)).toBeNull()
  expect(send.mock.calls.some(call => call[0] === CH.metaWarningChanged)).toBe(false)
  expect(send.mock.calls.some(call => call[0] === 'palco:history:notice')).toBe(false)
  expect(await invoke(channel, s.get().id)).toBe(false)
  expect(send).toHaveBeenCalledWith('palco:history:notice', 'Nada para desfazer: um agente alterou o canvas.')
})
it.each([CH.historyUndo, CH.historyRedo])('%s sem histórico anterior não avisa, mesmo após alteração externa', async channel => {
  const n = s.addNode(note as never)
  s.patchNode(n, { content: 'externo' })
  expect(await invoke(channel, s.get().id)).toBe(false)
  expect(send.mock.calls.some(call => call[0] === 'palco:history:notice')).toBe(false)
})
it('uma ação local nova substitui o motivo de limpeza, sem aviso depois de consumir a pilha', async () => {
  const n = s.addNode(note as never)
  await invoke(CH.nodePatch, n, { pos: { x: 20, y: 0 } })
  s.patchNode(n, { content: 'externo' })
  await invoke(CH.nodePatch, n, { pos: { x: 40, y: 0 } })
  expect(await invoke(CH.historyUndo, s.get().id)).toBe(true)
  expect(await invoke(CH.historyUndo, s.get().id)).toBe(false)
  expect(send.mock.calls.some(call => call[0] === 'palco:history:notice')).toBe(false)
})
it("falha ao iniciar terminal avulso mantém o card, histórico e aviso para corrigir/reiniciar", async () => {
  spawn.mockImplementationOnce(() => { throw new Error('role ilegível') })
  const id = await invoke(CH.nodeAdd, { ...note, kind: 'terminal', agent: 'shell', command: '', cwd: '/tmp' }) as string
  expect(s.get().nodes[id]).toMatchObject({ kind: 'terminal', cwd: '/tmp' })
  expect(await invoke(CH.metaWarning)).toMatch(/iniciar.*terminal/i)
  expect(await invoke(CH.historyCanUndo, s.get().id)).toBe(true)
  await invoke(CH.termRestart, id); expect(await invoke(CH.metaWarning)).toBeNull()
  await invoke(CH.historyUndo, s.get().id); expect(s.get().nodes[id]).toBeUndefined()
})
it.each([CH.historyUndo, CH.historyRedo])("%s recusa workspace fora da tela antes de tocar documento/runtime", async channel => {
  const id = other.addNode(note as never)
  await invoke(CH.nodePatch, id, { pos: { x: 40, y: 20 } })
  await expect(invoke(channel, other.get().id)).rejects.toThrow(/ativo/)
  expect(other.get().nodes[id]!.pos).toEqual({ x: 40, y: 20 })
  expect(spawn).not.toHaveBeenCalled(); expect(dispose).not.toHaveBeenCalled()
})
it('drawing.patch em lote: um nível só, mantém os ids, e o Ctrl+Z restaura o estilo antigo', async () => {
  const a = await invoke(CH.drawAdd, { floorId: null, points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], color: '#ffffff', width: 3, tool: 'rect' }) as string
  const b = await invoke(CH.drawAdd, { floorId: null, points: [{ x: 1, y: 1 }, { x: 8, y: 8 }], color: '#ffffff', width: 3, tool: 'ellipse' }) as string
  await invoke(CH.historyCommit, s.get().id, [{ type: 'drawing.patch', id: a, patch: { color: '#007AFF', fill: 'solid', radius: 12 } }, { type: 'drawing.patch', id: b, patch: { color: '#007AFF', fill: 'solid' } }])
  expect(s.get().drawings!.map(d => [d.id, d.color, d.fill])).toEqual([[a, '#007AFF', 'solid'], [b, '#007AFF', 'solid']]); expect(s.get().drawings![0]!.radius).toBe(12)
  await invoke(CH.historyUndo, s.get().id)
  expect(s.get().drawings!.map(d => [d.id, d.color, d.fill])).toEqual([[a, '#ffffff', undefined], [b, '#ffffff', undefined]])
  await invoke(CH.historyCommit, s.get().id, [{ type: 'drawing.patch', id: b, patch: { control: { x: 4, y: 20 } } }]); expect(s.get().drawings![1]!.control).toEqual({ x: 4, y: 20 })
  await invoke(CH.historyCommit, s.get().id, [{ type: 'drawing.patch', id: b, patch: { control: null } }]); expect(s.get().drawings![1]).not.toHaveProperty('control')
  await expect(invoke(CH.historyCommit, s.get().id, [{ type: 'drawing.patch', id: a, patch: { points: [] } }])).rejects.toThrow()
  await expect(invoke(CH.historyCommit, s.get().id, [{ type: 'drawing.patch', id: 'nao-existe', patch: { fill: 'solid' } }])).rejects.toThrow(/desenho/)
})

it('drawing.patch de pontos e giro: mantém o id, vira um nível e o Ctrl+Z volta tudo', async () => {
  const a = await invoke(CH.drawAdd, { floorId: null, points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], color: '#ffffff', width: 3, tool: 'rect', text: 'Oi', textSize: 20 }) as string
  await invoke(CH.historyCommit, s.get().id, [{ type: 'drawing.patch', id: a, patch: { points: [{ x: 0, y: 0 }, { x: 200, y: 100 }], rotation: 0.7, textSize: 40 } }])
  expect(s.get().drawings![0]).toMatchObject({ id: a, points: [{ x: 0, y: 0 }, { x: 200, y: 100 }], rotation: 0.7, textSize: 40 })
  await invoke(CH.historyCommit, s.get().id, [{ type: 'drawing.patch', id: a, patch: { rotation: 0 } }]); expect(s.get().drawings![0]).not.toHaveProperty('rotation')
  await invoke(CH.historyUndo, s.get().id); await invoke(CH.historyUndo, s.get().id)
  expect(s.get().drawings![0]).toMatchObject({ points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], textSize: 20 }); expect(s.get().drawings![0]).not.toHaveProperty('rotation')
})

it('limpar apenas a pilha de refazer também avisa; câmera e consulta não consomem o motivo', async () => {
  const n = await invoke(CH.nodeAdd, note) as string
  await invoke(CH.historyUndo, s.get().id)
  s.addNode(note as never)
  await invoke(CH.wsCamera, { offset: { x: 1, y: 2 }, zoom: 2 })
  expect(s.hasNode(n)).toBe(false)
  expect(await invoke(CH.historyCanRedo, s.get().id)).toBe(false)
  expect(await invoke(CH.historyRedo, s.get().id)).toBe(false)
  expect(send).toHaveBeenCalledWith(CH.historyNotice, 'Nada para desfazer: um agente alterou o canvas.')
})
it.each([['en', 'Nothing to undo: an agent changed the canvas.'], ['pt-BR', 'Nada para desfazer: um agente alterou o canvas.']] as const)('o aviso chega à janela em %s', async (locale, message) => {
  const n = await invoke(CH.nodeAdd, note) as string
  s.patchNode(n, { content: 'externo' })
  setMainLocaleSource(() => ({ preference: locale, system: locale }))
  await invoke(CH.historyUndo, s.get().id)
  expect(send).toHaveBeenCalledWith(CH.historyNotice, message)
})

it('o catálogo espanhol traduz o aviso de histórico', () => {
  expect(localizeMessage('Nada para desfazer: um agente alterou o canvas.', 'es')).toBe('Nada que deshacer: un agente modificó el canvas.')
})
it('trocar de andar elimina o motivo de limpeza anterior, mesmo voltando ao térreo', async () => {
  const floor = s.addFloor({ name: 'Andar', dir: '/tmp', branch: '', baseRef: '', repoRoot: '/tmp', plain: true })
  const n = await invoke(CH.nodeAdd, note) as string
  s.patchNode(n, { content: 'externo' })
  s.setActiveFloor(floor)
  expect(await invoke(CH.historyUndo, s.get().id)).toBe(false)
  s.setActiveFloor(null)
  expect(await invoke(CH.historyRedo, s.get().id)).toBe(false)
  expect(send.mock.calls.some(call => call[0] === CH.historyNotice)).toBe(false)
})
