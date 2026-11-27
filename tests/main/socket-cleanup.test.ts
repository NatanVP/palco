import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertPrivateSocketDirectory, cleanStaleSocketDirs, createSocketDirectory, isPidAlive, markOwned, OWNER_MARKER } from '../../src/main/socket-cleanup'

let base: string
beforeEach(() => (base = mkdtempSync(join(tmpdir(), 'palco-run-'))))
afterEach(() => rmSync(base, { recursive: true, force: true }))

function deadPid(): number {
  return 999_999_999
}

/** Diretório como o app o cria: marcador com o pid + socket. */
function owned(pid: number, extra: Record<string, string> = {}): string {
  const dir = join(base, `palco-${pid}`)
  mkdirSync(dir, { mode: 0o700 })
  markOwned(dir, pid)
  writeFileSync(join(dir, 'palco.sock'), '')
  for (const [name, content] of Object.entries(extra)) writeFileSync(join(dir, name), content)
  return dir
}

describe('markOwned', () => {
  it('grava o pid no marcador, só para o dono (0600)', () => {
    const dir = join(base, 'palco-77')
    mkdirSync(dir, { mode: 0o700 })
    markOwned(dir, 77)
    expect(readFileSync(join(dir, OWNER_MARKER), 'utf8').trim()).toBe('77')
    expect(lstatSync(join(dir, OWNER_MARKER)).mode & 0o777).toBe(0o600)
  })

  it('recusa marcador symlink sem alterar o alvo', () => {
    const dir = join(base, 'palco-77'), target = join(base, 'alvo')
    mkdirSync(dir, { mode: 0o700 })
    writeFileSync(target, 'preservar')
    symlinkSync(target, join(dir, OWNER_MARKER))
    expect(() => markOwned(dir, 77)).toThrow()
    expect(readFileSync(target, 'utf8')).toBe('preservar')
  })
})

describe('createSocketDirectory', () => {
  it('não usa diretório preexistente 0777 e cria um caminho privado alternativo', () => {
    const runtime = join(base, 'runtime')
    mkdirSync(runtime, { mode: 0o700 })
    const candidate = join(runtime, `palco-${process.pid + 70000}`)
    mkdirSync(candidate, { mode: 0o700 })
    chmodSync(candidate, 0o777)
    const created = createSocketDirectory(runtime, process.pid + 70000, process.getuid?.(), base)
    expect(created).not.toBe(candidate)
    expect(lstatSync(candidate).mode & 0o777).toBe(0o777)
    expect(lstatSync(created).isDirectory()).toBe(true)
    expect(lstatSync(created).mode & 0o077).toBe(0)
  })

  it('não usa um diretório symlink e preserva o destino', () => {
    const runtime = join(base, 'runtime'), target = join(base, 'alvo')
    mkdirSync(runtime, { mode: 0o700 }); mkdirSync(target); writeFileSync(join(target, 'importante'), 'x')
    symlinkSync(target, join(runtime, `palco-${process.pid + 70001}`))
    const created = createSocketDirectory(runtime, process.pid + 70001, process.getuid?.(), base)
    expect(created).not.toBe(join(runtime, `palco-${process.pid + 70001}`))
    expect(readFileSync(join(target, 'importante'), 'utf8')).toBe('x')
  })

  it('recusa diretório de outro uid conforme lstat', () => {
    const dir = join(base, 'real')
    mkdirSync(dir, { mode: 0o700 })
    const actual = lstatSync(dir)
    const foreign = { ...actual, uid: (process.getuid?.() ?? 1000) + 1, isSymbolicLink: () => false, isDirectory: () => true }
    expect(() => assertPrivateSocketDirectory(dir, process.getuid?.(), () => foreign)).toThrow(/uid/)
  })
})

