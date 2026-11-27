import { parsePortal } from './portal-args'
import { parseBase, type BaseCommand } from './base-args'
import type { AgentKind, FloorState } from '../shared/model'

export type CliCommand = BaseCommand
  | { cmd: 'account-list' }
  | { cmd: 'account-add'; name: string; agent: 'claude' | 'codex' | 'antigravity'; dir: string }
  | { cmd: 'account-remove'; name: string }
  | { cmd: 'recruit'; name?: string; preset?: string; agent?: AgentKind; command?: string; dir?: string; floor?: string; band?: string; role?: string; workspace?: string; space?: string; account?: string; icon?: string; color?: string; replace?: string }
  | { cmd: 'dismiss'; name: string }
  | { cmd: 'band-create'; name: string; members: string[]; withoutMe?: boolean; floor?: string; workspace?: string; icon?: string; color?: string }
  | { cmd: 'band-add' | 'band-remove'; band: string; member: string }
  | { cmd: 'band-dissolve'; band: string }
  | { cmd: 'floor-create'; name: string; branch?: string; from?: string; existingBranch?: boolean; noGit?: boolean; copyGround?: boolean; partitura?: string; dir?: string; copy?: boolean; pullRequest?: string }
  | { cmd: 'floor-list'; json?: boolean }
  | { cmd: 'floor-unload'; name: string }
  | { cmd: 'floor-set-dir'; name: string; dir: string }
  | { cmd: 'workspace-unload'; name: string }
  | { cmd: 'workspace-delete'; name: string; force?: boolean }
  | { cmd: 'floor-land'; name: string; into?: string; deleteBranch?: boolean; keepFloor?: boolean }
  | { cmd: 'floor-delete'; name: string; force?: boolean; keepBranch?: boolean; keepFolder?: boolean }
  | { cmd: 'floor-status'; text?: string; floor?: string; state?: FloorState; progress?: string; clear?: boolean }
  | { cmd: 'portal'; name: string; action: string; args: string[] }
  | ({ cmd: 'routine-create'; name: string; command: string } & RoutineFields)
  | ({ cmd: 'routine-edit'; name: string; id?: string; newName?: string; command?: string } & RoutineFields)
  | { cmd: 'routine-list'; json?: boolean }
  | { cmd: 'routine-show' | 'routine-enable' | 'routine-disable' | 'routine-run' | 'routine-delete'; name: string; id?: string }
  | { cmd: 'workspace-list'; json?: boolean }
  | { cmd: 'workspace-create'; name: string; dir: string; from?: string; group?: string; space?: string }
  | { cmd: 'workspace-rename'; old: string; new: string }
  | { cmd: 'workspace-move'; name: string; group?: string; root?: boolean; space?: string }
  | { cmd: 'space-list' }
  | { cmd: 'space-create'; name: string; icon?: string; color?: string }
  | { cmd: 'space-edit'; name: string; newName?: string; icon?: string; color?: string }
  | { cmd: 'space-move'; name: string; to?: number; left?: boolean; right?: boolean }
  | { cmd: 'space-delete'; name: string }
  | { cmd: 'preset-list'; json?: boolean }
  | { cmd: 'role-list'; json?: boolean }
  | { cmd: 'preset-show' | 'preset-delete' | 'role-show'; name: string }
  | { cmd: 'role-delete'; name: string; force?: boolean }
  | { cmd: 'preset-create'; name: string; agent?: AgentKind; command?: string; role?: string; account?: string; maestro?: boolean; chat?: boolean; quickStart?: boolean }
  | { cmd: 'preset-set'; name: string; newName?: string; command?: string; account?: string; maestro?: boolean; chat?: boolean; quickStart?: boolean }
  | { cmd: 'role-create'; name: string; text: string; scope?: RoleScope }
  | { cmd: 'role-edit'; name: string; old?: string; new?: string; scope?: RoleScope }
  | { cmd: 'role-write'; name: string; text: string }
  | { cmd: 'role-assign'; name: string; role?: string; none?: boolean }
  | { cmd: 'partitura-list' }
  | { cmd: 'partitura-create'; name: string; agents: string[]; withoutMe?: boolean; description?: string; noteText: boolean; commands?: boolean }
  | { cmd: 'partitura-update'; name: string; agents: string[]; withoutMe?: boolean; newName?: string; description?: string; noteText?: boolean; commands?: boolean }
  | { cmd: 'partitura-insert'; name: string; floor?: string; workspace?: string; commands: boolean }
  | { cmd: 'partitura-delete'; name: string }
  | { cmd: 'list'; json?: boolean }
  | { cmd: 'ask'; to: string; prompt: string }
  | { cmd: 'check'; name: string }
  | { cmd: 'note-create'; content: string; name?: string; stack?: string; color?: string }
  | { cmd: 'note-read'; name: string; offset?: number; limit?: number }
  | { cmd: 'note-write'; name: string; content: string }
  | { cmd: 'note-edit'; name: string; old: string; new: string }
  | { cmd: 'hook-claude-stop' }
  | { cmd: 'hook-claude-busy' }
  | { cmd: 'hook-claude-ready' }
  | { cmd: 'hook-codex-notify'; payload: string }
  | { cmd: 'help' }

