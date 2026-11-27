import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renameEntry, storeAttachment, trashEntry } from '../src/main/file-ops'

let dir: string, home: string, store: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-fops-')); home = join(dir, 'home'); store = join(home, '.palco', 'attachments'); mkdirSync(join(home, 'p'), { recursive: true }) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const put = (rel: string, c = 'x'): string => { const p = join(home, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); return p }

describe('mover para a lixeira', () => {
  it('manda o arquivo ou a pasta para a lixeira do sistema (função injetada), não apaga direto', async () => {
    const trashed: string[] = [], f = put('p/a.txt'); await trashEntry(f, home, async p => { trashed.push(p) }); expect(trashed).toHaveLength(1); expect(trashed[0]).toMatch(/^\/proc\/\d+\/fd\/\d+\/a\.txt$/); expect(existsSync(f)).toBe(true)
  })
  it('recusa relativo, a própria pasta pessoal, a raiz, o que está fora da pasta pessoal e o que não existe', async () => {
    const none = async () => {}
    for (const p of ['rel/a', home, '/', '/etc/passwd', join(home, 'nao-existe')]) await expect(trashEntry(p, home, none), p).rejects.toThrow()
  })
  it('recusa a pasta de dados; link externo é operado como entrada local', async () => {
    const none = async () => {}; mkdirSync(join(home, '.palco'), { recursive: true }); await expect(trashEntry(join(home, '.palco'), home, none)).rejects.toThrow(/palco/)
    const outside = join(dir, 'fora.txt'); writeFileSync(outside, 'x'); const link = join(home, 'p', 'link'); symlinkSync(outside, link); await expect(trashEntry(link, home, none)).resolves.toBeUndefined(); expect(readFileSync(outside, 'utf8')).toBe('x')
  })
})
describe('renomear', () => {
  it('renomeia no mesmo diretório e devolve o novo caminho', async () => {
    const f = put('p/a.txt', 'oi'); const novo = await renameEntry(f, 'b.txt', home); expect(novo).toBe(join(home, 'p', 'b.txt')); expect(readFileSync(novo, 'utf8')).toBe('oi'); expect(existsSync(f)).toBe(false)
  })
  it('recusa nome com barra, ponto-ponto, vazio, longo demais e destino que já existe (nunca sobrescreve)', async () => {
    const f = put('p/a.txt'); put('p/b.txt')
    for (const n of ['x/y', '..', '.', '', ' ', 'a'.repeat(256), 'a\0b']) await expect(renameEntry(f, n, home), JSON.stringify(n)).rejects.toThrow()
    await expect(renameEntry(f, 'b.txt', home)).rejects.toThrow(/já existe/); expect(existsSync(f)).toBe(true)
  })
  it('vale as mesmas travas de caminho da lixeira', async () => { await expect(renameEntry('/etc/hostname', 'x', home)).rejects.toThrow(); await expect(renameEntry(home, 'x', home)).rejects.toThrow() })
})
describe('copiar anexo para o espaço de trabalho', () => {
  it('copia para a pasta de anexos do palco com nome único e devolve o caminho novo', async () => {
    const src = put('p/relatorio.pdf', 'dados'); const a = await storeAttachment(src, store), b = await storeAttachment(src, store)
    expect(a.startsWith(store)).toBe(true); expect(a.endsWith('relatorio.pdf')).toBe(true); expect(readFileSync(a, 'utf8')).toBe('dados'); expect(a).not.toBe(b); expect(readFileSync(src, 'utf8')).toBe('dados')
  })
  it('recusa relativo, pasta, vazio e grande demais; limpa o nome', async () => {
    await expect(storeAttachment('rel.txt', store)).rejects.toThrow(); await expect(storeAttachment(join(home, 'p'), store)).rejects.toThrow(); await expect(storeAttachment(put('p/vazio', ''), store)).rejects.toThrow()
    const odd = put('p/..evil name?.txt', 'x'); const saved = await storeAttachment(odd, store); expect(saved.startsWith(store)).toBe(true); expect(saved.split('/').pop()).toMatch(/^[0-9a-f-]{36}-evil name_\.txt$/)
  })
})

import { pathKind, readNoteText } from '../src/main/file-ops'
import { nodesForDrop } from '../src/renderer/src/canvas/drop'
import { defaultPreferences } from '../src/shared/preferences'
describe('o que soltar no canvas vira', () => {
  it('pathKind: pasta, arquivo, texto pequeno como nota; relativo e inexistente são nada', async () => {
    expect(await pathKind(join(home, 'p'))).toEqual({ kind: 'dir', note: false }); expect(await pathKind(put('p/a.png', 'x'))).toEqual({ kind: 'file', note: false })
    expect(await pathKind(put('p/n.md', '# oi'))).toEqual({ kind: 'file', note: true }); expect(await pathKind(put('p/grande.txt', 'x'.repeat(300 * 1024)))).toEqual({ kind: 'file', note: false })
    expect(await pathKind('rel')).toBeNull(); expect(await pathKind(join(home, 'sumiu'))).toBeNull()
  })
  it('readNoteText: só texto pequeno; binário e fora do padrão são null', async () => {
    expect(await readNoteText(put('p/n.md', '# oi'))).toBe('# oi'); expect(await readNoteText(put('p/b.txt', 'a\0b'))).toBeNull(); expect(await readNoteText(put('p/x.png', 'x'))).toBeNull()
  })
  const prefs = defaultPreferences()
  it('pasta → árvore; md/txt → nota com o conteúdo e os padrões; o resto → arquivo; nada some em silêncio', () => {
    const nodes = nodesForDrop([{ path: '/h/proj', kind: 'dir', note: false }, { path: '/h/n.md', kind: 'file', note: true, text: '# oi' }, { path: '/h/a.pdf', kind: 'file', note: false }, { path: '/h/x', kind: null, note: false }], { x: 400, y: 300 }, prefs, null)
    expect(nodes.map(n => n.kind)).toEqual(['filetree', 'note', 'file'])
    expect(nodes[1]).toMatchObject({ name: 'n', content: '# oi', render: 'markdown', size: { w: 260, h: 160 } }); expect(nodes[2]).toMatchObject({ path: '/h/a.pdf', name: 'a.pdf' })
    expect(new Set(nodes.map(n => `${n.pos.x},${n.pos.y}`)).size).toBe(3)
  })
  it('"Sempre copiar arquivos": o nó arquivo aponta para a cópia; pasta e nota não mudam', () => {
    const n = nodesForDrop([{ path: '/h/a.pdf', kind: 'file', note: false }, { path: '/h/proj', kind: 'dir', note: false }], { x: 0, y: 0 }, prefs, 'f1', { '/h/a.pdf': '/h/.palco/attachments/1234-a.pdf' })
    expect(n[0]).toMatchObject({ kind: 'file', path: '/h/.palco/attachments/1234-a.pdf', name: 'a.pdf', floorId: 'f1' }); expect(n[1]).toMatchObject({ kind: 'filetree', root: '/h/proj' })
  })
})
