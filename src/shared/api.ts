import type { ModelId, VoiceProgress, VoiceStatus } from './voice'
import type { ClipboardApi } from './clipboard'
import type { NodeStateApi } from './node-state'
import type { AboutApi, GitHostsApi } from './about-git'
import type { DataSettingsApi } from './data-settings'
import type { AccountSettingsApi } from './account-settings'
import type { ProvidersApi } from './providers'
import type { PromptsApi, RoleLibraryApi, SkillsApi } from './agent-libraries'
import type { SystemApi } from './system'
import type { Preferences } from './preferences'
import type { KeyBinding, ShortcutId } from './shortcuts'
import type { ChatEntry, ChatSendResult, ChatState, ThreadColor } from './chat'
import type { Account, AgentKind, AgentResolution, AgentUsage, Drawing, DrawingPatch, DockState, Partitura, Preset, Role, Sidebar, Routine, RoutineRun, Schedule, Connection, Floor, FloorId, FloorState, LandResult, NewFloor, NewNode, NodePatch, TerminalConfig, Workspace, CrossLinkView } from './model'

/** Rotina com a agenda em texto e o nome do terminal alvo, para a UI. */
export type RoutineView = Routine & { scheduleText: string; terminal: string; workspace: string }
/** O que a folha de rotina grava; sem `id`, cria. */
export interface RoutineInput {
  id?: string
  name: string
  workspaceId: string
  /** `null` = lembrete ou, com background, comando sem terminal. */
  terminalId: string | null
  background?: boolean
  floorId?: string | null
  content: string
  preRun?: string
  skipIfBusy: boolean
  schedule: Schedule
  startsAt?: string
  end: { kind: 'never' } | { kind: 'count'; count: number } | { kind: 'date'; date: string }
  notify: boolean
  enabled: boolean
}

/** Máximo de operações por lote do histórico (o main recusa mais que isso). */
export const MAX_HISTORY_BATCH = 1000

/** Operações validadas pelo main; o lote inteiro vira um único nível (limite: `MAX_HISTORY_BATCH` operações).
 * IDs de itens novos são devolvidos por commit; referências no lote usam IDs já existentes.
 * Nunca envie snapshots, funções, processos ou estado da câmera.
 */
export type HistoryOperation =
  | { type: 'node.add'; node: NewNode }
  | { type: 'node.patch'; id: string; patch: NodePatch }
  | { type: 'node.remove'; id: string }
  /** Ponta: id existente ou `{ op: i }`, o nó criado pelo node.add de índice i, anterior no mesmo lote (colar leva as cordas). */
  | { type: 'connection.add'; a: string | { op: number }; b: string | { op: number } }
  | { type: 'connection.remove'; id: string }
  | { type: 'drawing.add'; drawing: Omit<Drawing, 'id'> }
  | { type: 'drawing.remove'; id: string }
  /** Estilo de um desenho existente (mantém o id); em lote, a seleção inteira vira um nível só. */
  | { type: 'drawing.patch'; id: string; patch: DrawingPatch }
  /** Grupo novo (ou ampliado) com estes elementos; `{ op: i }` vale como em connection.add. */
  | { type: 'group.create'; members: Array<string | { op: number }>; name?: string; color?: string }
  | { type: 'group.ungroup'; ids: string[] }
  | { type: 'stack.rename'; id: string; name: string | null }

