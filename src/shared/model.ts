import type { PortalStorage } from './portal-settings'
// Contratos compartilhados entre main, preload, renderer e CLI.
// Alterações nesses contratos precisam manter main, preload, renderer e CLI compatíveis.

/** `other`: agente genérico (agy, opencode…): o comando é digitado no shell, sem hooks; o `ask` resolve por silêncio. */
export type AgentKind = 'claude' | 'codex' | 'antigravity' | 'shell' | 'other'

export interface Vec {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

/** `null` = Ground (o canvas principal). Conexões só ligam nós do mesmo floor. */
export type FloorId = string | null

/** "Bloquear" do menu do elemento (vale para todo tipo): não se arrasta, não redimensiona e fica fora de Organizar e Alinhar. */
export interface Lockable {
  positionLocked?: boolean
  /** Grupo (moldura) a que o elemento pertence; o nome e a cor ficam em `Workspace.groups`. */
  groupId?: string
}

/** Grupo do canvas: nome pode ser vazio; sem cor, a moldura é neutra. */
export interface CanvasGroup { name: string; color?: string }

export interface TerminalNode extends Lockable {
  id: string
  /** "Descarregar": o processo foi encerrado e só volta por Recarregar, pelo botão do cartão ou pela CLI. */
  unloaded?: boolean
  /** "Desfocar": o conteúdo fica coberto até o usuário remover o desfoque. */
  redacted?: boolean
  kind: 'terminal'
  floorId: FloorId
  name: string
  agent: AgentKind
  /** Comando base do agente (ex.: "claude", "codex"); vazio para shell puro. */
  command: string
  cwd: string
  /** Conta global selecionada; ausente usa o ambiente padrão do agente. */
  accountId?: string
  /** Id do terminal que o recrutou (`palco recruit`); só ele pode encerrá-lo com `palco dismiss`. Ausente = criado pela interface. */
  recruitedBy?: string
  /** Nome do role aplicado no boot (instruções de sistema do agente); vale a partir do próximo início. */
  role?: string
  /** false = partitura inserida sem iniciar comandos; só inicia por ação explícita. */
  autoStart?: boolean
  /** Cor de destaque do terminal (#RRGGBB). */
  color?: string
  /** Ícone: nome de ícone lucide ou um emoji. */
  icon?: string
  /** Tamanho da fonte do terminal, em px. */
  fontSize?: number
  /** Aparência própria (do preset ou do Editar): ausente = herda das Configurações. */
  themeId?: string
  darkThemeId?: string
  fontFamily?: string
  chatFontFamily?: string
  chatFontSize?: number
  /** Monitorar atividade (avisar quando o trabalho termina). */
  monitor?: boolean
  /** Onde roda (ausente = local): tmux, SSH, contêiner Docker ou Docker Sandbox. */
  environment?: import('./environment').Environment
  /** O card mostra a face de chat em vez do terminal (o PTY segue vivo). */
  chatMode?: boolean
  /** Durante um turno, mostra a prévia do terminal junto do chat (padrão: sim). */
  chatShowsShell?: boolean
  /** Maestro: integra e exclui floors de qualquer lugar e encerra qualquer terminal alcançável. */
  maestro?: boolean
  pos: Vec
  size: Size
}

/** Famílias de fonte da nota (a barra contextual oferece estas). */
export const NOTE_FONT_FAMILIES = ['mono', 'sans', 'serif'] as const
export type NoteFontFamily = (typeof NOTE_FONT_FAMILIES)[number]

export interface NoteNode extends Lockable {
  id: string
  redacted?: boolean
  kind: 'note'
  /** Arquivo .md/.txt do disco que esta nota mostra e edita; o conteúdo do nó acompanha o do arquivo. */
  linkedFile?: string
  /** O arquivo ligado não pôde ser lido ou gravado: o nó guarda o último texto. */
  fileMissing?: boolean
  floorId: FloorId
  name: string
  content: string
  pos: Vec
  size: Size
  /** Cor do cartão (#RRGGBB); ausente = a cor padrão da nota. */
  color?: string
  /** `markdown`: mostra o texto formatado (clique para editar); `raw`/ausente: o texto bruto. */
  render?: 'markdown' | 'raw'
  /** Tamanho (10–32 px) e família da fonte; ausentes = 13 px mono. */
  fontSize?: number
  fontFamily?: NoteFontFamily
  /** Conteúdo travado: só leitura até destravar. */
  locked?: boolean
  /** Fichário: notas com o mesmo id formam um card com abas e se movem juntas. */
  stackId?: string
  /** Nome fixo (`note create --name` ou renomeada pelo usuário); ausente = o nome acompanha a primeira linha. */
  nameFixed?: boolean
}

/** Grupo de terminais. Conectar algo à banda conecta a todos os membros; ask à banda pergunta a todos. */
export interface BandNode extends Lockable {
  id: string
  kind: 'band'
  floorId: FloorId
  name: string
  /** Ids de TerminalNode do mesmo floor, sem repetição. O renderer desenha a moldura em volta deles. */
  members: string[]
  /** Ícone (lucide ou emoji) e cor (#RRGGBB) da moldura; ausentes = visual padrão. */
  icon?: string
  color?: string
  pos: Vec
  size: Size
}

/** Navegador embutido (<webview> isolado) que os agentes controlam por `palco portal`. */
export interface PortalNode extends Lockable {
  id: string
  /** "Descarregar": a página sai da memória até Recarregar. */
  unloaded?: boolean
  /** "Silenciar": o áudio da página fica mudo. */
  muted?: boolean
  kind: 'portal'
  floorId: FloorId
  name: string
  url: string
  pos: Vec
  size: Size
  /** Moldura (barra de endereço) oculta. */
  chromeHidden?: boolean
  /** Agente de usuário declarado aos sites; ausente = o padrão do Chromium. */
  userAgent?: string
  /** Onde ficam login e dados do site; ausente (portais antigos) = a partição global de antes. */
  storage?: PortalStorage
}

/** Texto solto no canvas (ferramenta "Aa" do dock). */
export interface TextNode extends Lockable {
  id: string
  kind: 'text'
  floorId: FloorId
  name: string
  text: string
  fontSize: number
  pos: Vec
  size: Size
}

/** Arquivo do disco mostrado no canvas (imagem ou texto), só leitura. */
export interface FileNode extends Lockable {
  id: string
  kind: 'file'
  floorId: FloorId
  name: string
  path: string
  pos: Vec
  size: Size
}

/** Árvore de pastas a partir de um diretório, só leitura. */
export interface FileTreeNode extends Lockable {
  id: string
  kind: 'filetree'
  floorId: FloorId
  name: string
  root: string
  /** Pasta em que se entrou, abaixo da raiz; ausente = a própria raiz. */
  current?: string
  pos: Vec
  size: Size
}

/** Cartão de um endereço da web; o título é o nome do nó. */
export interface LinkNode extends Lockable {
  id: string
  kind: 'link'
  floorId: FloorId
  name: string
  url: string
  pos: Vec
  size: Size
}

export type CanvasNode = TerminalNode | NoteNode | BandNode | PortalNode | TextNode | FileNode | FileTreeNode | LinkNode

/** Traço a mão livre (ferramenta lápis do dock), em coordenadas de mundo. */
export interface Drawing {
  id: string
  floorId: FloorId
  points: Vec[]
  color: string
  width: number
  /** Ferramenta que fez o traço; ausente (desenhos antigos) = caneta. Linha, seta e formas guardam dois pontos. */
  tool?: DrawKind
  /** Estilo do traço; ausente = sólido. O pincel não usa. */
  pattern?: DrawPattern
  /** Preenchimento das formas com área; ausente = sem preenchimento. */
  fill?: DrawFill
  /** Raio dos cantos do retângulo (e dos cantos arredondados das formas que o usam); ausente (desenhos antigos) = reto; a barra grava 6 nos novos. */
  radius?: number
  /** Ponto de controle da seta curva (em coordenadas de mundo); ausente = seta reta. */
  control?: Vec
  /** Texto dentro da forma com área (centrado, quebra de linha) e o tamanho dele (8–200, padrão 20). */
  text?: string
  textSize?: number
  /** Giro (radianos) em torno do centro da caixa; ausente = sem giro. Linha e seta não giram (têm alças de ponta). */
  rotation?: number
  /** "Bloquear": não se move nem se transforma. */
  locked?: boolean
}

/** O que se pode mudar num desenho já gravado (estilo em lote). Pontos, ferramenta e andar não mudam. */
export interface DrawingPatch { color?: string; width?: number; pattern?: DrawPattern; fill?: DrawFill; radius?: number; text?: string | null; textSize?: number; /** Pontos novos (redimensionar, girar o grupo) e giro. */ points?: Vec[]; rotation?: number; /** Ponto de controle da seta curva; null volta a seta reta. */ control?: Vec | null; locked?: boolean; /** Trazer para a frente ou enviar para trás (muda a ordem na lista; não é guardado). */ order?: 'front' | 'back' }

/** O que um desenho é: traço livre (caneta, pincel, marca-texto), linha, seta ou forma. */
export const DRAW_KINDS = ['pen', 'brush', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'oval', 'parallelogram', 'cloud', 'heart', 'boxX', 'checkbox', 'arrowLeft', 'arrowUp', 'arrowDown', 'arrowRight'] as const
export type DrawKind = (typeof DRAW_KINDS)[number]
/** Linha, seta e formas são definidas por exatamente dois pontos; só o traço livre tem mais. */
export const isTwoPointKind = (tool: DrawKind | undefined): boolean => tool !== undefined && tool !== 'pen' && tool !== 'brush' && tool !== 'highlighter'
/** Preenchimento das formas: nenhum, hachura, hachura cruzada, tom (cor a 20%) e sólido. */
export const DRAW_FILLS = ['none', 'hatch', 'cross', 'tint', 'solid'] as const
export type DrawFill = (typeof DRAW_FILLS)[number]
export const DRAW_PATTERNS = ['solid', 'dashed', 'dotted'] as const
export type DrawPattern = (typeof DRAW_PATTERNS)[number]

export type FloorState = 'working' | 'blocked' | 'review' | 'done'

/** Um floor é outro canvas do workspace, ligado a uma worktree git própria. */
export interface Floor {
  /** Elevado e encaixado deste andar; ausente = nenhum. */
  dockState?: DockState
  id: string
  name: string
  /** Raiz do repositório principal (git rev-parse --show-toplevel). */
  repoRoot: string
  /** Diretório da worktree: `<repoRoot>.floors/<nome>`. */
  dir: string
  branch: string
  /** Ref de onde a branch saiu (ex.: "main"). */
  baseRef: string
  /** Andar sem git (`--no-git`, pasta que não é repositório ou `--dir` comum): `branch` e `baseRef` vazios, sem land. */
  plain?: boolean
  /** Pasta do usuário adotada com `--dir` (worktree dele ou pasta comum): o palco nunca a apaga. */
  external?: boolean
  /** Pasta de base (`--from`) quando não é a do workspace. */
  baseDir?: string
  /** Clone independente do repositório (`--copy`) em vez de worktree. */
  copy?: boolean
  /** Pull request que o andar revisa (`--pull-request`). */
  pullRequest?: { number: number; url: string; title: string; sameRepository: boolean }
  /** `text`: a linha do status (`floor status "Texto"`), até 120 caracteres. */
  status?: { state: FloorState; progress?: string; text?: string }
  camera: { offset: Vec; zoom: number }
  createdAt: number
}

/** Conexão não direcionada entre dois nós (a corda do canvas). */
export interface Connection {
  id: string
  a: string
  b: string
}

/** Painéis do andar: o elemento encaixado numa borda, o elevado e os que já foram encaixados (o palco guarda isso como `dockState`). */
export type DockEdge = 'leading' | 'trailing'
export interface DockState { dockedId: string | null; edge: DockEdge; memory: string[]; liftedId: string | null }

export interface Workspace {
  id: string
  name: string
  nodes: Record<string, CanvasNode>
  connections: Connection[]
  /** Câmera do Ground; cada floor guarda a sua. */
  camera: { offset: Vec; zoom: number }
  /** Elevado e encaixado do Ground (cada floor guarda os seus); ausente = nenhum. */
  dockState?: DockState
  floors: Record<string, Floor>
  /** Floor exibido no canvas (`null` = Ground). */
  activeFloor: FloorId
  /** Traços do lápis; ausente em workspaces antigos (= nenhum). */
  drawings?: Drawing[]
  /** Nome de cada fichário, por `stackId` (ausente = o próprio id). */
  stackNames?: Record<string, string>
  /** Grupos, por `groupId` (ausente em workspaces antigos = nenhum). */
  groups?: Record<string, CanvasGroup>
  /** Linha de status do térreo (`floor status --floor "Ground"`): o resumo dos andares acima. */
  groundStatus?: { state: FloorState; progress?: string; text?: string }
}

export type NewNode =
  | Omit<TerminalNode, 'id'>
  | Omit<NoteNode, 'id'>
  | Omit<BandNode, 'id'>
  | Omit<PortalNode, 'id'>
  | Omit<TextNode, 'id'>
  | Omit<FileNode, 'id'>
  | Omit<FileTreeNode, 'id'>
  | Omit<LinkNode, 'id'>

/** Comando e pasta do terminal (Editar terminal): mudar reinicia o processo. O agente sai do comando. */
export interface TerminalConfig {
  command: string
  /** Seleção explícita; ausente preserva a inferência automática antiga. */
  agent?: AgentKind
  /** Absoluta e existente; vazia = a pasta padrão (worktree do floor ou a pessoal); `~/` = a pasta pessoal. */
  cwd: string
}

export interface AgentResolution { agent: AgentKind; warning?: string }

/** floorId e members não são patcháveis (use as operações de floor/banda). */
export type NodePatch = Partial<Pick<CanvasNode, 'name' | 'pos' | 'size'>> & {
  /** Árvore de arquivos: a pasta mostrada (a raiz limpa a navegação). */
  current?: string
  content?: string
  url?: string
  text?: string
  /** Nó de texto (6–400) ou terminal (8–40). */
  fontSize?: number
  /** Terminal: cor de destaque; nota: cor do cartão (#RRGGBB). `null` (só nota) volta ao padrão. */
  color?: string | null
  /** Só terminal: ícone (lucide ou emoji), pelo Editar da barra contextual. */
  icon?: string
  /** Só nota: família da fonte, trava do conteúdo e fichário (`null` tira do fichário). */
  fontFamily?: NoteFontFamily
  /** Só nota: formatado (markdown) ou texto bruto. */
  render?: 'markdown' | 'raw'
  locked?: boolean
  stackId?: string | null
  /** Só portal: moldura oculta. */
  chromeHidden?: boolean
  /** Só portal: agente de usuário (`''` volta ao padrão) e armazenamento. Mudar recria o conteúdo. */
  userAgent?: string
  storage?: PortalStorage
  positionLocked?: boolean
  /** Terminal e nota: desfoque. Portal: som mudo. (`unloaded` não entra por patch: tem canal próprio.) */
  redacted?: boolean
  muted?: boolean
  /** Só terminal: "Monitorar Atividade" (notificação do sistema ao terminar ou voltar a trabalhar). */
  monitor?: boolean
  /** Só terminal: face de chat e prévia do terminal durante os turnos. */
  chatMode?: boolean
  chatShowsShell?: boolean
}

export interface NewFloor {
  name: string
  /** Diretório de onde descobrir o repositório (normalmente o cwd de quem pediu). */
  fromDir: string
  /** Branch nova; padrão `palco/<nome>`. */
  branch?: string
  /** Ref base; padrão a branch atual do repo. */
  from?: string
  /** Faz checkout de `branch`, que já existe. */
  existingBranch?: boolean
  /** Sem isolamento git: o andar trabalha direto em `fromDir`. */
  noGit?: boolean
  /** Pasta que o usuário já tem (worktree ou pasta comum): vira o checkout do andar, sem criar nada. */
  dir?: string
  /** Pasta de base, para mostrar em `floor list` quando não é a do workspace. */
  baseDir?: string
  /** Clone independente em vez de worktree. */
  copy?: boolean
  /** Número, `#número` ou link do pull request a revisar; o nome pode vir vazio. */
  pullRequest?: string
}

/** O que o provedor (gh, glab) diz de um pull request. */
export interface PullRequestDetails {
  number: number
  title: string
  /** `OPEN` quando aberto. */
  state: string
  url: string
  headBranch: string
  headSha: string
  /** A branch é do próprio repositório (um push dela chega ao pull request). */
  sameRepository: boolean
  /** Ref do origin com os commits do pull request. */
  ref: string
}

export type LandResult =
  | { ok: true; merged: string; into: string }
  | { ok: false; error: string; conflicts?: string[] }

/** Resposta de `ask` a uma banda: uma entrada por membro, na ordem de `members`. */
export type BandAskItem = { name: string; output: string } | { name: string; error: string }

export type ResolveResult =
  | { ok: true; node: CanvasNode }
  | { ok: false; status: 403 | 404; error: string }

export type AskResult =
  | { ok: true; text: string; via: 'hook' | 'askback' | 'idle' }
  | { ok: false; error: 'timeout' | 'exited' | 'cancelled' | 'rejected'; text?: string }

/** Cabeçalhos HTTP do socket do palco. */
export const HEADER_TERMINAL = 'x-palco-terminal'
export const ENV_SOCKET = 'PALCO_SOCKET'
export const ENV_TERMINAL = 'PALCO_TERMINAL_ID'

/** Agenda de uma rotina, em hora local. `day`: 0 = domingo … 6 = sábado. `at`: ISO. */
export type Schedule =
  /** Intervalo em segundos (rotinas antigas em `minutes` são convertidas ao ler). */
  | { kind: 'every'; seconds: number }
  | { kind: 'daily'; time: string }
  /** Dias da semana (0 = domingo) num horário. */
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'once'; at: string }

