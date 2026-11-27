import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import type { AgentKind } from '../../shared/model'
import { agentForCommand, commandShape, firstLine } from '../../shared/agent-command'
import { mt } from '../i18n'

const execFile = promisify(execFileCallback)
const MAX_LOOKUP_MS = 2_000
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/
const SHELL_AGENT: Record<string, AgentKind> = { claude: 'claude', codex: 'codex', agy: 'antigravity' }
const cache = new Map<string, AgentResolution>()

export interface AgentResolution {
  agent: AgentKind
  wrapper: boolean
  forwardsArgs: boolean
  warning?: string
}

interface ResolveOptions { shell?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
interface Token { kind: 'word' | 'separator'; value: string; expansions: Set<string> }

function bin(value: string): string { return value.split('/').pop() ?? value }

function shellQuery(shell: string, name: string): { args: string[]; marker: string } | undefined {
  const kind = bin(shell)
  if (kind === 'fish') return {
    args: ['-ic', ['functions', '-q', name, ';', 'and', 'begin', ';', 'echo', '__PALCO_WRAPPER_FUNCTION__', ';', 'functions', name, ';', 'end'].join(' ')],
    marker: '__PALCO_WRAPPER_FUNCTION__'
  }
  if (kind === 'bash') return {
    args: ['-ic', `kind=$(type -t ${name} 2>/dev/null) || exit 1; printf '__PALCO_WRAPPER_KIND__%s\\n' "$kind"; case "$kind" in function) declare -f ${name};; alias) alias ${name};; *) exit 1;; esac`],
    marker: '__PALCO_WRAPPER_KIND__'
  }
  if (kind === 'zsh') return {
    args: ['-ic', ['if', '((', '$+functions[' + name + ']', '));', 'then', 'print', '__PALCO_WRAPPER_KIND__function;', 'functions', name + ';', 'elif', '((', '$+aliases[' + name + ']', '));', 'then', 'print', '__PALCO_WRAPPER_KIND__alias;', 'alias', name + ';', 'else;', 'exit', '1;', 'fi'].join(' ')],
    marker: '__PALCO_WRAPPER_KIND__'
  }
  return undefined
}

async function readDefinition(name: string, shell: string, options: ResolveOptions): Promise<{ body: string; alias: boolean } | undefined> {
  const query = shellQuery(shell, name)
  if (!query) return undefined
  try {
    const result = await execFile(shell, query.args, {
      encoding: 'utf8', timeout: options.timeoutMs ?? MAX_LOOKUP_MS, maxBuffer: 64 * 1024,
      env: options.env ?? process.env, windowsHide: true
    })
    const output = String(result.stdout)
    const markerIndex = output.indexOf(query.marker)
    if (markerIndex < 0) return undefined
    const newline = output.indexOf('\n', markerIndex)
    if (newline < 0) return undefined
    const markerTail = output.slice(markerIndex + query.marker.length, newline).trim()
    let body = output.slice(newline + 1).trim()
    let alias = markerTail.endsWith('alias')
    if (bin(shell) === 'fish') alias = false
    if (alias) {
      const equals = body.indexOf('=')
      if (equals < 0) return undefined
      body = body.slice(equals + 1).trim()
      if ((body.startsWith("'") && body.endsWith("'")) || (body.startsWith('"') && body.endsWith('"'))) body = body.slice(1, -1)
    }
    return { body, alias }
  } catch { return undefined }
}

function variableAt(source: string, start: number): { name: string; end: number } | undefined {
  if (source[start] !== '$') return undefined
  let i = start + 1
  if (source[i] === '{') {
    const end = source.indexOf('}', i + 1)
    if (end < 0) return undefined
    return { name: source.slice(i + 1, end).replace(/^[@*].*$/, '@'), end: end + 1 }
  }
  if (source[i] === '@' || source[i] === '*') return { name: '@', end: i + 1 }
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))
  return match ? { name: match[0], end: i + match[0].length } : undefined
}

