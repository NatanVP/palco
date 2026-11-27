import { COMMAND_USAGE } from './args'

export const HELP = `palco: fala com os outros nós do canvas

${COMMAND_USAGE.map((line) => `  palco ${line}`).join('\n')}

  (\\n e \\t no prompt viram quebra de linha e tab; "ask" a uma banda imprime JSON, uma entrada por membro)
  ("Nome @ Workspace" é um agente de outro workspace ligado a você; um nome local com " @ " vai como local:Nome, em qualquer comando que cite um nó)
`

/** `palco <comando> [sub] --help`: só as linhas da ajuda daquele comando (a ajuda inteira quando nada bate). */
export function helpFor(argv: string[]): string {
  const words = argv.filter((a) => a !== '--help' && a !== '-h' && a !== 'help')
  if (words.length === 0) return HELP
  const lines = HELP.split('\n')
  const match = (n: number) => lines.filter((l) => l.trimStart().startsWith(`palco ${words.slice(0, n).join(' ')}`))
  let found = (words.length > 1 ? match(2) : []).length ? match(2) : match(1)
  if (!found.length) return HELP
  // `preset create --help`: só as alternativas daquele subcomando, quando o uso da família junta vários com ' | '.
  if (words.length > 1 && !match(2).length) {
    const alts = found.flatMap((l) => l.trim().replace(/^palco \S+ /, '').split(' | ')).filter((a) => a.startsWith(`${words[1]} `) || a === words[1])
    if (alts.length) found = alts.map((a) => `palco ${words[0]} ${a}`)
  }
  const usage = found.map((l) => l.trim()).join('\n')
  // Só as flags que o uso mostrado cita, cada uma com a sua linha (a ordem segue a lista da família).
  const cited = new Set(usage.match(/--[a-z][a-z-]*/g) ?? [])
  const seen = new Set<string>()
  const details = (FLAG_HELP[words[0]!] ?? []).filter((l) => {
    const flag = l.split(/\s/)[0]!
    if (!cited.has(flag) || seen.has(flag)) return false
    seen.add(flag)
    return true
  })
  const note = words[0] === 'routine' ? '\nSem --terminal nem --reminder, create executa em segundo plano, sem terminal (limite de 10 min).\nrun em segundo plano espera até 60 s; show mostra início, duração, código e saída.\n' : ''
  return `${usage}\n${note}${details.length ? `\nOpções:\n${details.map((l) => `  ${l}`).join('\n')}\n` : ''}`
}