export interface RoutineExecution {
  startedAt: string
  durationMs: number
  exitCode: number | null
  output: string
  status: 'running' | 'completed' | 'timedOut' | 'failed'
}

/** Prompt, comando ou lembrete executado num horário. */
export interface Routine {
  id: string
  name: string
  schedule: Schedule
  /** Terminal de destino; vazio num lembrete ou comando em segundo plano. */
  terminalId: string
  /** Prompt (agente) ou comando (shell); num lembrete, o texto da notificação. */
  content: string
  enabled: boolean
  /** Lembrete: sem terminal, dispara uma notificação na área de trabalho. */
  reminder?: boolean
  background?: boolean
  /** Andar onde o comando em segundo plano foi criado; null = térreo. */
  floorId?: string | null
  lastExecution?: RoutineExecution
  /** Script de shell antes de cada disparo (sair ≠ 0 pula); a saída entra no lugar de `{{output}}`. */
  preRun?: string
  /** Pula o disparo com o terminal ocupado (ausente = true). */
  skipIfBusy?: boolean
  /** Notificação ao disparar (ausente = true). */
  notify?: boolean
  /** Disparos restantes (`--count`); no zero, a rotina se desativa. */
  remaining?: number
  /** ISO; depois disso, a rotina se desativa. */
  until?: string
  /** "Início": ISO; nada dispara antes dele. */
  startsAt?: string
  /** Terminal que criou a rotina. */
  createdBy: string
  /** Workspace onde a rotina nasceu; ela fica nele mesmo se o terminal alvo for removido. Ausente em rotinas antigas (= o do alvo). */
  workspaceId?: string
  lastRun?: { at: string; result: string }
  /** ISO do próximo disparo, calculado pelo runner. */
  nextRun?: string
}

