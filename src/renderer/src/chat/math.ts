/**
 * O agente escreve TeX com `$…$`/`$$…$$` ou com `\(…\)`/`\[…\]`. O remark-math só entende os cifrões: aqui os outros delimitadores
 * viram cifrões, fora de blocos de código e de código em linha. `\$` continua sendo um cifrão literal.
 */
export function normalizeMath(markdown: string): string {
  const parts = markdown.split(/(`{3}[\s\S]*?`{3}|~{3}[\s\S]*?~{3}|`[^`\n]*`)/g)
  return parts.map((part, i) => (i % 2 === 1 ? part : part
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => `$${tex.trim()}$`))).join('')
}

/** Só links web abrem fora do app; qualquer outro esquema (file:, javascript:, data:) vira texto. */
export function safeHref(href: string | undefined): string | null {
  if (!href) return null
  try { const u = new URL(href); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null } catch { return null }
}
