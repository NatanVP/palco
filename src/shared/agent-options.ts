import { ptBR } from './i18n/catalogs/pt-BR'
import { en } from './i18n/catalogs/en'
import { es } from './i18n/catalogs/es'

/** Catálogo conferido com claude --help 2.1.332 e codex --help 0.171.0. */
export type OptionAgent = 'claude' | 'codex'
export interface AgentOption {
  agent: OptionAgent
  flag: string
  aliases: readonly string[]
  kind: 'boolean' | 'text' | 'list' | 'choice'
  explanation: Record<'pt-BR' | 'en' | 'es', string>
  risk: 'normal' | 'danger'
  values?: readonly string[]
  optionalValue?: boolean
  repeat?: boolean
  dangerValues?: readonly string[]
  exclusive?: readonly string[]
}
export const AGENT_OPTION_VERSIONS = { claude: '2.1.332', codex: '0.171.0' } as const
export const MANAGED_AGENT_FLAGS = ['--settings', '--append-system-prompt-file'] as const
/** Configurações -c do Codex são mantidas pela integração, sem campo livre neste editor. */
export const MANAGED_CODEX_CONFIG = ['notify', 'developer_instructions'] as const
const explanation = (key: keyof typeof ptBR): AgentOption['explanation'] => ({ 'pt-BR': ptBR[key], en: en[key] ?? ptBR[key], es: es[key] ?? ptBR[key] })
export const AGENT_OPTIONS: readonly AgentOption[] = [
  {"agent": "claude","flag": "--add-dir","aliases": [],"kind": "list","explanation": explanation('agentOptions.claude.add_dir'),"risk": "normal","repeat": false},
  {"agent": "claude","flag": "--agent","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.agent'),"risk": "normal"},
  {"agent": "claude","flag": "--agents","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.agents'),"risk": "normal"},
  {"agent": "claude","flag": "--allow-dangerously-skip-permissions","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.allow_dangerously_skip_permissions'),"risk": "danger"},
  {"agent": "claude","flag": "--allowed-tools","aliases": ["--allowedTools"],"kind": "list","explanation": explanation('agentOptions.claude.allowed_tools'),"risk": "normal","repeat": false},
  {"agent": "claude","flag": "--append-system-prompt","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.append_system_prompt'),"risk": "normal"},
  {"agent": "claude","flag": "--autocompact","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.autocompact'),"risk": "normal"},
  {"agent": "claude","flag": "--ax-screen-reader","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.ax_screen_reader'),"risk": "normal"},
  {"agent": "claude","flag": "--betas","aliases": [],"kind": "list","explanation": explanation('agentOptions.claude.betas'),"risk": "normal","repeat": false},
  {"agent": "claude","flag": "--brief","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.brief'),"risk": "normal"},
  {"agent": "claude","flag": "--chrome","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.chrome'),"risk": "normal","exclusive": ["--no-chrome"]},
  {"agent": "claude","flag": "--continue","aliases": ["-c"],"kind": "boolean","explanation": explanation('agentOptions.claude.continue'),"risk": "normal"},
  {"agent": "claude","flag": "--dangerously-skip-permissions","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.dangerously_skip_permissions'),"risk": "danger"},
  {"agent": "claude","flag": "--debug","aliases": ["-d"],"kind": "text","explanation": explanation('agentOptions.claude.debug'),"risk": "normal","optionalValue": true},
  {"agent": "claude","flag": "--debug-file","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.debug_file'),"risk": "normal"},
  {"agent": "claude","flag": "--disable-slash-commands","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.disable_slash_commands'),"risk": "normal"},
  {"agent": "claude","flag": "--disallowed-tools","aliases": ["--disallowedTools"],"kind": "list","explanation": explanation('agentOptions.claude.disallowed_tools'),"risk": "normal","repeat": false},
  {"agent": "claude","flag": "--effort","aliases": [],"kind": "choice","explanation": explanation('agentOptions.claude.effort'),"risk": "normal","values": ["low","medium","high","xhigh","max"]},
  {"agent": "claude","flag": "--exclude-dynamic-system-prompt-sections","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.exclude_dynamic_system_prompt_sections'),"risk": "normal"},
  {"agent": "claude","flag": "--fallback-model","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.fallback_model'),"risk": "normal"},
  {"agent": "claude","flag": "--fork-session","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.fork_session'),"risk": "normal"},
  {"agent": "claude","flag": "--from-pr","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.from_pr'),"risk": "normal","optionalValue": true},
  {"agent": "claude","flag": "--ide","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.ide'),"risk": "normal"},
  {"agent": "claude","flag": "--mcp-config","aliases": [],"kind": "list","explanation": explanation('agentOptions.claude.mcp_config'),"risk": "normal","repeat": false},
  {"agent": "claude","flag": "--model","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.model'),"risk": "normal"},
  {"agent": "claude","flag": "--name","aliases": ["-n"],"kind": "text","explanation": explanation('agentOptions.claude.name'),"risk": "normal"},
  {"agent": "claude","flag": "--no-chrome","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.no_chrome'),"risk": "normal","exclusive": ["--chrome"]},
  {"agent": "claude","flag": "--permission-mode","aliases": [],"kind": "choice","explanation": explanation('agentOptions.claude.permission_mode'),"risk": "normal","values": ["acceptEdits","auto","bypassPermissions","manual","dontAsk","plan"],"dangerValues": ["bypassPermissions"]},
  {"agent": "claude","flag": "--plugin-dir","aliases": [],"kind": "list","explanation": explanation('agentOptions.claude.plugin_dir'),"risk": "normal","repeat": true},
  {"agent": "claude","flag": "--plugin-url","aliases": [],"kind": "list","explanation": explanation('agentOptions.claude.plugin_url'),"risk": "normal","repeat": true},
  {"agent": "claude","flag": "--prompt-suggestions","aliases": [],"kind": "choice","explanation": explanation('agentOptions.claude.prompt_suggestions'),"risk": "normal","values": ["true","false","1","0","yes","no","on","off"]},
  {"agent": "claude","flag": "--remote-control","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.remote_control'),"risk": "normal","optionalValue": true},
  {"agent": "claude","flag": "--remote-control-session-name-prefix","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.remote_control_session_name_prefix'),"risk": "normal"},
  {"agent": "claude","flag": "--restricted","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.restricted'),"risk": "normal"},
  {"agent": "claude","flag": "--resume","aliases": ["-r"],"kind": "text","explanation": explanation('agentOptions.claude.resume'),"risk": "normal","optionalValue": true},
  {"agent": "claude","flag": "--safe-mode","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.safe_mode'),"risk": "normal"},
  {"agent": "claude","flag": "--session-id","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.session_id'),"risk": "normal"},
  {"agent": "claude","flag": "--setting-sources","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.setting_sources'),"risk": "normal"},
  {"agent": "claude","flag": "--strict-mcp-config","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.strict_mcp_config'),"risk": "normal"},
  {"agent": "claude","flag": "--system-prompt","aliases": [],"kind": "text","explanation": explanation('agentOptions.claude.system_prompt'),"risk": "normal"},
  {"agent": "claude","flag": "--system-prompt-snapshot","aliases": [],"kind": "choice","explanation": explanation('agentOptions.claude.system_prompt_snapshot'),"risk": "normal","values": ["on","off"]},
  {"agent": "claude","flag": "--tmux","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.tmux'),"risk": "normal"},
  {"agent": "claude","flag": "--tools","aliases": [],"kind": "list","explanation": explanation('agentOptions.claude.tools'),"risk": "normal","repeat": false},
  {"agent": "claude","flag": "--verbose","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.claude.verbose'),"risk": "normal"},
  {"agent": "claude","flag": "--worktree","aliases": ["-w"],"kind": "text","explanation": explanation('agentOptions.claude.worktree'),"risk": "normal","optionalValue": true},
  {"agent": "codex","flag": "--enable","aliases": [],"kind": "list","explanation": explanation('agentOptions.codex.enable'),"risk": "normal","repeat": true},
  {"agent": "codex","flag": "--disable","aliases": [],"kind": "list","explanation": explanation('agentOptions.codex.disable'),"risk": "normal","repeat": true},
  {"agent": "codex","flag": "--remote","aliases": [],"kind": "text","explanation": explanation('agentOptions.codex.remote'),"risk": "normal"},
  {"agent": "codex","flag": "--remote-auth-token-env","aliases": [],"kind": "text","explanation": explanation('agentOptions.codex.remote_auth_token_env'),"risk": "normal"},
  {"agent": "codex","flag": "--strict-config","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.strict_config'),"risk": "normal"},
  {"agent": "codex","flag": "--image","aliases": ["-i"],"kind": "list","explanation": explanation('agentOptions.codex.image'),"risk": "normal","repeat": false},
  {"agent": "codex","flag": "--model","aliases": ["-m"],"kind": "text","explanation": explanation('agentOptions.codex.model'),"risk": "normal"},
  {"agent": "codex","flag": "--oss","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.oss'),"risk": "normal"},
  {"agent": "codex","flag": "--local-provider","aliases": [],"kind": "choice","explanation": explanation('agentOptions.codex.local_provider'),"risk": "normal","values": ["lmstudio","ollama"]},
  {"agent": "codex","flag": "--profile","aliases": ["-p"],"kind": "text","explanation": explanation('agentOptions.codex.profile'),"risk": "normal"},
  {"agent": "codex","flag": "--sandbox","aliases": ["-s"],"kind": "choice","explanation": explanation('agentOptions.codex.sandbox'),"risk": "normal","values": ["read-only","workspace-write","danger-full-access"],"dangerValues": ["danger-full-access"]},
  {"agent": "codex","flag": "--approve-for-me","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.approve_for_me'),"risk": "normal"},
  {"agent": "codex","flag": "--dangerously-bypass-approvals-and-sandbox","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.dangerously_bypass_approvals_and_sandbox'),"risk": "danger"},
  {"agent": "codex","flag": "--dangerously-bypass-hook-trust","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.dangerously_bypass_hook_trust'),"risk": "danger"},
  {"agent": "codex","flag": "--cd","aliases": ["-C"],"kind": "text","explanation": explanation('agentOptions.codex.cd'),"risk": "normal"},
  {"agent": "codex","flag": "--worktree","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.worktree'),"risk": "normal"},
  {"agent": "codex","flag": "--add-dir","aliases": [],"kind": "list","explanation": explanation('agentOptions.codex.add_dir'),"risk": "normal","repeat": true},
  {"agent": "codex","flag": "--ask-for-approval","aliases": ["-a"],"kind": "choice","explanation": explanation('agentOptions.codex.ask_for_approval'),"risk": "normal","values": ["on-request","never"]},
  {"agent": "codex","flag": "--search","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.search'),"risk": "normal"},
  {"agent": "codex","flag": "--no-alt-screen","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.no_alt_screen'),"risk": "normal"},
  {"agent": "codex","flag": "--no-daemon","aliases": [],"kind": "boolean","explanation": explanation('agentOptions.codex.no_daemon'),"risk": "normal"},
]

/** Exclusões explícitas permitem detectar mudanças na ajuda sem oferecer opções incompatíveis. */
export const EXCLUDED_AGENT_OPTIONS: readonly { agent: OptionAgent; flag: string; aliases: readonly string[]; reason: string }[] = [
  {"agent": "claude","flag": "--bare","aliases": [],"reason": "disables-integration"},
  {"agent": "claude","flag": "--bg","aliases": ["--background"],"reason": "external-session"},
  {"agent": "claude","flag": "--cloud","aliases": [],"reason": "external-session"},
  {"agent": "claude","flag": "--desktop","aliases": [],"reason": "external-session"},
  {"agent": "claude","flag": "--environment","aliases": [],"reason": "external-session"},
  {"agent": "claude","flag": "--file","aliases": [],"reason": "external-session"},
  {"agent": "claude","flag": "--forward-subagent-text","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--help","aliases": ["-h"],"reason": "informational"},
  {"agent": "claude","flag": "--include-hook-events","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--include-partial-messages","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--input-format","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--json-schema","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--max-budget-usd","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--no-session-persistence","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--output-format","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--permission-prompts","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--print","aliases": ["-p"],"reason": "noninteractive"},
  {"agent": "claude","flag": "--replay-user-messages","aliases": [],"reason": "noninteractive"},
  {"agent": "claude","flag": "--settings","aliases": [],"reason": "managed"},
  {"agent": "claude","flag": "--teleport","aliases": [],"reason": "external-session"},
  {"agent": "claude","flag": "--version","aliases": ["-v"],"reason": "informational"},
  {"agent": "codex","flag": "--config","aliases": ["-c"],"reason": "managed"},
  {"agent": "codex","flag": "--help","aliases": ["-h"],"reason": "informational"},
  {"agent": "codex","flag": "--version","aliases": ["-V"],"reason": "informational"},
]