/** Um disparo no histórico das rotinas (agendado ou "rodar agora"). */
export interface RoutineRun {
  id: string
  routineId: string
  routineName: string
  workspaceId?: string
  /** Ausente num lembrete. */
  terminalName?: string
  content: string
  firedAt: string
  execution?: RoutineExecution
  /** 'ok', 'pulado: <motivo>', 'erro: <motivo>' ou 'rejeitado: <motivo>'. */
  result: string
}

/** Um workspace na barra lateral. `spaceId: null` = fora de qualquer grupo. */
export interface WorkspaceMeta {
  id: string
  name: string
  spaceId: string | null
  /** Espaço (página da barra) onde o workspace aparece; ausente = o Espaço inicial. */
  pageId?: string
  /** Ícone lucide (kebab-case) ou emoji; a imagem própria fica em `<workspaces>/<id>/icon.png`. */
  icon?: string
  /** Cor do glifo (#RRGGBB); ausente = sem cor. */
  color?: string
  /** Quantos terminais o workspace tem (preenchido pelo main ao montar a barra). */
  terminals?: number
  /** Pasta do projeto (`palco workspace create --dir`); ausente em workspaces antigos. */
  dir?: string
  /** O arquivo do workspace está somente leitura (versão futura ou ilegível): o trilho mostra um cadeado. */
  locked?: boolean
}