describe('cleanStaleSocketDirs', () => {
  it('apaga só diretórios marcados pelo app, de pid morto, com conteúdo conhecido', () => {
    const stale = owned(deadPid())
    const current = owned(process.pid)
    const alive = owned(process.ppid)
    expect(cleanStaleSocketDirs(base, process.pid)).toEqual([stale])
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(current)).toBe(true)
    expect(existsSync(alive)).toBe(true)
  })

  it('diretório SEM marcador fica, mesmo com pid morto', () => {
    const dir = join(base, `palco-${deadPid()}`)
    mkdirSync(dir)
    writeFileSync(join(dir, 'palco.sock'), '')
    expect(cleanStaleSocketDirs(base, process.pid)).toEqual([])
    expect(existsSync(dir)).toBe(true)
  })

  it('marcador com pid diferente do nome (ou ilegível) não autoriza', () => {
    const pid = deadPid()
    const dir = join(base, `palco-${pid}`)
    mkdirSync(dir)
    writeFileSync(join(dir, OWNER_MARKER), String(pid + 1))
    const other = join(base, `palco-${pid + 2}`)
    mkdirSync(other)
    writeFileSync(join(other, OWNER_MARKER), 'lixo')
    expect(cleanStaleSocketDirs(base, process.pid)).toEqual([])
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })

  it('conteúdo inesperado preserva o diretório inteiro (nada é apagado)', () => {
    const dir = owned(deadPid(), { 'meu-arquivo.txt': 'importante' })
    expect(cleanStaleSocketDirs(base, process.pid)).toEqual([])
    expect(existsSync(join(dir, 'meu-arquivo.txt'))).toBe(true)
    expect(existsSync(join(dir, 'palco.sock'))).toBe(true)
    expect(existsSync(join(dir, OWNER_MARKER))).toBe(true)
  })

  it('subdiretório inesperado também preserva', () => {
    const dir = owned(deadPid())
    mkdirSync(join(dir, 'sub'))
    expect(cleanStaleSocketDirs(base, process.pid)).toEqual([])
    expect(existsSync(dir)).toBe(true)
  })

  it('diretório de outro usuário (uid diferente) não é tocado', () => {
    const dir = owned(deadPid())
    expect(cleanStaleSocketDirs(base, process.pid, () => false, (process.getuid?.() ?? 0) + 1)).toEqual([])
    expect(existsSync(dir)).toBe(true)
  })

  it('symlink no lugar do diretório, ou marcador symlink, não é seguido', () => {
    const target = join(base, 'alvo')
    mkdirSync(target)
    writeFileSync(join(target, 'importante'), 'x')
    writeFileSync(join(target, OWNER_MARKER), '1')
    const pid = deadPid()
    symlinkSync(target, join(base, `palco-${pid}`))
    const linked = join(base, `palco-${pid + 1}`)
    mkdirSync(linked)
    writeFileSync(join(base, 'real-marker'), String(pid + 1))
    symlinkSync(join(base, 'real-marker'), join(linked, OWNER_MARKER))
    expect(cleanStaleSocketDirs(base, process.pid)).toEqual([])
    expect(existsSync(join(target, 'importante'))).toBe(true)
    expect(existsSync(linked)).toBe(true)
  })

  it('nunca apaga o pid atual, arquivos nem nomes fora do padrão; diretório inexistente é ok', () => {
    const current = owned(process.pid)
    expect(cleanStaleSocketDirs(base, process.pid, () => false)).toEqual([])
    expect(existsSync(current)).toBe(true)
    mkdirSync(join(base, 'palco-abc'))
    writeFileSync(join(base, 'palco-99999999'), 'x')
    expect(cleanStaleSocketDirs(base, process.pid)).toEqual([])
    expect(cleanStaleSocketDirs(join(base, 'nao-existe'), process.pid)).toEqual([])
  })

  it('isPidAlive: ESRCH = morto; EPERM e sem erro = vivo', () => {
    const killer = (code?: string) => () => {
      if (code) throw Object.assign(new Error(code), { code })
      return true
    }
    expect(isPidAlive(1, killer('ESRCH'))).toBe(false)
    expect(isPidAlive(1, killer('EPERM'))).toBe(true)
    expect(isPidAlive(1, killer())).toBe(true)
    expect(isPidAlive(deadPid())).toBe(false)
    expect(isPidAlive(process.pid)).toBe(true)
  })
})
