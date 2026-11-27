import type { AgentKind } from './model'

/** Primeira linha não vazia do comando, sem espaços nas pontas. */
export function firstLine(command: string): string {
  return command.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
}

/** Uma palavra da linha: o valor (sem aspas, como o shell veria) e onde ela está no texto original. */
export interface CommandToken { value: string; start: number; end: number }

/**
 * Separa a linha em palavras como o shell faria com aspas simples, duplas e barra — sem expandir variáveis,
 * `~` nem substituições — guardando a posição de cada uma. Aspas sem fechamento lançam erro.
 */
export function splitCommandTokens(line: string): CommandToken[] {
  const out: CommandToken[] = []
  let word = '', quote = '', started = false, start = 0
  const begin = (i: number): void => { if (!started) { started = true; start = i } }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote === "'") { if (c === "'") quote = ''; else word += c; continue }
    if (quote === '"') {
      if (c === '"') quote = ''
      else if (c === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1]!)) word += line[++i]!
      else word += c
      continue
    }
    if (c === "'" || c === '"') { begin(i); quote = c; continue }
    if (c === '\\' && i + 1 < line.length) { begin(i); word += line[++i]!; continue }
    if (/\s/.test(c)) { if (started) out.push({ value: word, start, end: i }); word = ''; started = false; continue }
    begin(i)
    word += c
  }
  if (quote) throw new Error('aspas sem fechamento no command')
  if (started) out.push({ value: word, start, end: line.length })
  return out
}

/** Só os valores das palavras (ver `splitCommandTokens`). */
export function splitCommand(line: string): string[] {
  return splitCommandTokens(line).map((t) => t.value)
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh'])
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const base = (p: string): string => p.split('/').pop() ?? p

/**
 * Onde está o programa do agente na linha: depois das variáveis na frente; num wrapper de shell
 * (`fish -c "claude ..."`), `script` é o texto de dentro e `prefix` são as palavras até o `-c`.
 */
export function commandShape(line: string): { program: string; wrapper?: { prefix: string[]; script: string; rest: string[]; scriptStart: number; scriptEnd: number } } {
  const tokens = splitCommandTokens(line)
  const words = tokens.map((t) => t.value)
  let i = 0
  while (i < words.length && ENV_ASSIGN.test(words[i]!)) i++
  const program = words[i] ?? ''
  if (SHELLS.has(base(program))) {
    // `bash -c`, `bash -lc`, `fish -c`: a primeira opção com c curto seguida do script.
    for (let j = i + 1; j < words.length - 1; j++) {
      const w = words[j]!
      if (/^-[a-z]*c[a-z]*$/.test(w)) {
        const script = words[j + 1]!
        return {
          program: commandShape(script).program,
          wrapper: { prefix: words.slice(0, j + 1), script, rest: words.slice(j + 2), scriptStart: tokens[j + 1]!.start, scriptEnd: tokens[j + 1]!.end }
        }
      }
      if (!w.startsWith('-')) break
    }
  }
  return { program }
}

/** O agente sai do programa que a linha inicia: claude e codex têm integração; vazio é shell; o resto é um agente genérico. */
export function agentForCommand(command: string): AgentKind {
  const line = firstLine(command)
  if (line === '') return 'shell'
  let program: string
  try { program = commandShape(line).program } catch { program = line.split(/\s+/)[0] ?? '' }
  const bin = base(program)
  return bin === 'claude' ? 'claude' : bin === 'codex' ? 'codex' : bin === 'agy' ? 'antigravity' : 'other'
}

/** Aspas simples de shell quando a palavra precisa (funciona em sh, bash, zsh e fish). */
export function shQuote(text: string): string {
  if (text !== '' && /^[\p{L}\p{N}_./:+@%=,-]+$/u.test(text)) return text
  return `'${text.replace(/'/g, `'"'"'`)}'`
}

/**
 * Operador de controle fora de aspas (`;`, `|`, `&`, `<`, `>`, crase, `$(`) ou comentário (`#` no começo de uma
 * palavra): a linha deixaria de iniciar um programa só, ou o que o palco acrescenta (hooks, role) seria comentado.
 */
export function topLevelOperator(line: string): string | null {
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote === "'") { if (c === "'") quote = ''; continue }
    if (c === '\\') { i++; continue }
    if (quote === '"') { if (c === '"') quote = ''; else if (c === '`' || (c === '$' && line[i + 1] === '(')) return c === '`' ? '`' : '$('; continue }
    if (c === "'" || c === '"') { quote = c; continue }
    if (';|&<>`'.includes(c)) return c
    if (c === '$' && line[i + 1] === '(') return '$('
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return '#'
  }
  return null
}

/**
 * Regra única da linha de comando (main e UI): uma linha que inicia um programa só, sem operadores nem comentários,
 * e o script de dentro de um wrapper `-c` sob a mesma regra — o que o palco acrescenta vai sempre para o agente.
 * Devolve o motivo da recusa, ou `null`.
 */
export function commandLineError(line: string, depth = 0): string | null {
  if (line.startsWith('-')) return 'o comando não pode começar com -'
  let shape: ReturnType<typeof commandShape>
  try { shape = commandShape(line) } catch { return 'aspas sem fechamento no comando' }
  const op = topLevelOperator(line)
  if (op === '#') return depth ? "comentário (#) no script do wrapper: os hooks do palco seriam comentados" : "comentário (#) fora de aspas: os hooks do palco seriam comentados"
  if (op !== null) return depth ? `'${op}' no script do wrapper: o script inicia um programa só` : `'${op}' fora de aspas: o comando inicia um programa só`
  if (shape.program === '') return 'comando sem programa (só variáveis)'
  if (shape.wrapper && depth < 3) return commandLineError(shape.wrapper.script.trim(), depth + 1)
  return null
}