/** Grupo de workspaces na barra lateral (nome histórico: "space"). */
export interface Space {
  id: string
  name: string
  icon?: string
  color?: string
  collapsed: boolean
  /** Espaço (página) a que o grupo pertence; ausente = o Espaço inicial. */
  pageId?: string
}

/** Id do Espaço inicial: sempre existe, não se apaga e recebe o que fica sem página. */
export const HOME_PAGE_ID = 'inicio'

/** Um Espaço: uma página inteira da barra lateral, com os próprios grupos e workspaces (rodapé da barra). */
export interface SidebarPage {
  id: string
  name: string
  /** Ícone lucide (kebab-case) ou emoji. */
  icon: string
  color?: string
}

/** Estado da barra lateral: Espaços (páginas), grupos, ordem dos workspaces e os ativos. */
export interface Sidebar {
  /** O primeiro é sempre o Espaço inicial (`HOME_PAGE_ID`). */
  pages: SidebarPage[]
  activePage: string
  spaces: Space[]
  workspaces: WorkspaceMeta[]
  /** Ids de workspace na ordem de exibição. */
  order: string[]
  active: string
}

/** Uma ponta de corda entre workspaces, como a UI mostra (`Nome @ Workspace`). */
export interface CrossLinkEnd { id: string; name: string; workspaceId: string; workspace: string; floorId: FloorId }
/** Corda entre workspaces (`recruit --workspace`) com as duas pontas resolvidas. */
export interface CrossLinkView { id: string; a: CrossLinkEnd; b: CrossLinkEnd }

