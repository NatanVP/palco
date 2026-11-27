// @vitest-environment happy-dom
// nota ligada a um arquivo .md do disco.
import { act } from 'react'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync, chmodSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/main/domain/workspace-store'
import { CanvasHistory } from '../src/main/history/canvas-history'
import { LinkedNotes } from '../src/main/notes/linked-notes'
import { parseNewNode } from '../src/main/validate'
import { capturePartitura } from '../src/main/partituras/insert'
import { readNoteText } from '../src/main/file-ops'
import { PartituraStore } from '../src/main/partituras/partitura-store'
import { nodesForDrop } from '../src/renderer/src/canvas/drop'
import { captureSelection } from '../src/renderer/src/canvas/selection/group'
import { defaultPreferences } from '../src/shared/preferences'
import { emptyWorkspace, mountApp, type Harness } from './helpers/app-harness'
import type { NewNode, NoteNode } from '../src/shared/model'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-nota-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const file = (name: string, content: string): string => { const p = join(dir, name); writeFileSync(p, content); return p }
const note = (extra: object = {}): NewNode => ({ kind: 'note', floorId: null, name: 'N', content: '', pos: { x: 0, y: 0 }, size: { w: 200, h: 100 }, ...extra }) as NewNode

describe('sincronização com o arquivo', () => {
  let store: WorkspaceStore, links: LinkedNotes, off: () => void
  beforeEach(() => { store = new WorkspaceStore(join(dir, 'ws.json')); links = new LinkedNotes(() => [store]); off = store.onChange(() => links.sync()) })
  afterEach(() => { off(); links.dispose(); store.dispose() })
  const get = (id: string) => store.get().nodes[id] as NoteNode

  it('ao ligar, o arquivo manda; editar a nota (interface ou CLI) grava no arquivo, sem mudar a permissão dele', () => {
    const path = file('guia.md', '# do disco'); chmodSync(path, 0o640)
    const id = store.addNode(note({ content: 'cópia velha', linkedFile: path }))
    expect(get(id).content).toBe('# do disco'); expect(readFileSync(path, 'utf8')).toBe('# do disco')
    store.patchNode(id, { content: '# editado' })
    expect(readFileSync(path, 'utf8')).toBe('# editado'); expect(statSync(path).mode & 0o777).toBe(0o640)
  })
  it('mudança de fora atualiza a nota, inclusive travada', () => {
    const path = file('a.md', 'um'), id = store.addNode(note({ linkedFile: path }))
    store.patchNode(id, { locked: true })
    writeFileSync(path, 'dois'); links.fileChanged(path)
    expect(get(id).content).toBe('dois')
  })
  it('o observador de arquivos percebe sozinho a gravação por troca de nome, como fazem os editores', async () => {
    const path = file('w.md', 'um'), id = store.addNode(note({ linkedFile: path }))
    writeFileSync(join(dir, '.tmp'), 'trocado'); const { renameSync } = await import('node:fs'); renameSync(join(dir, '.tmp'), path)
    await vi.waitFor(() => expect(get(id).content).toBe('trocado'), { timeout: 4000 })
  })
  it('arquivo ausente é sinalizado e o último texto fica; editar recria o arquivo', () => {
    const path = file('s.md', 'ainda'), id = store.addNode(note({ linkedFile: path }))
    rmSync(path); links.fileChanged(path)
    expect(get(id)).toMatchObject({ content: 'ainda', fileMissing: true })
    store.patchNode(id, { content: 'de novo' })
    expect(readFileSync(path, 'utf8')).toBe('de novo'); expect(get(id).fileMissing).toBeUndefined()
  })
  it('ligar a um arquivo que não existe não o cria', () => {
    const path = join(dir, 'nunca.md'), id = store.addNode(note({ content: 'x', linkedFile: path }))
    expect(existsSync(path)).toBe(false); expect(get(id)).toMatchObject({ content: 'x', fileMissing: true })
  })
  it('nunca grava em binário, em link que sai da pasta, nem em arquivo grande demais', () => {
    const outside = mkdtempSync(join(tmpdir(), 'palco-fora-')); writeFileSync(join(outside, 'alvo.md'), 'segredo'); mkdirSync(join(dir, 'p')); symlinkSync(join(outside, 'alvo.md'), join(dir, 'p', 'link.md'))
    for (const path of [file('bin.md', 'a\0b'), join(dir, 'p', 'link.md'), file('grande.md', 'x'.repeat(300 * 1024))]) {
      const before = readFileSync(path, 'utf8'), id = store.addNode(note({ content: 'meu', linkedFile: path }))
      expect(get(id)).toMatchObject({ content: 'meu', fileMissing: true })
      store.patchNode(id, { content: 'por cima' })
      expect(readFileSync(path, 'utf8')).toBe(before)
    }
    rmSync(outside, { recursive: true, force: true })
  })
  it('o desfazer não escreve no arquivo, e uma mudança de fora não apaga a pilha', () => {
    const history = new CanvasHistory(), path = file('h.md', 'disco'), id = store.addNode(note({ linkedFile: path })), other = store.addNode(note())
    history.observe(store)
    history.transact(store, () => store.patchNode(other, { content: 'outra' }))
    writeFileSync(path, 'mudou fora'); links.fileChanged(path)
    expect(history.observe(store)).toBe(false); expect(history.canUndo(store)).toBe(true)
    history.undo(store); expect(get(id).content).toBe('mudou fora'); expect(readFileSync(path, 'utf8')).toBe('mudou fora')
    history.transact(store, () => store.removeNode(id)); writeFileSync(path, 'enquanto apagada')
    history.undo(store)
    expect(readFileSync(path, 'utf8')).toBe('enquanto apagada'); expect(get(id).content).toBe('enquanto apagada')
  })
  it('"Mover para fora" grava o texto no destino e liga; "Salvar no palco" solta e deixa o arquivo', () => {
    const id = store.addNode(note({ content: 'meu texto' })), path = join(dir, 'saiu.md')
    links.moveOut(store, id, path)
    expect(readFileSync(path, 'utf8')).toBe('meu texto'); expect(get(id)).toMatchObject({ linkedFile: path, name: 'saiu' })
    store.unlinkNote(id); expect(get(id).linkedFile).toBeUndefined(); expect(get(id).content).toBe('meu texto')
    store.patchNode(id, { content: 'só aqui' }); expect(readFileSync(path, 'utf8')).toBe('meu texto')
    expect(() => links.moveOut(store, id, join(dir, 'x.sh'))).toThrow()
  })
  it('o nome segue o arquivo: não se renomeia, nem pela primeira linha', () => {
    const path = file('fixo.md', '# Outro título'), id = store.addNode(note({ name: 'fixo', linkedFile: path }))
    expect(() => store.patchNode(id, { name: 'novo' })).toThrow(); store.renameNoteAuto(id, 'Outro título'); expect(get(id).name).toBe('fixo')
  })
})

