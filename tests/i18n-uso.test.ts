import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '@babel/parser'
import { paramsOf } from '../src/shared/i18n'
import { CATALOGS } from '../src/shared/i18n/runtime'

const ROOTS = ['src/renderer/src', 'src/shared']
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') && !/[\\/]catalogs[\\/]/.test(join(d, e.name)) ? [join(d, e.name)] : []))
interface Use { file: string; line: number; key: string; params: string[] | null }
function usesIn(file: string): Use[] {
  const src = readFileSync(file, 'utf8'), ast = parse(src, { sourceType: 'module', plugins: file.endsWith('.tsx') ? ['jsx', 'typescript'] : ['typescript'], errorRecovery: true })
  const out: Use[] = []
  const visit = (n: any): void => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && (n.callee.name === 't' || n.callee.name === 'tr') && n.arguments[0]?.type === 'StringLiteral' && n.callee.name === 't') {
      const o = n.arguments[1]
      out.push({ file, line: src.slice(0, n.start).split('\n').length, key: n.arguments[0].value, params: !o ? [] : o.type === 'ObjectExpression' ? o.properties.map((p: any) => (p.key?.name ?? p.key?.value ?? '?')) : null })
    }
    for (const k of Object.keys(n)) { if (['loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(k)) continue; const c = n[k]; if (Array.isArray(c)) c.forEach(visit); else if (c && typeof c === 'object') visit(c) }
  }
  visit(ast.program)
  return out
}
const all = ROOTS.flatMap((r) => walk(r)).flatMap(usesIn)
const source = CATALOGS['pt-BR']
const forms = (key: string): string[] => ['', '_zero', '_one', '_two', '_few', '_many', '_other'].map((s) => source[`${key}${s}`]).filter((x): x is string => x !== undefined)

describe('uso do t() no código', () => {
  it('acha as chamadas (sanidade do teste)', () => { expect(all.length).toBeGreaterThan(800) })
  it('toda chave usada existe no catálogo-fonte', () => {
    const missing = all.filter((u) => forms(u.key).length === 0).map((u) => `${u.file}:${u.line} ${u.key}`)
    expect(missing).toEqual([])
  })
  it('os parâmetros passados são os do texto ({nome}); `count` escolhe o plural', () => {
    const bad: string[] = []
    for (const u of all) {
      if (u.params === null) continue
      const want = [...new Set(forms(u.key).flatMap(paramsOf))].sort(), got = [...new Set(u.params.filter((p) => p !== 'count'))].sort()
      const text = want.filter((w) => w !== 'count')
      if (JSON.stringify(text) !== JSON.stringify(got)) bad.push(`${u.file}:${u.line} ${u.key} texto{${text}} passa{${got}}`)
    }
    expect(bad).toEqual([])
  })
  it('chave de plural só é chamada com count; chave sem plural não precisa', () => {
    const bad = all.filter((u) => u.params !== null && forms(u.key).length > 0 && source[`${u.key}_other`] !== undefined && !u.params.includes('count')).map((u) => `${u.file}:${u.line} ${u.key}`)
    expect(bad).toEqual([])
  })
})