/** Uma linha por flag, por família de comando (`palco <cmd> --help`). */
export const FLAG_HELP: Readonly<Record<string, readonly string[]>> = {
  list: ['--json  imprime a resposta crua em JSON (para scripts), em vez do texto agrupado'],
  connect: ['--agent  o nome é de um agente', '--band  o nome é de uma banda', '--note  o nome é de uma nota', '--fichario  o nome é de um fichário', '--portal  o nome é de um portal'],
  ask: ['--batch  mapa JSON {"Agente": "prompt"}: pergunta a todos em paralelo e devolve [{name, output}]', '--raw  manda entrada crua ao terminal: \\n é Enter, \\t Tab, \\e ESC, \\xNN um byte'],
  arrange: ['--name  renomeia (você, uma nota ou, sendo Maestro, um colega ou banda)', '--icon  ícone lucide (kebab-case) ou emoji', '--color  cor #RRGGBB ou um nome (blue, red, green, orange, purple, pink, cyan, yellow)', '--agent  o alvo é um agente (desempata nomes iguais)', '--note  o alvo é uma nota', '--band  o alvo é uma banda', '--fichario  o alvo é um fichário', '--json  sem opções, imprime o visual atual em JSON'],
  note: ['--name  nome fixo, que não muda com a primeira linha do conteúdo', '--stack  arquiva no fichário com esse nome (criado se faltar); em delete, apaga o fichário e as notas dele', '--color  cor do cartão (#RRGGBB)', '--copy  em import, cria a nota com uma cópia do texto do arquivo (obrigatório)'],
  recruit: [
    '--preset  um preset do usuário (palco preset list); sem ele, uma cópia de você',
    '--role  role que o recruta recebe como contexto inicial (palco role list)',
    '--floor  andar onde o recruta nasce ("Ground" = térreo)',
    '--space  outro espaço da barra: o recruta nasce num workspace dele (com mais de um, informe --workspace)',
    '--workspace  outro workspace; vocês se enxergam como "Nome @ Workspace"',
    '--band  banda em que o recruta entra',
    '--command  linha de comando do agente (flags e variáveis valem); o agente sai do programa',
    '--dir  pasta onde o recruta começa',
    '--account  conta do CLI ("Default" = login padrão); vence a do preset',
    '--icon  ícone do card (lucide ou emoji)',
    '--color  cor do card (#RRGGBB ou nome)',
    '--replace  troca o agente de um colega existente no mesmo nó (cordas e posição ficam)'
  ],
  band: ['--without-me  deixa você fora da banda (você a coordena de fora)', '--floor  forma a banda em outro andar', '--workspace  forma a banda em outro workspace ("Banda @ Workspace")', '--icon  ícone da banda', '--color  cor da moldura'],
  floor: [
    '--from  pasta de base do andar (relativa ao workspace); em land, não se aplica',
    '--branch  branch do andar (padrão: palco/<nome>)',
    '--existing-branch  usa uma branch que já existe em vez de criar',
    '--no-git  andar simples, sem worktree, na pasta de base',
    '--copy-ground  começa com uma cópia do layout do térreo',
    '--copy  cópia independente do repositório, como está agora (exige cópia instantânea no disco)',
    '--pull-request  andar para revisar um pull request aberto (42, #42 ou o link)',
    '--partitura  coloca uma partitura salva no andar novo, ligada a você',
    '--dir  pasta que você já tem (worktree ou pasta comum) vira o andar',
    '--into  em land, também faz merge na branch indicada',
    '--delete-branch  em land com --into, apaga a branch do andar',
    '--keep-floor  em land, mantém o andar depois',
    '--keep-branch  em delete, mantém a branch',
    '--keep-folder  em delete, mantém a pasta (e a branch)',
    '--force  em delete, remove mesmo com mudanças não commitadas',
    '--state  working, blocked, review ou done (blocked/review/done notificam)',
    '--progress  2/5, 40% ou 0.4',
    '--floor  outro andar (só o Maestro; "Ground" = térreo)',
    '--clear  remove o status',
    '--json  imprime a lista em JSON'
  ],
  routine: [
    '--command  comando de shell ou prompt; {{output}} recebe a saída do --pre-run',
    '--every  intervalo: 45s, 30m, 2h, 1h30m (número sozinho = minutos)',
    '--daily  todo dia em HH:MM',
    '--weekly  dias e hora: mon,wed,fri@09:00',
    '--once  uma vez: "AAAA-MM-DD HH:MM"',
    '--terminal  dispara no terminal indicado do workspace',
    '--reminder  sem terminal: notificação na área de trabalho',
    '--count  para depois de N disparos',
    '--until  para nesta data (AAAA-MM-DD)',
    '--pre-run  script antes de cada disparo (sair ≠ 0 pula)',
    '--no-skip-if-busy  dispara mesmo com o terminal ocupado',
    '--no-notify  não notifica ao disparar',
    '--disabled  cria pausada',
    '--id  prefixo do id, quando há rotinas com o mesmo nome',
    '--name  em edit, o nome novo',
    '--json  imprime a lista em JSON'
  ],
  workspace: ['--force  em delete, encerra os agentes em execução antes de remover; preserva a pasta do projeto', '--dir  pasta do projeto (precisa existir)', '--from  copia o layout de outro workspace', '--group  grupo da barra lateral (criado se faltar)', '--space  espaço (página do rodapé), criado se faltar', '--root  tira o workspace de qualquer grupo', '--json  em list, imprime o JSON cru'],
  space: ['--icon  ícone do espaço', '--color  cor (#RRGGBB, nome ou none)', '--name  em edit, o nome novo', '--to  posição no rodapé (1 = primeiro)', '--left  uma posição para a esquerda', '--right  uma posição para a direita'],
  preset: ['--command  linha de comando do agente', '--account  conta do CLI ("Default" = login padrão)', '--maestro  on/off: terminais do preset nascem Maestro', '--chat  on/off: terminais do preset começam no modo de chat', '--quick-start  on/off: aparece no início rápido', '--name  em set, o nome novo', '--agent  claude, codex ou shell (padrão: sai do comando)', '--role  role padrão do preset'],
  role: ['--force  em delete, tira o role de quem usa (terminais, presets e partituras) e apaga', '--scope  current (só este workspace, o padrão) ou global', '--none  em assign, tira o role', '--json  imprime a lista em JSON'],
  partitura: ['--without-me  salva o time sem você', '--description  descrição da partitura', '--note-text  on/off: guarda o texto das notas', '--name  em update, o nome novo', '--floor  andar onde inserir', '--workspace  workspace onde inserir (ligado a você entre workspaces)', '--commands  em insert, on/off: inicia os comandos dos agentes; em create/update, off salva o time sem os comandos'],
  portal: ['--size  tamanho do portal ao criar (LxA)', '--url  em edit, o endereço novo'],
  account: ['--agent  claude ou codex', '--dir  pasta de configuração da conta (CLAUDE_CONFIG_DIR ou CODEX_HOME)']
}