describe('quem pode ligar', () => {
  it('só um caminho absoluto de .md, .markdown ou .txt', () => {
    expect(parseNewNode(note({ linkedFile: '/h/a.md' }))).toMatchObject({ linkedFile: '/h/a.md' })
    for (const bad of ['a.md', '/h/.bashrc', '/h/a.sh', '/h/a.md\n']) expect(() => parseNewNode(note({ linkedFile: bad })), bad).toThrow()
  })
  it('texto que não é UTF-8 não vira nota (fica como arquivo)', async () => {
    const bad = join(dir, 'latin1.txt'); writeFileSync(bad, Buffer.from([0x61, 0xe9, 0x62]))
    expect(await readNoteText(bad)).toBeNull(); expect(await readNoteText(file('ok.txt', 'aé'))).toBe('aé')
  })
  it('partitura não leva o vínculo, nem ao salvar nem ao importar', () => {
    const ws = emptyWorkspace({ nodes: { a: { ...note({ content: 'c', linkedFile: '/h/a.md' }), id: 'a' } as never } })
    expect(capturePartitura(ws, null, { noteText: true }).nodes[0]).not.toHaveProperty('linkedFile')
    const lib = new PartituraStore(join(dir, 'lib'))
    lib.import(JSON.stringify({ format: 'palco-partituras', version: 1, partituras: [{ name: 'F', createdAt: '2026-11-25', bands: [], connections: [], nodes: [{ key: 'a', ...note({ linkedFile: '/h/a.md' }) }] }] }))
    expect(lib.get('F').nodes[0]).not.toHaveProperty('linkedFile')
  })
  it('soltar um .md cria a nota ligada e formatada; com "Sempre copiar arquivos" ela fica solta; copiar a nota leva o vínculo', () => {
    const items = [{ path: '/h/n.md', kind: 'file' as const, note: true, text: '# oi' }], prefs = { ...defaultPreferences(), defaultNoteRender: 'raw' as const }
    expect(nodesForDrop(items, { x: 0, y: 0 }, prefs, null)[0]).toMatchObject({ kind: 'note', name: 'n', linkedFile: '/h/n.md', render: 'markdown' })
    expect(nodesForDrop([{ ...items[0]!, path: '/h/t.txt' }], { x: 0, y: 0 }, prefs, null)[0]).toMatchObject({ linkedFile: '/h/t.txt', render: 'raw' })
    expect(nodesForDrop(items, { x: 0, y: 0 }, { ...prefs, alwaysCopyAttachments: true }, null)[0]).not.toHaveProperty('linkedFile')
    const ws = emptyWorkspace({ nodes: { a: { ...note({ linkedFile: '/h/n.md' }), id: 'a' } as never } })
    expect(captureSelection(ws, ['a'], []).nodes[0]).toMatchObject({ linkedFile: '/h/n.md' })
  })
})

