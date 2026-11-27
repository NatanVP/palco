import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendFileSync, renameSync, truncateSync } from 'node:fs'
import { deleteWorkspaceIcon, iconTestHooks, loadWorkspaceIcon, MAX_ICON_BYTES, saveWorkspaceIcon } from '../src/main/workspace-icon'
import { ICON_SIZE, fitInSquare } from '../src/renderer/src/sidebar/icon-fit'

const ID = '11111111-1111-4111-8111-111111111111'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-icon-')) })
afterEach(() => {
  delete iconTestHooks.afterAnchor
  delete iconTestHooks.afterOpen
  rmSync(dir, { recursive: true, force: true })
})

describe('icon.png do workspace', () => {
  it('grava na pasta do workspace (escrita atômica, sem sobras) e lê como data URL', () => {
    saveWorkspaceIcon(dir, ID, PNG)
    const file = join(dir, ID, 'icon.png')
    expect([...readFileSync(file)]).toEqual([...PNG])
    expect(readdirSync(join(dir, ID))).toEqual(['icon.png'])
    expect(lstatSync(file).mode & 0o777).toBe(0o600)
    expect(loadWorkspaceIcon(dir, ID)).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
  })

  it('recusa o que não é PNG e o que passa de 4 MiB', () => {
    expect(() => saveWorkspaceIcon(dir, ID, Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))).toThrow(/PNG/)
    const big = new Uint8Array(MAX_ICON_BYTES + 1)
    big.set(PNG)
    expect(() => saveWorkspaceIcon(dir, ID, big)).toThrow(/4 MiB/)
    expect(MAX_ICON_BYTES).toBe(4 * 1024 * 1024)
    expect(existsSync(join(dir, ID, 'icon.png'))).toBe(false)
  })

  it('recusa id inválido (sem sair da pasta)', () => {
    expect(() => saveWorkspaceIcon(dir, '../fora', PNG)).toThrow()
    expect(loadWorkspaceIcon(dir, '../fora')).toBeNull()
  })

  it('recusa symlink: na pasta do workspace e no próprio icon.png', () => {
    const outside = mkdtempSync(join(tmpdir(), 'palco-icon-out-'))
    try {
      symlinkSync(outside, join(dir, ID))
      expect(() => saveWorkspaceIcon(dir, ID, PNG)).toThrow(/link/)
      expect(readdirSync(outside)).toEqual([])
      rmSync(join(dir, ID))
      mkdirSync(join(dir, ID))
      writeFileSync(join(outside, 'alvo.png'), PNG)
      symlinkSync(join(outside, 'alvo.png'), join(dir, ID, 'icon.png'))
      expect(loadWorkspaceIcon(dir, ID)).toBeNull()
      expect(() => saveWorkspaceIcon(dir, ID, PNG)).toThrow(/link/)
      expect([...readFileSync(join(outside, 'alvo.png'))]).toEqual([...PNG])
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it('apagar remove só o icon.png; sem ícone a leitura dá null', () => {
    saveWorkspaceIcon(dir, ID, PNG)
    deleteWorkspaceIcon(dir, ID)
    expect(existsSync(join(dir, ID, 'icon.png'))).toBe(false)
    expect(loadWorkspaceIcon(dir, ID)).toBeNull()
    expect(() => deleteWorkspaceIcon(dir, ID)).not.toThrow()
  })

  it('leitura ignora arquivo que não é PNG', () => {
    mkdirSync(join(dir, ID))
    writeFileSync(join(dir, ID, 'icon.png'), 'não sou png')
    expect(loadWorkspaceIcon(dir, ID)).toBeNull()
  })
})

describe('operações ancoradas em descritor (troca concorrente)', () => {
  const swapFolderForLink = (outside: string): void => {
    renameSync(join(dir, ID), join(dir, 'movida'))
    symlinkSync(outside, join(dir, ID))
  }

  it('save: pasta trocada por symlink depois da abertura grava na pasta original, nunca no alvo do link', () => {
    mkdirSync(join(dir, ID))
    const outside = mkdtempSync(join(tmpdir(), 'palco-icon-out-'))
    try {
      iconTestHooks.afterAnchor = () => swapFolderForLink(outside)
      saveWorkspaceIcon(dir, ID, PNG)
      expect(readdirSync(outside)).toEqual([])
      expect([...readFileSync(join(dir, 'movida', 'icon.png'))]).toEqual([...PNG])
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it('delete: pasta trocada por symlink não apaga o icon.png de fora', () => {
    saveWorkspaceIcon(dir, ID, PNG)
    const outside = mkdtempSync(join(tmpdir(), 'palco-icon-out-'))
    try {
      writeFileSync(join(outside, 'icon.png'), PNG)
      iconTestHooks.afterAnchor = () => swapFolderForLink(outside)
      deleteWorkspaceIcon(dir, ID)
      expect(existsSync(join(outside, 'icon.png'))).toBe(true)
      expect(existsSync(join(dir, 'movida', 'icon.png'))).toBe(false)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it('load: icon.png trocado por symlink (para arquivo grande) depois da checagem da pasta é recusado', () => {
    saveWorkspaceIcon(dir, ID, PNG)
    const outside = mkdtempSync(join(tmpdir(), 'palco-icon-out-'))
    try {
      const big = join(outside, 'grande.png')
      writeFileSync(big, PNG)
      truncateSync(big, MAX_ICON_BYTES * 2)
      iconTestHooks.afterAnchor = () => {
        rmSync(join(dir, ID, 'icon.png'))
        symlinkSync(big, join(dir, ID, 'icon.png'))
      }
      expect(loadWorkspaceIcon(dir, ID)).toBeNull()
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it('load: arquivo regular maior que 4 MiB é recusado', () => {
    mkdirSync(join(dir, ID))
    writeFileSync(join(dir, ID, 'icon.png'), PNG)
    truncateSync(join(dir, ID, 'icon.png'), MAX_ICON_BYTES + 1)
    expect(loadWorkspaceIcon(dir, ID)).toBeNull()
  })

  it('load: arquivo que cresce depois do fstat não passa do teto (leitura limitada pelo descritor)', () => {
    saveWorkspaceIcon(dir, ID, PNG)
    iconTestHooks.afterOpen = () => appendFileSync(join(dir, ID, 'icon.png'), new Uint8Array(MAX_ICON_BYTES))
    expect(loadWorkspaceIcon(dir, ID)).toBeNull()
  })
})

describe('encaixe sem recorte num quadrado 128×128', () => {
  it('quadrado ocupa tudo', () => {
    expect(ICON_SIZE).toBe(128)
    expect(fitInSquare(512, 512)).toEqual({ x: 0, y: 0, w: 128, h: 128 })
  })
  it('retângulo largo: largura cheia, centralizado na vertical (sobra transparente)', () => {
    expect(fitInSquare(400, 200)).toEqual({ x: 0, y: 32, w: 128, h: 64 })
  })
  it('retângulo alto: altura cheia, centralizado na horizontal', () => {
    expect(fitInSquare(100, 400)).toEqual({ x: 48, y: 0, w: 32, h: 128 })
  })
  it('imagem pequena é ampliada até caber', () => {
    expect(fitInSquare(32, 32)).toEqual({ x: 0, y: 0, w: 128, h: 128 })
  })
  it('tamanho zero não desenha', () => {
    expect(fitInSquare(0, 10)).toBeNull()
  })
})