export type RoleScope = 'current' | 'global'

/** Agenda e opções de rotina (skill palco-routines). A agenda vai em texto; o servidor interpreta. */
export interface RoutineFields {
  every?: string
  daily?: string
  /** `mon,wed,fri@09:00` */
  weekly?: string
  /** `AAAA-MM-DD HH:MM` */
  once?: string
  terminal?: string
  reminder?: boolean
  count?: number
  until?: string
  preRun?: string
  noSkipIfBusy?: boolean
  noNotify?: boolean
  disabled?: boolean
}

import { RECALL_USAGE, SAY_USAGE } from './chat'
export function unescapePrompt(s: string): string {
  return s.replace(/\\([nt\\])/g, (_match, character: string) => character === 'n' ? '\n' : character === 't' ? '\t' : '\\')
}

/** Os comandos, num lugar só: a mensagem de uso e a ajuda do `palco help` saem daqui. */
export const COMMAND_USAGE: readonly string[] = [
  'account list|add <nome> --agent claude|codex|antigravity --dir D|remove <nome>',
  'list [--json]',
  SAY_USAGE,
  RECALL_USAGE,
  'ask --batch JSON | ask Nome --raw texto (\\n, \\t, \\e, \\xNN)',
  'notify mensagem',
  'debug (nunca imprime token)',
  'arrange [Nome] [--name N] [--icon lucide-ou-emoji] [--color #RRGGBB] [--agent | --note | --band | --fichario] | arrange [Nome] [--json]',
  'connect De [--agent|--band|--note|--fichario|--portal] Para [--agent|--band|--note|--fichario|--portal]',
  'note stack Nome [Fichário] | unstack Nome | delete Nome | delete --stack Fichário',
  'note import arquivo.md --copy',
  'ask <agente|banda> <prompt>',
  'check <agente>',
  'note create [conteúdo] [--name nome] [--stack [Fichário]] [--color C]',
  'note read <nome> [offset] [limit]',
  'note write <nome> <conteúdo>',
  'note edit <nome> <antigo> <novo>',
  'recruit [nome] [--preset P] [--role R] [--floor F] [--space S] [--workspace W] [--band B] [--command C] [--dir pasta] [--account A] [--icon I] [--color C]',
  'recruit [nome novo] (--preset P | --command C | --account A) --replace <nome antigo> [--role R] [--dir pasta]',
  'partitura list | create <nome> [agente...] [--without-me] [--description D] [--note-text on|off] [--commands on|off] | update <nome> [agente...] [--without-me] [--name N] [--description D] [--note-text on|off] [--commands on|off] | insert <nome> [--floor F] [--workspace W] [--commands on|off] | delete <nome>',
  'preset list [--json] | show <nome> | create <nome> [--command C] [--account A] [--maestro on|off] [--chat on|off] [--quick-start on|off] | set <nome> [--name N] [--command C] [--account A] [--maestro on|off] [--chat on|off] [--quick-start on|off] | delete <nome>',
  'role list [--json] | show <nome> | create <nome> <prompt> [--scope current|global] | edit <nome> <antigo> <novo> [--scope current|global] | edit <nome> --scope current|global | write <nome> <prompt> | delete <nome> [--force] | assign <agente> <role> | assign <agente> --none',
  'dismiss <nome>',
  'band create <nome> [agente...] [--without-me] [--floor F] [--workspace W] [--icon I] [--color C]',
  'band add <banda> <membro>',
  'band remove <banda> <membro>',
  'band dissolve <banda>',
  'floor create <nome> [--from CAMINHO] [--branch B] [--existing-branch] [--copy] [--no-git] [--copy-ground] [--partitura P]',
  'floor create [nome] --pull-request NÚMERO|URL [--copy] [--copy-ground]',
  'floor create <nome> --dir CAMINHO [--copy-ground] [--partitura P]',
  'floor list [--json]',
  'floor unload <nome>',
  'floor set-dir <nome> CAMINHO',
  'floor land <nome> [--into branch] [--delete-branch] [--keep-floor]',
  'floor delete <nome> [--keep-branch] [--keep-folder] [--force]',
  'floor status [texto] [--state working|blocked|review|done] [--progress 2/5|40%|0.4] [--floor nome] [--clear]',
  'routine create <nome> --command "..." (--every 30m|45s|1h30m | --daily HH:MM | --weekly mon,wed@HH:MM | --once "AAAA-MM-DD HH:MM") [--terminal T | --reminder] [--count N] [--until AAAA-MM-DD] [--pre-run "script"] [--no-skip-if-busy] [--no-notify] [--disabled]',
  'routine edit <nome> [--id prefixo] [--name N] [--command C] [--every 30m | --daily HH:MM | --weekly mon,wed@HH:MM | --once "AAAA-MM-DD HH:MM"] [--terminal T | --reminder] [--count N] [--until AAAA-MM-DD] [--pre-run "script"] [--no-skip-if-busy] [--no-notify] [--disabled]',
  'routine list [--json]',
  'routine show|enable|disable|run|delete <nome> [--id prefixo]',
  'workspace list [--json]',
  'workspace unload <nome>',
  'workspace delete <nome> [--force]',
  'workspace create <nome> --dir CAMINHO [--from origem] [--group G] [--space S]',
  'workspace rename <antigo> <novo>',
  'workspace move <nome> --group G | --root | --space S',
  'space list',
  'space create <nome> [--icon I] [--color C]',
  'space edit <nome> [--name N] [--icon I] [--color C | --color none]',
  'space move <nome> (--to N | --left | --right)',
  'space delete <nome>',
  'portal create URL [Nome] [--size LxA] | edit Nome --url URL | close Nome',
  'portal navigate Nome URL | back Nome | forward Nome | reload Nome | info Nome | screenshot Nome [arquivo.png]',
  'portal drag Nome origem destino | wait Nome alvo [ms] | check Nome (sem alvo: captura) | a11y Nome',
  'portal snapshot Nome | text Nome [alvo] | html Nome | evaluate Nome "js"',
  'portal click Nome alvo | fill Nome alvo valor | type Nome [alvo] texto | key Nome tecla | selectall Nome [alvo] | clear Nome [alvo]',
  'portal hover Nome alvo | focus Nome alvo | select Nome alvo opção | check Nome alvo | uncheck Nome alvo | upload Nome alvo arquivo...',
  'portal scroll Nome up|down|left|right px [alvo] | scrollintoview Nome alvo | logs-start Nome | logs Nome | resize Nome L A | ua Nome [preset]'
]

