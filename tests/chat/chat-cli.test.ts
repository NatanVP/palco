import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRecall, parseSay, sayBody } from '../../src/cli/chat'

describe('palco say', () => {
  it('texto direto, parcial e anexos', () => {
    expect(parseSay(['pronto'])).toEqual({ text: 'pronto', attach: [], progress: false, stdin: false })
    expect(parseSay(['--progress', 'rodando testes'])).toMatchObject({ text: 'rodando testes', progress: true })
    expect(parseSay(['--attach', '/a.png', '--attach', '/b.pdf', 'veja'])).toMatchObject({ text: 'veja', attach: ['/a.png', '/b.pdf'] })
  })
  it('sem texto, --file nem pergunta, lê o stdin (heredoc)', () => { expect(parseSay([])).toMatchObject({ stdin: true }); expect(parseSay(['--attach', '/a.png']).stdin).toBe(true); expect(parseSay(['--attach', '/a.png', 'texto']).stdin).toBe(false) })
  it('depois de -- tudo é texto', () => { expect(parseSay(['--', '--progress'])).toMatchObject({ text: '--progress', progress: false }) })
  it('pergunta com opções, detalhe e recomendada', () => {
    expect(parseSay(['--question', 'Qual?', '--option', 'A', '--detail', 'rápido', '--recommended', '--option', 'B']).question).toEqual({ prompt: 'Qual?', options: [{ label: 'A', detail: 'rápido', recommended: true }, { label: 'B' }] })
  })
  it('recusa pergunta com uma opção, opção solta, detalhe solto e opção desconhecida', () => {
    expect(() => parseSay(['--question', 'x', '--option', 'A'])).toThrow(/duas/)
    expect(() => parseSay(['--option', 'A'])).toThrow(); expect(() => parseSay(['--detail', 'd'])).toThrow(); expect(() => parseSay(['--zzz'])).toThrow(/desconhecida/)
    expect(() => parseSay(['--question', 'q', '--option', 'A', '--option', 'B', 'texto'])).toThrow()
  })
  it('corpo do POST: --file de texto vira texto; binário vira anexo; relativo é resolvido; stdin entra', () => {
    const d = mkdtempSync(join(tmpdir(), 'palco-say-'))
    try {
      writeFileSync(join(d, 'r.md'), '# oi'); writeFileSync(join(d, 'i.png'), Buffer.from([0x89, 0x50, 0, 1]))
      expect(sayBody(parseSay(['--file', 'r.md']), () => '', d)).toEqual({ text: '# oi' })
      expect(sayBody(parseSay(['--file', 'i.png']), () => '', d)).toEqual({ attach: [join(d, 'i.png')] })
      expect(sayBody(parseSay([]), () => 'do heredoc', d)).toEqual({ text: 'do heredoc' })
      expect(sayBody(parseSay(['--progress', 'x']), () => '', d)).toEqual({ text: 'x', progress: true })
      expect(sayBody(parseSay(['--attach', join(d, 'r.md')]), () => 'texto do heredoc', d)).toEqual({ text: 'texto do heredoc', attach: [join(d, 'r.md')] })
      expect(sayBody(parseSay(['--attach', join(d, 'r.md')]), () => '  ', d)).toEqual({ attach: [join(d, 'r.md')] })
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
describe('palco recall', () => {
  it('formas aceitas', () => {
    expect(parseRecall([])).toEqual({ kind: 'thread', all: false, json: false })
    expect(parseRecall(['blue', '--turns', '3'])).toEqual({ kind: 'thread', thread: 'blue', turns: 3, all: false, json: false })
    expect(parseRecall(['--all'])).toMatchObject({ all: true }); expect(parseRecall(['list'])).toEqual({ kind: 'list' }); expect(parseRecall(['attachment', 'ID1'])).toEqual({ kind: 'attachment', id: 'ID1' })
  })
  it('recusa turns fora de 1–500, all com turns e opção desconhecida', () => {
    expect(() => parseRecall(['--turns', '0'])).toThrow(); expect(() => parseRecall(['--turns', '501'])).toThrow(); expect(() => parseRecall(['--all', '--turns', '2'])).toThrow(); expect(() => parseRecall(['--x'])).toThrow()
  })
})
