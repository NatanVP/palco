import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '@babel/parser'

/**
 * Falha se aparecer texto visível ao usuário fora do catálogo nos componentes do renderer: texto de JSX, atributos de acessibilidade/título,
 * propriedades de texto (label, title, hint…) e mensagens passadas a notify/setError/alert/confirm. Texto novo entra em
 * `src/shared/i18n/catalogs/pt-BR.ts` e sai por `t('chave')`.
 */
const ROOT = 'src/renderer/src'
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [join(d, e.name)] : []))
const KEYS = new Set(['label', 'title', 'hint', 'description', 'message', 'placeholder', 'reason', 'pending', 'detail', 'text', 'error', 'body', 'summary', 'tooltip', 'caption', 'confirm', 'cancel', 'heading', 'subtitle', 'confirmLabel', 'ariaLabel'])
const CALLS = new Set(['notify', 'setError', 'alert', 'confirm', 'setMessage', 'setStatus', 'setNotice', 'toast', 'setWarning', 'setHint', 'setInfo', 'setFeedback', 'fail', 'onError'])
const ATTRS = new Set(['aria-label', 'title', 'placeholder', 'label', 'hint', 'alt', 'aria-description', 'confirmLabel', 'ariaLabel', 'submit', 'body'])
const LETTERS = /\p{L}{3,}/u
/** Texto que não se traduz: nome próprio, tecla, unidade, formato. */
const ALLOW = new Set(['palco', 'Git', 'Wire', 'WSL', 'SSH', 'Docker', 'tmux', 'Ctrl', 'Alt', 'Shift', 'Meta', 'Ground', 'Markdown', 'Enter', 'Esc'])
const isVisible = (s: string): boolean => LETTERS.test(s.replace(/\{\}/g, '')) && !ALLOW.has(s.trim()) && (/\s/.test(s.trim()) || /^[A-ZÀ-Ú]/.test(s.trim()))
const str = (n: any): string | null => (n?.type === 'StringLiteral' ? n.value : n?.type === 'TemplateLiteral' ? n.quasis.map((q: any) => q.value.cooked).join('{}') : null)

function leaks(file: string): string[] {
  const src = readFileSync(file, 'utf8'), ast = parse(src, { sourceType: 'module', plugins: file.endsWith('.tsx') ? ['jsx', 'typescript'] : ['typescript'], errorRecovery: true })
  const out: string[] = [], at = (n: any): string => `${relative('.', file)}:${src.slice(0, n.start).split('\n').length}`
  const visit = (n: any): void => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'JSXText' && n.value.trim() && LETTERS.test(n.value) && !ALLOW.has(n.value.trim())) out.push(`${at(n)} JSX: ${n.value.trim().slice(0, 50)}`)
    if (n.type === 'JSXAttribute' && n.name.type === 'JSXIdentifier' && ATTRS.has(n.name.name) && n.value?.type === 'StringLiteral' && isVisible(n.value.value)) out.push(`${at(n)} ${n.name.name}: ${n.value.value.slice(0, 50)}`)
    if (n.type === 'ObjectProperty' && !n.computed && ((n.key.type === 'Identifier' && KEYS.has(n.key.name)) || (n.key.type === 'StringLiteral' && KEYS.has(n.key.value))) && str(n.value) !== null && isVisible(str(n.value)!)) out.push(`${at(n)} ${n.key.name ?? n.key.value}: ${str(n.value)!.slice(0, 50)}`)
    if (n.type === 'CallExpression') {
      const callee = n.callee.type === 'Identifier' ? n.callee.name : n.callee.type === 'MemberExpression' && n.callee.property.type === 'Identifier' ? n.callee.property.name : ''
      if (CALLS.has(callee)) for (const a of n.arguments) if (str(a) !== null && isVisible(str(a)!)) out.push(`${at(n)} ${callee}(): ${str(a)!.slice(0, 50)}`)
    }
    for (const k of Object.keys(n)) { if (['loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(k)) continue; const c = n[k]; if (Array.isArray(c)) c.forEach(visit); else if (c && typeof c === 'object') visit(c) }
  }
  visit(ast.program)
  return out
}

describe('texto visível fora do catálogo', () => {
  it('nenhum componente do renderer deixa texto para o usuário fora de t()', () => {
    const found = walk(ROOT).flatMap(leaks)
    expect(found).toEqual([])
  })
})