export interface HistoryApi {
  /** Aviso passageiro após tentar usar uma pilha invalidada por alteração externa. */
  onNotice(cb: (message: string) => void): () => void
  /** Históricos em memória, até 50 níveis por workspace; false = pilha vazia.
   * Trocar de andar limpa a pilha; edição externa (CLI/agente) invalida snapshots.
   * Câmera/status e URL viva de portal não registram nem invalidam; undo de geometria
   * preserva a página atual. Portal apagado ainda recupera a URL capturada na exclusão.
   * Undo/redo só aceitam o workspace ativo; consultas canUndo/canRedo podem ler os demais.
   * Terminais restaurados respeitam autoStart e o andar visível; não persiste entre sessões.
   */
  undo(workspaceId: string): Promise<boolean>
  redo(workspaceId: string): Promise<boolean>
  canUndo(workspaceId: string): Promise<boolean>
  canRedo(workspaceId: string): Promise<boolean>
  /** Registra E aplica atomicamente no workspace ativo, sem begin/end entre IPCs.
   * Use uma chamada ao soltar o gesto, ou para apagar/mover uma seleção inteira.
   * Ex.: commit(ws.id, ids.map(id => ({ type: 'node.remove', id }))).
   * Falha reverte o documento; spawns novos são tentados antes de descartar PTYs antigos.
   * Falha de spawn limpa só as tentativas novas, preservando as sessões anteriores.
   * Mutadores node/connection/drawing existentes já registram um nível automaticamente:
   * não execute esses mutadores antes de commit (isso duplicaria a ação).
   */
  commit(workspaceId: string, operations: HistoryOperation[]): Promise<Array<string | Connection | undefined>>
}