function usage(): never {
  throw new Error(`Uso: palco ${COMMAND_USAGE.join(' | ')} | hook claude-stop | hook claude-busy | hook claude-ready | hook codex-notify <json> | help`)
}
function name(value: string | undefined): string {
  if (value === undefined || value.trim() === '') usage()
  return value
}
/** Erro de uso com motivo (a linha de uso inteira não ajuda quando só uma regra falhou). */
function misuse(reason: string): never {
  throw new Error(`Uso: ${reason}`)
}
function onOff(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined
  if (value === 'on') return true
  if (value === 'off') return false
  return misuse(`${flag} aceita on ou off`)
}
function scope(value: string | undefined): RoleScope | undefined {
  if (value === undefined) return undefined
  if (value === 'current' || value === 'global') return value
  return misuse('--scope aceita current ou global')
}
/** Só as chaves definidas (o resultado do parser não carrega `undefined`). */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
function positiveInteger(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) usage()
  return Number(value)
}

export function parseArgs(argv: string[]): CliCommand {
  if (argv[1] === '--help' || argv[1] === '-h') return { cmd: 'help' }
  // `palco note stack --help`: ajuda pedida no fim de qualquer subcomando (o CLI mostra só as linhas dele).
  // Só `família sub --help` (sem `--`, sem valores antes: `note write X --help` grava o texto "--help").
  if (argv.length === 3 && argv[0] !== 'ask' && !argv.includes('--') && (argv[2] === '--help' || argv[2] === '-h')) return { cmd: 'help' }
  if (argv[0] === 'portal') return parsePortal(argv)
  const base = parseBase(argv)
  if (base) return base
  if (argv[0] === 'account') {
    if (argv[2] === '--help' || argv[2] === '-h') return { cmd: 'help' }
    const { positionals: p, values: v } = options(argv.slice(2), argv[1] === 'add' ? ['--agent', '--dir'] : [])
    if (argv[1] === 'list' && p.length === 0) return { cmd: 'account-list' }
    if (argv[1] === 'remove' && p.length === 1) return { cmd: 'account-remove', name: name(p[0]) }
    if (argv[1] === 'add' && p.length === 1 && (v.agent === 'claude' || v.agent === 'codex' || v.agent === 'antigravity') && v.dir) return { cmd: 'account-add', name: name(p[0]), agent: v.agent, dir: v.dir }
    return usage()
  }
  if (['recruit', 'dismiss', 'band', 'floor', 'portal'].includes(argv[0] ?? '')) return parseCoordination(argv)
  if (argv[0] === 'partitura') return parsePartitura(argv)
  if (argv[0] === 'preset' || argv[0] === 'role') return parseAgents(argv)
  if (argv[0] === 'routine') return parseRoutine(argv)
  if (argv[0] === 'workspace' || argv[0] === 'space') return parseWorkspace(argv)
  const subcommand = argv[0] === 'note' || argv[0] === 'hook' ? 2 : 1
  if (argv[subcommand] === '--help' || argv[subcommand] === '-h') return { cmd: 'help' }
  // Once terminated, all subsequent arguments are literal (including another --).
  // note create handles its own options below so --name after -- stays content.
  if (!(argv[0] === 'note' && argv[1] === 'create')) {
    const end = argv.indexOf('--', subcommand)
    if (end !== -1) argv = [...argv.slice(0, end), ...argv.slice(end + 1)]
  }
  const [command, second, third, fourth, fifth] = argv
  if (argv.length === 0 || (command === 'help' && argv.length <= 2)
    || ((command === '--help' || command === '-h') && argv.length === 1)) return { cmd: 'help' }
  switch (command) {
    case 'list':
      // `--json` preserva a resposta estruturada para scripts; o padrão é texto legível.
      if (argv.length === 2 && second === '--json') return { cmd: 'list', json: true }
      if (argv.length !== 1) usage()
      return { cmd: 'list' }
    case 'ask':
      if (argv.length !== 3) usage()
      return { cmd: 'ask', to: name(second), prompt: unescapePrompt(third!) }
    case 'check':
      if (argv.length !== 2) usage()
      return { cmd: 'check', name: name(second) }
    case 'note':
      switch (second) {
        case 'create': {
          let content: string | undefined, title: string | undefined, stack: string | undefined, color: string | undefined
          let literal = false
          for (let i = 2; i < argv.length; i++) {
            const argument = argv[i]!
            if (!literal && argument === '--') { literal = true; continue }
            if (!literal && argument === '--stack') {
              if (stack !== undefined) usage()
              stack = argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') ? name(argv[++i]) : 'Fichário'
            } else if (!literal && argument === '--color') {
              if (color !== undefined) usage()
              color = name(argv[++i])
            } else if (!literal && argument === '--name') {
              if (title !== undefined) usage()
              title = name(argv[++i])
            } else {
              if ((!literal && argument.startsWith('--')) || content !== undefined) usage()
              content = argument
            }
          }
          return { cmd: 'note-create', content: unescapePrompt(content ?? ''), ...(title === undefined ? {} : { name: title }), ...(stack === undefined ? {} : { stack }), ...(color === undefined ? {} : { color }) }
        }
        case 'read':
          if (argv.length < 3 || argv.length > 5) usage()
          return { cmd: 'note-read', name: name(third), ...(fourth === undefined ? {} : { offset: positiveInteger(fourth) }), ...(fifth === undefined ? {} : { limit: positiveInteger(fifth) }) }
        case 'write':
          if (argv.length !== 4) usage()
          return { cmd: 'note-write', name: name(third), content: unescapePrompt(fourth!) }
        case 'edit':
          if (argv.length !== 5) usage()
          return { cmd: 'note-edit', name: name(third), old: unescapePrompt(fourth!), new: unescapePrompt(fifth!) }
      }
      return usage()
    case 'hook':
      if (second === 'claude-stop' && argv.length === 2) return { cmd: 'hook-claude-stop' }
      if (second === 'claude-busy' && argv.length === 2) return { cmd: 'hook-claude-busy' }
      if (second === 'claude-ready' && argv.length === 2) return { cmd: 'hook-claude-ready' }
      if (second === 'codex-notify' && argv.length === 3) return { cmd: 'hook-codex-notify', payload: third! }
      return usage()
    default:
      return usage()
  }
}

