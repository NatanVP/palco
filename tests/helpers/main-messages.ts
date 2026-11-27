import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@babel/parser'

/**
 * Os textos em pt-BR que o main pode mostrar na janela. Ficam de fora os arquivos que só falam com o CLI palco e com os agentes
 * (rotas HTTP, ações de página do portal, instalação de skills, disparo de rotina), que continuam em pt-BR.
 */
const CLI_ONLY = /src\/main\/(server\/|.*routes\.ts$|portal\/page-|skills-install|routines\/fire|i18n\.ts)/
const SHARED = ['preferences', 'shortcuts', 'appearance', 'environment', 'agent-command'].map((f) => `src/shared/${f}.ts`)
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []))
/** Frase = duas palavras seguidas. Sem filtro por vocabulário: o que não é para o usuário entra na lista de exceções do teste. */
const PHRASE = /\p{L}{3,} (\p{L}+ )*\p{L}{2,}/u
export interface Literal { file: string; line: number; /** O texto com cada `${…}` virando `{p1}`, `{p2}`… */ template: string }
export function mainMessages(): Literal[] {
  const out: Literal[] = []
  for (const file of [...walk('src/main').filter((f) => !CLI_ONLY.test(f)), ...SHARED]) {
    const src = readFileSync(file, 'utf8'), ast = parse(src, { sourceType: 'module', plugins: ['typescript'] })
    const visit = (n: any, parent: any): void => {
      if (!n || typeof n.type !== 'string') return
      if (n.type === 'StringLiteral' || n.type === 'TemplateLiteral') {
        const template: string = n.type === 'StringLiteral' ? n.value : n.quasis.map((q: any, i: number) => q.value.cooked + (i < n.expressions.length ? `{p${i + 1}}` : '')).join('')
        const callee = parent?.type === 'CallExpression' ? src.slice(parent.callee.start, parent.callee.end) : ''
        if (PHRASE.test(template) && !callee.startsWith('console.') && !template.startsWith('palco:') && !/^(import|export)/i.test(parent?.type ?? '')) out.push({ file, line: n.loc.start.line, template })
      }
      for (const k of Object.keys(n)) { if (['loc', 'leadingComments', 'trailingComments', 'innerComments'].includes(k)) continue; const c = n[k]; if (Array.isArray(c)) c.forEach((x) => visit(x, n)); else if (c && typeof c === 'object') visit(c, n) }
    }
    visit(ast.program, null)
  }
  return out
}