/** API exposta pelo preload em window.palco. Canais IPC: "palco:<area>:<acao>". */
export interface PalcoApi {
  shutdown: { onBegin(cb: () => void): () => void; painted(): void }
  about: AboutApi
  stack: {
    /** Nome do fichário; `null` volta ao automático. */
    rename(stackId: string, name: string | null): Promise<void>
  }
  noteFile: {
    /** "Salvar no palco": solta o vínculo; o arquivo fica onde está. */
    unlink(id: string): Promise<void>
    /** "Mover para fora": abre o diálogo de salvar; `false` se o usuário desistiu. */
    moveOut(id: string): Promise<boolean>
  }
  group: {
    /** Devolve o id do grupo, ou `null` se não há dois elementos para agrupar. */
    create(ids: string[]): Promise<string | null>
    ungroup(ids: string[]): Promise<void>
    rename(id: string, name: string): Promise<void>
    color(id: string, color: string | null): Promise<void>
  }
  clipboard: ClipboardApi
  nodeState: NodeStateApi
  gitHosts: GitHostsApi
  dataSettings: DataSettingsApi
  accountSettings: AccountSettingsApi
  providers: ProvidersApi
  /** Saved prompt text for @Prompts; no expansion or execution occurs in this API. */
  prompts: PromptsApi
  roles: RoleLibraryApi
  skills: SkillsApi
  system: SystemApi
  /** Preferências globais: patches validados, gravação atômica antes do evento. */
  preferences: {
    get(): Promise<Preferences>
    set(patch: Partial<Omit<Preferences, 'shortcuts'>>): Promise<Preferences>
    onChange(cb: (value: Preferences) => void): () => void
    bind(id: ShortcutId, binding: KeyBinding | null): Promise<{ preferences: Preferences; conflicts: ShortcutId[] }>
    resetShortcuts(): Promise<Preferences>
  }
  history: HistoryApi
  /** Trilho de workspaces: terminais de um workspace e o número de avisos de cada um. */
  rail: { terminals(workspaceId: string): Promise<Array<{ id: string; name: string; agent: AgentKind }>>; attention(): Promise<Record<string, number>> }
  /** Quais programas dos ambientes (tmux, ssh, docker, sbx) existem no PATH. */
  environments: { status(): Promise<{ tmux: string | null; ssh: string | null; docker: string | null; sbx: string | null }> }
  /** Chat do terminal de agente (o agente responde pelo `palco say`). */
  chat: {
    state(terminalId: string, thread?: ThreadColor): Promise<ChatState>
    older(terminalId: string, thread: ThreadColor, beforeId: string): Promise<ChatEntry[]>
    send(terminalId: string, message: { text: string; attachments: string[] }): Promise<ChatSendResult>
    interrupt(terminalId: string): Promise<boolean>
    acknowledge(terminalId: string): Promise<void>
    markRead(terminalId: string): Promise<void>
    switchThread(terminalId: string, thread: ThreadColor): Promise<void>
    clearThread(terminalId: string, thread: ThreadColor): Promise<void>
    clearHistory(terminalId: string): Promise<void>
    deleteEntry(terminalId: string, thread: ThreadColor, entryId: string): Promise<void>
    /** Imagem do histórico como data URL; null se não for imagem. */
    attachment(terminalId: string, attachmentId: string): Promise<string | null>
    /** Últimas linhas do terminal durante um turno em andamento (texto vazio fora dele). */
    preview(terminalId: string): Promise<string>
    onChange(cb: (terminalId: string) => void): () => void
  }
  workspace: {
    get(): Promise<Workspace>
    onChange(cb: (ws: Workspace) => void): () => void
    setCamera(camera: Workspace['camera']): Promise<void>
    /** Guarda o elevado/encaixado do andar à vista (não entra no histórico). */
    setDock(state: DockState): Promise<void>
  }
  node: {
    /** Terminal avulso cujo primeiro spawn falha mantém o card e retorna seu id,
     * com aviso no banner para editar/reiniciar; commit de lote mantém rollback estrito. */
    add(node: NewNode): Promise<string>
    patch(id: string, patch: NodePatch): Promise<void>
    remove(id: string): Promise<void>
  }
  connection: {
    add(a: string, b: string): Promise<Connection>
    remove(id: string): Promise<void>
  }
  floor: {
    create(floor: NewFloor): Promise<Floor>
    /** Troca o floor exibido; `null` volta ao Ground. */
    switch(id: FloorId): Promise<void>
    land(id: string, opts?: { into?: string; deleteBranch?: boolean; keepFloor?: boolean }): Promise<LandResult>
    remove(id: string, opts?: { force?: boolean; keepBranch?: boolean }): Promise<void>
    setStatus(id: string, status: { state: FloorState; progress?: string } | null): Promise<void>
  }
  band: {
    create(name: string, members: string[]): Promise<string>
    add(bandId: string, terminalId: string): Promise<void>
    remove(bandId: string, terminalId: string): Promise<void>
    dissolve(bandId: string): Promise<void>
  }
  portal: {
    /** O renderer avisa o main qual webContents (do <webview>) pertence ao nó portal. */
    register(nodeId: string, webContentsId: number): void
  }
  /** Ditado local com whisper.cpp. O áudio vai só ao processo principal deste computador. */
  voice: {
    status(): Promise<VoiceStatus>
    /** Baixa (conferindo o hash) o programa e o modelo que faltarem. */
    install(model: ModelId): Promise<void>
    cancel(): Promise<void>
    remove(): Promise<void>
    /** Avisa que o usuário pediu o microfone: sem isto a permissão é negada. */
    arm(): Promise<void>
    transcribe(wav: ArrayBuffer): Promise<string>
    onProgress(cb: (progress: VoiceProgress) => void): () => void
  }
  routine: {
    list(): Promise<RoutineView[]>
    onChange(cb: (list: RoutineView[]) => void): () => void
    /** Cria ou altera; devolve o id. */
    save(input: RoutineInput): Promise<string>
    history(): Promise<RoutineRun[]>
    onHistory(cb: (list: RoutineRun[]) => void): () => void
    historyRemove(id: string): Promise<void>
    historyClear(): Promise<void>
    setEnabled(id: string, on: boolean): Promise<void>
    /** Dispara agora; devolve 'ok' ou 'pulado: <motivo>'. */
    runNow(id: string): Promise<string>
    remove(id: string): Promise<void>
  }
  workspaces: {
    sidebar(): Promise<Sidebar>
    onSidebar(cb: (s: Sidebar) => void): () => void
    create(name: string, spaceId?: string | null): Promise<string>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
    switch(id: string): Promise<void>
    /** `pageId`: leva o workspace solto para outro Espaço (padrão: o ativo). */
    move(id: string, spaceId: string | null, index: number, pageId?: string): Promise<void>
    /** Ícone (lucide ou emoji) e cor do glifo; `null` limpa. */
    setStyle(id: string, style: { icon?: string | null; color?: string | null }): Promise<void>
    /** PNG já encaixado em 128×128 pelo renderer; o main recusa link, não-PNG e mais de 4 MiB. */
    saveIcon(id: string, png: Uint8Array): Promise<void>
    loadIcon(id: string): Promise<string | null>
    deleteIcon(id: string): Promise<void>
    onIconChanged(cb: (id: string) => void): () => void
  }
  /** Espaços: páginas da barra lateral (rodapé). O inicial não se apaga. */
  pages: {
    create(input: { name: string; icon?: string; color?: string }): Promise<string>
    edit(id: string, patch: { name?: string; icon?: string; color?: string | null }): Promise<void>
    remove(id: string): Promise<void>
    switch(id: string): Promise<void>
  }
  spaces: {
    create(name: string): Promise<string>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
    toggle(id: string): Promise<void>
  }
  drawing: {
    add(d: Omit<Drawing, 'id'>): Promise<string>
    remove(id: string): Promise<void>
    patch(id: string, patch: DrawingPatch): Promise<void>
  }
  /** Cordas entre workspaces: o card mostra a outra ponta como `Nome @ Workspace`, clicável. */
  links?: {
    list(): Promise<CrossLinkView[]>
    /** Vai até o nó: troca de workspace e de andar e foca o terminal. */
    goTo(nodeId: string): Promise<void>
    /** Desfaz a corda entre workspaces (as duas pontas deixam de se enxergar). */
    remove?(linkId: string): Promise<void>
  }
  shell: {
    /** Abre no navegador do sistema; o main recusa o que não for http/https. */
    openExternal(url: string): Promise<void>
  }
  files: {
    read(path: string): Promise<{ kind: 'text' | 'image' | 'binary'; data: string; truncated: boolean }>
    list(dir: string): Promise<Array<{ name: string; dir: boolean }>>
    /** Seletor nativo; `null` se o usuário cancelar. */
    pick(kind: 'file' | 'dir'): Promise<string | null>
    /** A pasta existe? Aceita `~` e `~/…`. */
    exists(dir: string): Promise<boolean>
    /** Cria a pasta (e as intermediárias). Fora da pasta pessoal só com `outsideHome: true`, depois de confirmar. */
    mkdir(dir: string, opts?: { outsideHome?: boolean }): Promise<void>
    /** Árvore de pastas: manda para a lixeira do sistema / renomeia (devolve o novo caminho). Só dentro da pasta pessoal. */
    trash(path: string): Promise<void>
    rename(path: string, newName: string): Promise<string>
    /** Grava o que foi colado sem existir em disco numa pasta temporária do palco e devolve o caminho. */
    materialize(name: string, mime: string, data: ArrayBuffer): Promise<string>
    /** "Sempre copiar arquivos": copia para a pasta de anexos do palco e devolve o caminho da cópia. */
    storeAttachment(path: string): Promise<string>
    /** O que é o caminho solto na tela (pasta, arquivo e se é um texto pequeno que vira nota) e o texto da nota. */
    kindOf(path: string): Promise<{ kind: 'dir' | 'file'; note: boolean } | null>
    noteText(path: string): Promise<string | null>
    /** Caminho no disco de um arquivo solto (arrastar e soltar) na janela. */
    pathOf(file: File): string
  }
  accounts?: {
    list(): Promise<Account[]>
    add(account: { name: string; agent: Account['agent']; dir: string }): Promise<Account>
    remove(id: string): Promise<void>
  }
  usage: {
    get(): Promise<AgentUsage[]>
    setVisible?(visible: boolean, viewerId?: string): Promise<void>
    refresh?(accountId?: string): Promise<AgentUsage[]>
    onChange?(cb: (usage: AgentUsage[]) => void): () => void
  }
  partitura: {
    rename(name: string, next: string): Promise<void>
    export(name?: string): Promise<string>
    import(document: string): Promise<void>
    inspect(name: string): Promise<import('./partitura-review').PartituraReview>
    /** Confere o arquivo sem gravar. */
    reviewImport(document: string): Promise<import('./partitura-review').PartituraReview[]>
    updatePreview(name: string, opts: { noteText: boolean; nodeIds: string[] }): Promise<import('./partitura-review').PartituraUpdatePreview>
    list(): Promise<Array<Pick<Partitura, 'name' | 'description' | 'createdAt'>>>
    /** `nodeIds`: salva só estes nós (menu do botão direito); sem ele, o andar inteiro. */
    save(name: string, opts: { description?: string; noteText: boolean; nodeIds?: string[] }): Promise<void>
    /** Regrava uma partitura salva com estes nós. */
    update(name: string, opts: { noteText: boolean; nodeIds: string[] }): Promise<void>
    insert(name: string, opts: { commands: boolean; confirmed?: boolean }): Promise<void>
    remove(name: string): Promise<void>
  }
  presets: {
    list(): Promise<Preset[]>
    roles(): Promise<Role[]>
    /** Início Rápido: o máximo de ativos (10) e a ordem valem no main; erros chegam como rejeição. */
    create(preset: { name: string; command?: string; role?: string; account?: string; maestro?: boolean; quickStart?: boolean; startInChat?: boolean; appearance?: Preset['appearance'] }): Promise<Preset>
    set(name: string, patch: { newName?: string; command?: string; account?: string | null; maestro?: boolean; quickStart?: boolean; startInChat?: boolean; appearance?: Preset['appearance'] }): Promise<Preset>
    remove(name: string): Promise<void>
    reorder(names: string[]): Promise<void>
    restoreDefaults(): Promise<void>
    /** Volta à lista integrada: os presets personalizados são excluídos. */
    resetDefaults(): Promise<void>
    missingDefaults(): Promise<Preset[]>
  }
  terminal: {
    /** Snapshot serializado da tela + seq do último chunk incluído + geração do processo (muda a cada restart). */
    attach(id: string): Promise<{ data: string; seq: number; gen: number; cols?: number; rows?: number }>
    /** A tela deixou de mostrar o terminal: o main volta a responder às consultas do programa. */
    detach(id: string): void
    /** Quantos terminais usam hoje mais memória (MB) que o limite dado. */
    countAboveMemory(mb: number): Promise<number>
    /** `gen` identifica o processo que emitiu o chunk; `seq` recomeça em 1 a cada geração. */
    onData(cb: (id: string, data: string, seq: number, gen: number) => void): () => void
    onExit(cb: (id: string, code: number) => void): () => void
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    /** Encerra o processo (se roda) e sobe de novo com a configuração atual. */
    restart(id: string): Promise<void>
    /** Detecta uma função/alias do shell sem executá-la. */
    resolveAgent(command: string): Promise<AgentResolution>
    /** Editar terminal: grava comando e pasta (validados no main) e reinicia o processo. */
    /** `patch` (nome, ícone, cor, fonte, monitor) é validado junto e só gravado se tudo for válido. */
    reconfigure(id: string, config: TerminalConfig, patch?: NodePatch): Promise<void>
    /** O teclado entrou (id) ou saiu (null) de um terminal: o aviso de atividade dele fica calado enquanto focado. */
    setFocused(id: string | null): void
    /** Clique na notificação de atividade: focar este terminal. */
    onFocusRequest(cb: (id: string) => void): () => void
  }
}

declare global {
  interface Window {
    palco: PalcoApi
  }
}
