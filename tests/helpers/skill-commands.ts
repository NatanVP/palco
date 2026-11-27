import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Tokenizes documentation, never executes a shell or expands env/command substitutions. */
export function words(source: string): string[] {
  const out: string[] = []; let word = '', quote = '', started = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    if (!quote && c === '#' && !started) break
    if (c === '\\' && source[i + 1] === '"') { word += '"'; i++; started = true; continue }
    if (quote) { if (c === quote) quote = ''; else word += c; started = true; continue }
    if (c === '"' || c === "'") { quote = c; started = true; continue }
    if (c === '[' || c === ']') continue // optional syntax; quoted JSON is untouched
    if (/\s/.test(c)) { if (started) out.push(word); word = ''; started = false; continue }
    word += c; started = true
  }
  if (quote) throw new Error(`unclosed quote: ${source}`)
  if (started) out.push(word)
  return out
}

export interface SkillCommand { file: string; source: string; args: string[] }
export const SKILLS_ROOT = join(process.cwd(), 'resources/skills')

/** Todo comando `palco …` citado nas skills (em linha ou em bloco), com os exemplos genéricos trocados por valores válidos. */
export function skillCommands(root = SKILLS_ROOT): SkillCommand[] {
  const cases: SkillCommand[] = []
  for (const dir of readdirSync(root).sort()) {
    const text = readFileSync(join(root, dir, 'SKILL.md'), 'utf8')
    let fence = false
    for (const line of text.split('\n')) {
      if (line.startsWith('```')) { fence = !fence; continue }
      // Blocos cercados e blocos indentados (a skill do chat usa os dois); o heredoc é o stdin, não um argumento.
      const block = fence || /^ {4}palco /.test(line)
      const sources = block ? (line.trim().startsWith('palco ') ? [line.trim().replace(/ <<'EOF'.*$/, '')] : []) : [...line.matchAll(/`(palco [^`\n]+)`/g)].map((m) => m[1]!)
      for (const source of sources) {
        let args = words(source.replace(/\\"/g, '"').replace(/<[^>]+>/g, 'Nome')).slice(1)
        // Prose references, not executable examples: test the real family help rather than invent missing operands.
        const references = ['ask', 'connect', 'portal', 'recruit', 'dismiss', 'band', 'partitura', 'routine', 'floor land', 'floor delete', 'floor status', 'role edit', 'role create', 'note read', 'note write', 'note edit', 'recruit --replace']
        if (references.includes(args.join(' ')) || args.includes('...') || args.some((a) => a.includes('/click')) || args.includes('/') || args.includes('|')) args = [args[0]!, '--help']
        args = args.map((a) => a === 'URL' || a === 'url' ? 'https://example.com' : a === 'LxA' ? '390x844' : a === 'C' ? '#88aaff' : a === 'I' ? 'terminal' : a === 'current|global' ? 'current' : a === 'working|blocked|review|done' ? 'working' : a === 'day|week|month' ? 'week' : a === 'NÚMERO|URL' ? '42' : a)
        // Resumo do floor status lista texto e --clear juntos, que são exclusivos: testa o resumo sem o --clear.
        if (args[0] === 'floor' && args[1] === 'status' && args.includes('--clear') && args.length > 3) args = args.filter((a) => a !== '--clear')
        cases.push({ file: dir, source, args })
      }
    }
  }
  return cases
}