function lex(source: string): Token[] {
  const tokens: Token[] = []
  let value = '', quote: "'" | '"' | '' = '', expansions = new Set<string>()
  const flush = (): void => { if (value !== '') tokens.push({ kind: 'word', value, expansions }); value = ''; expansions = new Set() }
  const separator = (): void => { flush(); if (tokens.at(-1)?.kind !== 'separator') tokens.push({ kind: 'separator', value: '', expansions: new Set() }) }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!
    if (quote === "'") { if (ch === "'") quote = ''; else value += ch; continue }
    if (quote === '"') {
      if (ch === '"') { quote = ''; continue }
      if (ch === '\\' && i + 1 < source.length && '"\\$`'.includes(source[i + 1]!)) { value += source[++i]!; continue }
      if (ch === '$') { const variable = variableAt(source, i); if (variable) { expansions.add(variable.name); value += source.slice(i, variable.end); i = variable.end - 1; continue } }
      value += ch; continue
    }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '\\' && i + 1 < source.length) { value += source[++i]!; continue }
    if (ch === '#' && value === '') { while (i < source.length && source[i] !== '\n') i++; separator(); continue }
    if (ch === '$') { const variable = variableAt(source, i); if (variable) { expansions.add(variable.name); value += source.slice(i, variable.end); i = variable.end - 1; continue } }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      if ((ch === '|' || ch === '&') && source[i + 1] === ch) i++
      separator(); continue
    }
    if (/\s/.test(ch)) { flush(); continue }
    value += ch
  }
  flush()
  return tokens
}

function targetInvocation(body: string, shell: string): { agent: AgentKind; forwardsArgs: boolean } | undefined {
  const tokens = lex(body)
  let commandExpected = true
  const controls = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', 'time', 'function', 'end', 'fi', 'done'])
  const prefixes = new Set(['command', 'exec', 'builtin', 'env', 'nohup'])
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.kind === 'separator') { commandExpected = true; continue }
    if (!commandExpected) continue
    if (controls.has(token.value)) {
      if (token.value === 'function') commandExpected = false
      continue
    }
    if (prefixes.has(token.value) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.value)) continue
    const detected = SHELL_AGENT[bin(token.value)]
    if (detected) {
      const wanted = shell === 'fish' ? 'argv' : '@'
      for (let j = i + 1; j < tokens.length && tokens[j]!.kind !== 'separator'; j++) {
        if (tokens[j]!.expansions.has(wanted)) return { agent: detected, forwardsArgs: true }
      }
      return { agent: detected, forwardsArgs: false }
    }
    commandExpected = false
  }
  return undefined
}

/** Resolve apenas aliases e funções do shell; não executa o comando consultado. */
export async function resolveAgentForCommand(command: string, options: ResolveOptions = {}): Promise<AgentResolution> {
  const baseAgent = agentForCommand(command)
  if (baseAgent !== 'other') return { agent: baseAgent, wrapper: false, forwardsArgs: true }
  let name = ''
  try { name = bin(commandShape(firstLine(command)).program) } catch { return { agent: 'other', wrapper: false, forwardsArgs: false } }
  if (!IDENTIFIER.test(name)) return { agent: 'other', wrapper: false, forwardsArgs: false }
  const shell = options.shell ?? process.env.SHELL ?? '/bin/bash'
  const key = `${bin(shell)}\0${name}`
  const cached = cache.get(key)
  if (cached) return cached
  const definition = await readDefinition(name, shell, options)
  if (!definition) {
    const result = { agent: 'other' as const, wrapper: false, forwardsArgs: false }
    cache.set(key, result)
    return result
  }
  const invocation = targetInvocation(definition.body, bin(shell))
  if (!invocation) {
    const result = { agent: 'other' as const, wrapper: true, forwardsArgs: false }
    cache.set(key, result)
    return result
  }
  const result: AgentResolution = invocation.forwardsArgs
    ? { ...invocation, wrapper: true }
    : { agent: 'other', wrapper: true, forwardsArgs: false, warning: mt('O wrapper {p1} chama {p2}, mas não encaminha argumentos; o palco não pode aplicar a integração nem detectar prontidão.', { p1: name, p2: invocation.agent }) }
  cache.set(key, result)
  return result
}

export function clearAgentResolutionCache(): void { cache.clear() }
