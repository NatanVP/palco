import { commandLineError, commandShape, firstLine, shQuote, splitCommandTokens } from './agent-command'
import { AGENT_OPTIONS, EXCLUDED_AGENT_OPTIONS, MANAGED_AGENT_FLAGS, type AgentOption } from './agent-options'

interface Match { start: number; end: number; values: string[] }
const names = (o: Pick<AgentOption, 'flag' | 'aliases'>): readonly string[] => [o.flag, ...o.aliases]
const excludedValues = new Set(['--settings', '--append-system-prompt-file', '--config', '--cloud', '--environment', '--file', '--teleport', '--input-format', '--output-format', '--json-schema', '--max-budget-usd', '--permission-prompts'])

function matches(line: string, wanted: AgentOption): Match[] {
  const tokens = splitCommandTokens(line), found: Match[] = []
  let program = 0
  while (tokens[program] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[program]!.value)) program++
  const options = AGENT_OPTIONS.filter(o => o.agent === wanted.agent)
  const excluded = EXCLUDED_AGENT_OPTIONS.filter(o => o.agent === wanted.agent)
  for (let i = program + 1; i < tokens.length; i++) {
    const token = tokens[i]!, word = token.value
    if (word === '--') break
    const equal = word.indexOf('='), flag = equal > 0 ? word.slice(0, equal) : word
    let option = options.find(o => names(o).includes(flag))
    let attached = equal > 0 ? word.slice(equal + 1) : undefined
    if (!option && /^-[^-]/.test(word) && word.length > 2) {
      option = options.find(o => o.kind !== 'boolean' && o.aliases.includes(word.slice(0, 2)))
      if (option) attached = word.slice(2).replace(/^=/, '')
    }
    const values: string[] = []
    if (option?.kind !== 'boolean' && option) {
      if (attached !== undefined) values.push(attached)
      if (attached === undefined || (option.kind === 'list' && !option.repeat)) {
        while (tokens[i + 1] && (!tokens[i + 1]!.value.startsWith('-') || /^['"]/.test(line.slice(tokens[i + 1]!.start)))) {
          values.push(tokens[++i]!.value)
          if (option.kind !== 'list' || option.repeat) break
        }
      }
    } else if (!option && attached === undefined) {
      const other = excluded.find(o => names(o).includes(flag))
      if ((other && excludedValues.has(other.flag)) || (MANAGED_AGENT_FLAGS as readonly string[]).includes(flag)) i += tokens[i + 1] ? 1 : 0
    }
    if (option?.flag === wanted.flag) {
      let start = token.start
      while (start > 0 && /\s/.test(line[start - 1]!)) start--
      found.push({ start, end: tokens[i]!.end, values })
    }
  }
  return found
}

/** Lê só as opções do agente; wrappers de shell mantêm os argumentos externos intactos. */
export function readAgentOption(command: string, option: AgentOption, depth = 0): string[] | null {
  if (depth > 8) throw new Error('wrapper muito profundo')
  const line = firstLine(command), shape = commandShape(line)
  if (shape.wrapper) return readAgentOption(shape.wrapper.script, option, depth + 1)
  const found = matches(line, option)
  return found.length ? option.kind === 'list' ? found.flatMap(m => m.values) : found.at(-1)!.values : null
}

/** Troca somente os trechos da opção escolhida; todo valor novo passa por shQuote. null desliga. */
export function writeAgentOption(command: string, rawOption: AgentOption, values: string[] | null, depth = 0): string {
  const option = AGENT_OPTIONS.find(o => o.agent === rawOption.agent && o.flag === rawOption.flag)
  if (!option || depth > 8) throw new Error('opção indisponível')
  const line = firstLine(command), error = commandLineError(line)
  if (!line || error) throw new Error(error ?? 'comando vazio')
  const shape = commandShape(line), wrapper = shape.wrapper
  let next: string
  if (wrapper) {
    const script = writeAgentOption(wrapper.script, option, values, depth + 1)
    next = line.slice(0, wrapper.scriptStart) + shQuote(script) + line.slice(wrapper.scriptEnd)
  } else {
    const remove = [option, ...(values === null ? [] : AGENT_OPTIONS.filter(o => o.agent === option.agent && option.exclusive?.includes(o.flag)))]
    next = line
    const spans = remove.flatMap(o => matches(line, o)).sort((a, b) => b.start - a.start)
    for (const span of spans) next = next.slice(0, span.start) + next.slice(span.end)
    next = next.trimEnd()
    if (values !== null) {
      const args = option.kind === 'boolean' ? [] : values.length ? values : option.optionalValue ? [] : ['']
      // Igual prende valores iniciados por hífen à opção, em vez de deixá-los virar outras flags.
      const argument = (value: string): string => `${option.flag}${value.startsWith('-') ? '=' : ' '}${shQuote(value)}`
      const added = option.repeat && args.length ? args.map(argument).join(' ')
        : args.length ? [argument(args[0]!), ...args.slice(1).map(v => v.startsWith('-') ? argument(v) : shQuote(v))].join(' ') : option.flag
      const delimiter = splitCommandTokens(next).find(t => t.value === '--')
      next = delimiter ? `${next.slice(0, delimiter.start).trimEnd()} ${added} ${next.slice(delimiter.start)}` : `${next} ${added}`
    }
  }
  const start = command.indexOf(line)
  return command.slice(0, start) + next + command.slice(start + line.length)
}