/** Configuração nomeada de agente (`palco recruit --preset`). */
export interface Preset {
  name: string
  agent: AgentKind
  command: string
  role?: string
  /** Nome da conta em que o preset inicia (`"Default"` ou ausente = login padrão do CLI). */
  account?: string
  /** Terminais do preset nascem em Modo Maestro. */
  maestro?: boolean
  /** Aparece no início rápido (ausente = sim). */
  quickStart?: boolean
  /** Ícone, cor, tema (e par claro/escuro), fontes do terminal e do chat; ausente = herda. */
  appearance?: import('./appearance').Appearance
  /** Os terminais do preset nascem na face de chat ('Iniciar no Modo de Chat'). */
  startInChat?: boolean
}

/** Instruções de papel aplicadas como prompt de sistema do agente. */
export interface Role {
  name: string
  text: string
}

/** Montagem salva do canvas, com posições relativas e chaves locais para religar conexões e bandas. */
export interface Partitura {
  name: string
  description?: string
  nodes: Array<NewNode & { key: string }>
  connections: Array<{ a: string; b: string }>
  bands: Array<{ name: string; members: string[] }>
  createdAt: string
  /** Veio de um arquivo: nada dela inicia até a pessoa confirmar os comandos uma vez. */
  imported?: true
}

/** Uma janela de limite de uso (sessão de 5 h ou semanal). */
export interface UsageWindow {
  usedPercent: number
  /** ISO de quando a janela renova, se conhecido. */
  resetsAt: string | null
}

export interface Account {
  id: string
  name: string
  agent: 'claude' | 'codex' | 'antigravity'
  /** Pasta passada ao CLI; seus arquivos de credencial nunca são lidos pelo palco. */
  configDir: string
  color?: string
  authMode?: 'cli' | 'apiKey'
  providerId?: string
  endpoint?: string
}

/** Uso por conta, consultado pelo CLI do agente. */
export interface AgentUsage {
  meters?: Array<{ name: string; windows: Array<UsageWindow & { name: string }> }>
  color?: string
  providerId?: string
  accountId?: string
  accountName?: string
  lastSuccessAt?: string
  isStale?: boolean
  agent: 'claude' | 'codex' | 'antigravity'
  plan?: string
  session?: UsageWindow
  weekly?: UsageWindow
  /** De onde veio a leitura (para o tooltip). */
  source: string
  /** Quando veio a leitura (ISO). */
  readAt?: string
  error?: string
}