describe('na tela', () => {
  let app: Harness
  const api = { unlink: vi.fn(async () => {}), moveOut: vi.fn(async () => true), reveal: vi.fn(async () => {}) }
  const node = (id: string, x: number, extra: object = {}) => ({ id, kind: 'note', name: id, content: 'c', floorId: null, pos: { x, y: 200 }, size: { w: 260, h: 160 }, ...extra })
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); vi.clearAllMocks() })
  afterEach(async () => { await app.unmount(); vi.unstubAllGlobals() })
  const mount = async (nodes: object) => { app = await mountApp({ workspace: emptyWorkspace({ nodes: nodes as never }), api: { 'noteFile.unlink': api.unlink, 'noteFile.moveOut': api.moveOut as never, 'nodeState.reveal': api.reveal } }) }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const context = async (id: string) => { await act(async () => { app.host.querySelector(`[data-node-id="${id}"] .node-header`)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })) }); await settle() }
  const items = () => [...document.querySelectorAll('[role^=menuitem]')].map((e) => e.textContent!.trim())
  const choose = async (label: string) => { const el = [...document.querySelectorAll<HTMLElement>('[role^=menuitem]')].find((e) => e.textContent!.trim() === label)!; expect(el, label).toBeTruthy(); await act(async () => el.click()); await settle() }

  it('o cartão marca o arquivo ligado e avisa quando ele sumiu', async () => {
    await mount({ a: node('a', 100, { linkedFile: '/h/a.md' }), b: node('b', 500, { linkedFile: '/h/b.md', fileMissing: true }), c: node('c', 900) })
    const mark = (id: string) => app.host.querySelector(`[data-node-id="${id}"] .note-file`)
    expect(mark('a')!.getAttribute('title')).toBe('/h/a.md'); expect(mark('c')).toBeNull()
    expect(app.host.querySelector('[data-node-id="b"] .file-flag')!.textContent).toBe('arquivo não encontrado'); expect(app.host.querySelector('[data-node-id="a"] .file-flag')).toBeNull()
  })
  it('menu da nota ligada: sem Renomear, com Mostrar na Pasta e Salvar no palco', async () => {
    await mount({ a: node('a', 100, { linkedFile: '/h/a.md' }) }); await context('a')
    expect(items()).not.toContain('Renomear'); expect(items()).toContain('Mostrar na Pasta'); expect(items()).not.toContain('Mover para fora…')
    await choose('Mostrar na Pasta'); expect(api.reveal).toHaveBeenCalledWith('a')
    await context('a'); await choose('Salvar no palco'); expect(api.unlink).toHaveBeenCalledWith('a')
  })
  it('menu da nota comum: Mover para fora', async () => {
    await mount({ c: node('c', 100) }); await context('c')
    expect(items()).toContain('Renomear'); expect(items()).not.toContain('Salvar no palco')
    await choose('Mover para fora…'); expect(api.moveOut).toHaveBeenCalledWith('c')
  })
  it('duplo clique no nome não renomeia a nota ligada', async () => {
    await mount({ a: node('a', 100, { linkedFile: '/h/a.md' }) })
    await act(async () => { app.host.querySelector('[data-node-id="a"] .node-name')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(app.host.querySelector('[data-node-id="a"] input.rename')).toBeNull()
  })
})
