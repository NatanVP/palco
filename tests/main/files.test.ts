import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listDir, MAX_DIR_ENTRIES, MAX_FILE_BYTES, MAX_TEXT_LINES, readFileForNode } from '../../src/main/files'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-files-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readFileForNode', () => {
  it('limites das constraints', () => {
    expect(MAX_FILE_BYTES).toBe(2 * 1024 * 1024)
    expect(MAX_TEXT_LINES).toBe(400)
    expect(MAX_DIR_ENTRIES).toBe(500)
  })

  it('texto curto vem inteiro', async () => {
    writeFileSync(join(dir, 'a.txt'), 'um\ndois\n')
    expect(await readFileForNode(join(dir, 'a.txt'))).toEqual({ kind: 'text', data: 'um\ndois\n', truncated: false })
  })

  it('texto corta em 400 linhas', async () => {
    writeFileSync(join(dir, 'b.md'), Array.from({ length: 1000 }, (_, i) => `linha ${i}`).join('\n'))
    const r = await readFileForNode(join(dir, 'b.md'))
    expect(r.kind).toBe('text')
    expect(r.truncated).toBe(true)
    expect(r.data.split('\n')).toHaveLength(400)
    expect(r.data.split('\n')[399]).toBe('linha 399')
  })

  it('recusa arquivo acima de 2 MB com truncated e sem dados', async () => {
    writeFileSync(join(dir, 'grande.txt'), 'x'.repeat(2 * 1024 * 1024 + 1))
    expect(await readFileForNode(join(dir, 'grande.txt'))).toEqual({ kind: 'text', data: '', truncated: true })
    writeFileSync(join(dir, 'grande.png'), Buffer.alloc(2 * 1024 * 1024 + 1))
    expect(await readFileForNode(join(dir, 'grande.png'))).toEqual({ kind: 'image', data: '', truncated: true })
  })

  it('imagem vira data: URL com o MIME certo', async () => {
    writeFileSync(join(dir, 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const r = await readFileForNode(join(dir, 'p.png'))
    expect(r).toEqual({ kind: 'image', data: 'data:image/png;base64,iVBORw==', truncated: false })
  })

  it('binário (byte nulo) não é mostrado como texto', async () => {
    writeFileSync(join(dir, 'x.bin'), Buffer.from([1, 0, 2, 3]))
    expect(await readFileForNode(join(dir, 'x.bin'))).toEqual({ kind: 'binary', data: '', truncated: false })
  })

  it('caminho relativo, diretório e inexistente são erro', async () => {
    await expect(readFileForNode('a.txt')).rejects.toThrow(/absoluto/)
    await expect(readFileForNode(dir)).rejects.toThrow(/não é um arquivo/)
    await expect(readFileForNode(join(dir, 'nada'))).rejects.toThrow()
  })
})

describe('listDir', () => {
  it('pastas primeiro, depois arquivos, em ordem alfabética', async () => {
    mkdirSync(join(dir, 'zeta'))
    mkdirSync(join(dir, 'alfa'))
    writeFileSync(join(dir, 'b.txt'), '')
    writeFileSync(join(dir, 'A.txt'), '')
    expect(await listDir(dir)).toEqual([
      { name: 'alfa', dir: true },
      { name: 'zeta', dir: true },
      { name: 'A.txt', dir: false },
      { name: 'b.txt', dir: false }
    ])
  })

  it('teto de 500 entradas', async () => {
    for (let i = 0; i < 520; i++) writeFileSync(join(dir, `f${String(i).padStart(4, '0')}`), '')
    const list = await listDir(dir)
    expect(list).toHaveLength(500)
  })

  it('caminho relativo é erro', async () => {
    await expect(listDir('rel')).rejects.toThrow(/absoluto/)
  })
})

import { expandHome, makeDirectory, outsideHome, pathExists } from '../../src/main/files'

