/** Citação POSIX com aspas simples: `'` vira `'\''`. Nada dentro das aspas é interpretado pelo shell. */
export const sq = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`
/** Caminho no host remoto: `~` e `~/x` viram `"$HOME"` e `"$HOME"/'x'` (o `~` entre aspas não expandiria). */
export const remotePath = (p: string): string => (p === '~' ? '"$HOME"' : p.startsWith('~/') ? `"$HOME"/${sq(p.slice(2))}` : sq(p))
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
/** `export CHAVE='valor'` por linha; nome de variável fora do padrão derruba tudo (nunca vira comando). */
export function exportLines(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => { if (!KEY.test(k)) throw new Error(`nome de variável inválido: ${k}`); if (v.includes('\0')) throw new Error(`valor inválido em ${k}`); return `export ${k}=${sq(v)}` }).join('\n')
}