/** Option parsing stops at --; duplicate/unknown flags and missing values are errors. */
function options(args: string[], valueFlags: string[] = [], booleanFlags: string[] = []) {
  const positionals: string[] = [], values: Record<string, string> = {}, flags: Record<string, true> = {}
  const seen = new Set<string>()
  let literal = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!literal && arg === '--') { literal = true; continue }
    if (!literal && arg.startsWith('-')) {
      if (seen.has(arg)) usage()
      seen.add(arg)
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
      if (valueFlags.includes(arg)) {
        const value = args[++i]
        if (value === undefined) usage()
        if (value.startsWith('--')) throw new Error(`Uso: argumento '${value}' parece uma opção; use '--' antes dos valores posicionais que começam com '-' (opções como ${arg} exigem um valor sem prefixo '-')`)
        values[key] = name(value)
      } else if (booleanFlags.includes(arg)) flags[key] = true
      else throw new Error(`Uso: argumento '${arg}' parece uma opção; use '--' antes dele se for um valor`)
    } else positionals.push(arg)
  }
  return { positionals, values, flags }
}

function parseCoordination(argv: string[]): CliCommand {
  const [command, sub] = argv
  const nested = command === 'band' || command === 'floor'
  const start = nested ? 2 : 1
  if (argv[1] === '--help' || argv[1] === '-h' || argv[start] === '--help' || argv[start] === '-h') return { cmd: 'help' }
  const tokens = argv.slice(start)
  if (command === 'recruit') {
    const { positionals: p, values: v } = options(tokens, ['--agent', '--command', '--dir', '--floor', '--band', '--preset', '--role', '--workspace', '--space', '--account', '--icon', '--color', '--replace'])
    if (p.length > 1 || (v.agent !== undefined && !['claude', 'codex', 'antigravity', 'shell'].includes(v.agent))) usage()
    if (v.replace !== undefined) {
      if (v.floor !== undefined || v.workspace !== undefined || v.space !== undefined || v.band !== undefined) misuse('--replace não aceita --floor, --workspace, --space nem --band: o nó fica onde está')
      if (v.preset === undefined && v.command === undefined && v.agent === undefined && v.account === undefined) misuse('--replace precisa de --preset, --command ou --account')
      return { cmd: 'recruit', ...(p[0] === undefined ? {} : { name: name(p[0]) }), ...v, ...(v.agent === undefined ? {} : { agent: v.agent as AgentKind }) }
    }
    // Sem nome, o colega se chama "Recruit" (o canvas acrescenta " 2", " 3" se colidir).
    return { cmd: 'recruit', name: p[0] === undefined ? 'Recruit' : name(p[0]), ...v, ...(v.agent === undefined ? {} : { agent: v.agent as AgentKind }) }
  }
  if (command === 'dismiss') {
    const { positionals: p } = options(tokens)
    if (p.length !== 1) usage()
    return { cmd: 'dismiss', name: name(p[0]) }
  }
  if (command === 'band') {
    if (sub === 'create') {
      const { positionals: p, values: v, flags } = options(tokens, ['--floor', '--workspace', '--icon', '--color'], ['--without-me'])
      if (p.length < 1) usage()
      return { cmd: 'band-create', name: name(p[0]), members: p.slice(1).map(name), ...flags, ...v }
    }
    const { positionals: p } = options(tokens)
    if ((sub === 'add' || sub === 'remove') && p.length === 2) return { cmd: sub === 'add' ? 'band-add' : 'band-remove', band: name(p[0]), member: name(p[1]) }
    if (sub === 'dissolve' && p.length === 1) return { cmd: 'band-dissolve', band: name(p[0]) }
    return usage()
  }
  if (command === 'floor') {
    if (sub === 'create') {
      const { positionals: p, values, flags } = options(tokens, ['--branch', '--from', '--partitura', '--dir', '--pull-request'], ['--existing-branch', '--no-git', '--copy-ground', '--copy'])
      // Com --pull-request o nome é opcional: sai do número e do título.
      if (p.length !== 1 && !(p.length === 0 && values.pullRequest !== undefined)) usage()
      // --copy com --no-git é recusado pelo servidor (o resumo da skill lista todas as opções juntas).
      if (flags.copy && values.dir !== undefined) misuse('--copy não combina com --dir')
      if (values.pullRequest !== undefined) {
        if (values.dir !== undefined || values.branch !== undefined || flags.existingBranch || flags.noGit) misuse('--pull-request não combina com --dir, --branch, --existing-branch nem --no-git')
        if (!/^(#?[1-9]\d{0,8}|https?:\/\/\S+)$/.test(values.pullRequest)) misuse('--pull-request pede o número (42, #42) ou o link do pull request')
      }
      if (values.dir !== undefined && (values.from !== undefined || values.branch !== undefined || flags.existingBranch || flags.noGit)) {
        misuse('--dir não combina com --from, --branch, --existing-branch nem --no-git')
      }
      if (flags.existingBranch && values.branch === undefined) misuse('--existing-branch precisa de --branch')
      // --no-git com --branch é recusado pelo servidor (o resumo da skill lista todas as opções juntas).
      return { cmd: 'floor-create', name: p.length ? name(p[0]) : '', ...values, ...flags }
    }
    if (sub === 'land' || sub === 'delete') {
      const { positionals: p, values, flags } = sub === 'land'
        ? options(tokens, ['--into'], ['--delete-branch', '--keep-floor'])
        : options(tokens, [], ['--force', '--keep-branch', '--keep-folder'])
      if (p.length !== 1) usage()
      return { cmd: sub === 'land' ? 'floor-land' : 'floor-delete', name: name(p[0]), ...values, ...flags }
    }
    if (sub === 'status') {
      // `floor status "Texto"`: o posicional é o texto do status; o andar (só o Maestro) vem em --floor.
      const { positionals: p, values: v, flags } = options(tokens, ['--state', '--progress', '--floor'], ['--clear'])
      if (p.length > 1 || (v.state !== undefined && !['working', 'blocked', 'review', 'done'].includes(v.state))
        || (flags.clear && (p.length > 0 || v.state !== undefined || v.progress !== undefined))) usage()
      return { cmd: 'floor-status', ...(p[0] === undefined ? {} : { text: name(p[0]) }), ...v, ...flags,
        ...(v.state === undefined ? {} : { state: v.state as FloorState }) }
    }
    if (sub === 'list') {
      const { positionals, flags } = options(tokens, [], ['--json'])
      if (positionals.length) usage()
      return { cmd: 'floor-list', ...(flags.json ? { json: true } : {}) }
    }
    if (sub === 'unload') {
      const { positionals: p } = options(tokens)
      if (p.length !== 1) usage()
      return { cmd: 'floor-unload', name: name(p[0]) }
    }
    if (sub === 'set-dir') {
      const { positionals: p } = options(tokens)
      if (p.length !== 2) usage()
      return { cmd: 'floor-set-dir', name: name(p[0]), dir: name(p[1]) }
    }
    return usage()
  }
  if (command === 'portal') {
    const { positionals: p } = options(tokens)
    const action = p[1]
    const arities: Record<string, number[]> = { navigate: [1], snapshot: [0], click: [1], fill: [2], text: [0], screenshot: [0, 1], back: [0], reload: [0] }
    if (!action || !Object.hasOwn(arities, action) || !arities[action]!.includes(p.length - 2)) usage()
    return { cmd: 'portal', name: name(p[0]), action: action as Extract<CliCommand, { cmd: 'portal' }>['action'], args: p.slice(2) }
  }
  return usage()
}

const ROUTINE_SINGLE = ['show', 'enable', 'disable', 'run', 'delete'] as const
const SCHEDULE_FLAGS = ['--every', '--daily', '--weekly', '--once'] as const

function parseRoutine(argv: string[]): CliCommand {
  const sub = argv[1]
  if (sub === undefined || sub === '--help' || sub === '-h' || argv[2] === '--help') return sub === undefined ? usage() : { cmd: 'help' }
  const tokens = argv.slice(2)
  if (sub === 'list') {
    if (tokens.length > 1 || (tokens.length === 1 && tokens[0] !== '--json')) usage()
    return { cmd: 'routine-list', ...(tokens[0] === '--json' ? { json: true } : {}) }
  }
  if ((ROUTINE_SINGLE as readonly string[]).includes(sub)) {
    const { positionals: p, values: v } = options(tokens, ['--id'])
    if (p.length !== 1) usage()
    return { cmd: `routine-${sub as (typeof ROUTINE_SINGLE)[number]}`, name: name(p[0]), ...v }
  }
  if (sub !== 'create' && sub !== 'edit') return usage()
  const { positionals: p, values: v, flags } = options(tokens,
    ['--command', ...SCHEDULE_FLAGS, '--terminal', '--count', '--until', '--pre-run', '--id', '--name'],
    ['--reminder', '--no-skip-if-busy', '--no-notify', '--disabled'])
  if (p.length !== 1) usage()
  const schedules = SCHEDULE_FLAGS.filter((f) => v[f.slice(2)] !== undefined).length
  if (sub === 'create' ? schedules !== 1 : schedules > 1) misuse('use exatamente uma agenda: --every, --daily, --weekly ou --once')
  if (flags.reminder && v.terminal !== undefined) misuse('--reminder não tem terminal de destino: não combine com --terminal')
  const { count, command, id, name: newName, ...rest } = v
  const fields = defined({
    ...rest, ...flags,
    ...(command === undefined ? {} : { command: unescapePrompt(command) }),
    ...(count === undefined ? {} : { count: positiveInteger(count) })
  })
  if (sub === 'create') {
    if (command === undefined) misuse('routine create precisa de --command')
    if (id !== undefined || newName !== undefined) misuse('--id e --name são de routine edit')
    return { cmd: 'routine-create', name: name(p[0]), command: unescapePrompt(command), ...fields } as CliCommand
  }
  return { cmd: 'routine-edit', name: name(p[0]), ...(id === undefined ? {} : { id }), ...(newName === undefined ? {} : { newName }), ...fields } as CliCommand
}

function parseWorkspace(argv: string[]): CliCommand {
  const [command, sub] = argv
  if (sub === '--help' || sub === '-h' || argv[2] === '--help' || argv[2] === '-h') return { cmd: 'help' }
  const tokens = argv.slice(2)
  if (command === 'workspace') {
    if (sub === 'list') {
      const { positionals, flags } = options(tokens, [], ['--json'])
      if (positionals.length) usage()
      return { cmd: 'workspace-list', ...(flags.json ? { json: true } : {}) }
    }
    if (sub === 'create') {
      const { positionals: p, values } = options(tokens, ['--dir', '--from', '--group', '--space'])
      if (p.length !== 1) usage()
      if (values.dir === undefined) misuse('workspace create precisa de --dir CAMINHO (a pasta precisa existir)')
      return { cmd: 'workspace-create', name: name(p[0]), dir: values.dir, ...values }
    }
    if (sub === 'move') {
      const { positionals: p, values, flags } = options(tokens, ['--group', '--space'], ['--root'])
      if (p.length !== 1) usage()
      if (values.group === undefined && !flags.root && values.space === undefined) misuse('workspace move precisa de --group, --root ou --space')
      if (values.group !== undefined && flags.root) misuse('--group e --root são exclusivos')
      return { cmd: 'workspace-move', name: name(p[0]), ...values, ...flags }
    }
    if (sub === 'delete') {
      const { positionals: p, flags } = options(tokens, [], ['--force'])
      if (p.length !== 1) usage()
      return { cmd: 'workspace-delete', name: name(p[0]), ...flags }
    }
    if (sub === 'unload') {
      const { positionals: p } = options(tokens)
      if (p.length !== 1) usage()
      return { cmd: 'workspace-unload', name: name(p[0]) }
    }
    if (sub === 'rename') {
      const { positionals: p } = options(tokens)
      if (p.length !== 2) usage()
      return { cmd: 'workspace-rename', old: name(p[0]), new: name(p[1]) }
    }
    return usage()
  }
  if (sub === 'list') {
    if (tokens.length) usage()
    return { cmd: 'space-list' }
  }
  if (sub === 'create') {
    const { positionals: p, values } = options(tokens, ['--icon', '--color'])
    if (p.length !== 1) usage()
    return { cmd: 'space-create', name: name(p[0]), ...values }
  }
  if (sub === 'edit') {
    const { positionals: p, values } = options(tokens, ['--name', '--icon', '--color'])
    if (p.length !== 1) usage()
    const { name: newName, ...rest } = values
    return { cmd: 'space-edit', name: name(p[0]), ...(newName === undefined ? {} : { newName }), ...rest }
  }
  if (sub === 'move') {
    const { positionals: p, values, flags } = options(tokens, ['--to'], ['--left', '--right'])
    if (p.length !== 1) usage()
    const ways = [values.to !== undefined, flags.left === true, flags.right === true].filter(Boolean).length
    if (ways !== 1) misuse('space move precisa de exatamente um de --to N, --left ou --right')
    return { cmd: 'space-move', name: name(p[0]), ...(values.to === undefined ? {} : { to: positiveInteger(values.to) }), ...flags }
  }
  if (sub === 'delete') {
    const { positionals: p } = options(tokens)
    if (p.length !== 1) usage()
    return { cmd: 'space-delete', name: name(p[0]) }
  }
  return usage()
}

function parseAgents(argv: string[]): CliCommand {
  const [kind, action] = argv
  if (argv[2] === '--help' || argv[1] === '--help') return { cmd: 'help' }
  const tokens = argv.slice(2)
  if (kind === 'preset') {
    if (action === 'create' || action === 'set') {
      const { positionals: p, values: v } = options(tokens, ['--agent', '--command', '--role', '--account', '--maestro', '--chat', '--quick-start', ...(action === 'set' ? ['--name'] : [])])
      if (p.length !== 1) usage()
      if (v.agent !== undefined && !['claude', 'codex', 'antigravity', 'shell'].includes(v.agent)) usage()
      const out = defined({
        name: name(p[0]), command: v.command, account: v.account, maestro: onOff(v.maestro, '--maestro'), chat: onOff(v.chat, '--chat'), quickStart: onOff(v.quickStart, '--quick-start'),
        ...(action === 'create' ? { agent: v.agent as AgentKind | undefined, role: v.role } : { newName: v.name })
      })
      if (action === 'set' && Object.keys(out).length === 1) misuse('preset set precisa de ao menos uma opção')
      if (action === 'set' && (v.agent !== undefined || v.role !== undefined)) usage()
      return { cmd: action === 'create' ? 'preset-create' : 'preset-set', ...out } as CliCommand
    }
    const { positionals: p, flags: f } = options(tokens, [], action === 'list' ? ['--json'] : [])
    if (action === 'list' && p.length === 0) return { cmd: 'preset-list', ...(f.json ? { json: true } : {}) }
    if ((action === 'show' || action === 'delete') && p.length === 1) return { cmd: action === 'show' ? 'preset-show' : 'preset-delete', name: name(p[0]) }
    return usage()
  }
  const { positionals: p, values: v, flags } = options(tokens, action === 'create' || action === 'edit' ? ['--scope'] : [], action === 'assign' ? ['--none'] : action === 'list' ? ['--json'] : action === 'delete' ? ['--force'] : [])
  if (action === 'list' && p.length === 0) return { cmd: 'role-list', ...(flags.json ? { json: true } : {}) }
  if (action === 'show' && p.length === 1) return { cmd: 'role-show', name: name(p[0]) }
  if (action === 'delete' && p.length === 1) return { cmd: 'role-delete', name: name(p[0]), ...(flags.force ? { force: true } : {}) }
  if (action === 'create' && p.length === 2) return { cmd: 'role-create', name: name(p[0]), text: unescapePrompt(p[1]!), ...defined({ scope: scope(v.scope) }) }
  if (action === 'edit') {
    // `edit "Nome" antigo novo [--scope]` troca um trecho; `edit "Nome" --scope X` só muda o escopo.
    if (p.length === 3) return { cmd: 'role-edit', name: name(p[0]), old: unescapePrompt(p[1]!), new: unescapePrompt(p[2]!), ...defined({ scope: scope(v.scope) }) }
    if (p.length === 1 && v.scope !== undefined) return { cmd: 'role-edit', name: name(p[0]), scope: scope(v.scope)! }
    return misuse('role edit "Nome" "antigo" "novo" [--scope current|global] ou role edit "Nome" --scope current|global')
  }
  if (action === 'write' && p.length === 2) return { cmd: 'role-write', name: name(p[0]), text: unescapePrompt(p[1]!) }
  if (action === 'assign' && p.length === (flags.none ? 1 : 2)) return { cmd: 'role-assign', name: name(p[0]), ...(flags.none ? { none: true } : { role: name(p[1]) }) }
  return usage()
}

function parsePartitura(argv: string[]): CliCommand {
  const action = argv[1]
  if (argv[2] === '--help' || argv[1] === '--help') return { cmd: 'help' }
  const valueFlags = action === 'create' ? ['--description', '--note-text', '--commands'] : action === 'update' ? ['--description', '--note-text', '--commands', '--name'] : action === 'insert' ? ['--floor', '--workspace', '--commands'] : []
  const { positionals: p, values: v, flags } = options(argv.slice(2), valueFlags, action === 'create' || action === 'update' ? ['--without-me'] : [])
  if (action === 'list' && p.length === 0) return { cmd: 'partitura-list' }
  if (p.length < 1) return usage()
  if (action === 'create') {
    return { cmd: 'partitura-create', name: name(p[0]), agents: p.slice(1).map(name), ...flags, noteText: onOff(v.noteText, '--note-text') ?? true, ...defined({ description: v.description, commands: onOff(v.commands, '--commands') }) }
  }
  if (action === 'update') {
    return { cmd: 'partitura-update', name: name(p[0]), agents: p.slice(1).map(name), ...flags, ...defined({ newName: v.name, description: v.description, noteText: onOff(v.noteText, '--note-text'), commands: onOff(v.commands, '--commands') }) }
  }
  if (p.length !== 1) return usage()
  if (action === 'insert') return { cmd: 'partitura-insert', name: name(p[0]), ...defined({ floor: v.floor, workspace: v.workspace }), commands: onOff(v.commands, '--commands') ?? true }
  if (action === 'delete') return { cmd: 'partitura-delete', name: name(p[0]) }
  return usage()
}