describe('diretório do terminal novo', () => {
  it('expandHome troca ~ pela pasta pessoal', () => {
    expect(expandHome('~', '/home/u')).toBe('/home/u')
    expect(expandHome('~/proj', '/home/u')).toBe('/home/u/proj')
    expect(expandHome('/abs', '/home/u')).toBe('/abs')
    expect(expandHome('~outro/x', '/home/u')).toBe('~outro/x')
  })

  it('pathExists só para pastas', async () => {
    writeFileSync(join(dir, 'arq'), '')
    expect(await pathExists(dir)).toBe(true)
    expect(await pathExists(join(dir, 'arq'))).toBe(false)
    expect(await pathExists(join(dir, 'nada'))).toBe(false)
  })

  it('makeDirectory cria dentro da pasta pessoal (recursivo) e recusa fora dela sem confirmação', async () => {
    const home = join(dir, 'home')
    mkdirSync(home)
    await makeDirectory(join(home, 'a', 'b'), { home })
    expect(await pathExists(join(home, 'a', 'b'))).toBe(true)
    await expect(makeDirectory(join(dir, 'fora'), { home })).rejects.toThrow(/fora da pasta pessoal/)
    expect(await pathExists(join(dir, 'fora'))).toBe(false)
    // Prefixo parecido não conta como dentro: /x/home-irmao não está em /x/home.
    await expect(makeDirectory(`${home}-irmao`, { home })).rejects.toThrow(/fora da pasta pessoal/)
    await makeDirectory(join(dir, 'fora'), { home, outsideHome: true })
    expect(await pathExists(join(dir, 'fora'))).toBe(true)
    await expect(makeDirectory('relativo', { home })).rejects.toThrow(/absoluto/)
  })
})

import { symlinkSync } from 'node:fs'

describe('makeDirectory resolve symlinks antes de decidir dentro/fora da pasta pessoal', () => {
  it('~/atalho -> pasta fora da home: criar ~/atalho/nova exige a confirmação extra', async () => {
    const home = join(dir, 'home'), fora = join(dir, 'fora')
    mkdirSync(home); mkdirSync(fora)
    symlinkSync(fora, join(home, 'atalho'))
    await expect(makeDirectory(join(home, 'atalho', 'nova'), { home })).rejects.toThrow(/fora da pasta pessoal/)
    expect(await pathExists(join(fora, 'nova'))).toBe(false)
    await makeDirectory(join(home, 'atalho', 'nova', 'funda'), { home, outsideHome: true })
    expect(await pathExists(join(fora, 'nova', 'funda'))).toBe(true)
  })

  it('home acessada por um symlink continua "dentro"', async () => {
    const real = join(dir, 'real-home'), link = join(dir, 'link-home')
    mkdirSync(real)
    symlinkSync(real, link)
    await makeDirectory(join(link, 'proj', 'a'), { home: link })
    expect(await pathExists(join(real, 'proj', 'a'))).toBe(true)
    await makeDirectory(join(real, 'proj', 'b'), { home: link })
    expect(await pathExists(join(real, 'proj', 'b'))).toBe(true)
  })

  it('symlink interno à home não pede confirmação', async () => {
    const home = join(dir, 'home2')
    mkdirSync(join(home, 'projetos'), { recursive: true })
    symlinkSync(join(home, 'projetos'), join(home, 'p'))
    await makeDirectory(join(home, 'p', 'novo'), { home })
    expect(await pathExists(join(home, 'projetos', 'novo'))).toBe(true)
  })

  it('pathExists diz se o caminho real fica fora da home', async () => {
    const home = join(dir, 'home3'), fora = join(dir, 'fora3')
    mkdirSync(home); mkdirSync(fora)
    symlinkSync(fora, join(home, 'x'))
    expect(await outsideHome(join(home, 'x', 'y'), home)).toBe(true)
    expect(await outsideHome(join(home, 'z', 'y'), home)).toBe(false)
  })
})
