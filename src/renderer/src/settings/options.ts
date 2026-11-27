import { AVAILABLE_LOCALES, LOCALE_NAMES } from '../../../shared/i18n'
import { NOTE_COLORS, type PreferenceKey } from '../../../shared/preferences'
import { soon, type TabId } from './catalog'
import { t, tr } from '../i18n'

/**
 * Inventário das opções de Configurações e dos consumidores que aplicam seus efeitos.
 *
 * Cada definição descreve o controle e sua disponibilidade. `ready` habilita a opção;
 * `pending` explica a indisponibilidade. Ações sem preferência ficam em `ACTIONS`;
 * telas específicas ficam em `tabs/`.
 */
export type Control =
  | { kind: 'switch' }
  | { kind: 'select'; options: ReadonlyArray<{ value: string | number; label: string; pending?: string }> }
  | { kind: 'number'; min: number; max: number; step?: number; unit?: string; nullable?: boolean; /** Valor ao ligar um campo opcional. */ fallback?: number }
  | { kind: 'text'; placeholder?: string; nullable?: boolean }
  | { kind: 'size' }
  /** Tema do terminal: os quatro cartões (Sistema, Escuro, Claro, Personalizado) e o modal de tema. */
  | { kind: 'theme' }
export interface OptionDef {
  key: PreferenceKey
  tab: TabId
  section: string
  /** Terceiro nível (Terminal › Aparência: Terminal/Chat/Compositor de Prompts; Tela › padrões: Notas/Terminais/Portais/Editor). */
  face?: string
  label: string
  hint?: string
  control: Control
  ready: boolean
  pending?: string
  /** Título da seção em que a linha aparece. */
  group?: string
  /** Explicação atrás do ícone (i), onde o palco tem o ícone no lugar da descrição. */
  info?: string
}
export interface ActionDef { tab: TabId; section: string; face?: string; label: string; hint?: string; ready: boolean; pending?: string; group?: string }

const opt = (o: OptionDef): OptionDef => o
const sw: Control = { kind: 'switch' }
const sel = (options: Array<[string | number, string]>): Control => ({ kind: 'select', options: options.map(([value, label]) => ({ value, get label() { return tr(label) } })) })
const NOTE_COLOR_NAMES: Record<(typeof NOTE_COLORS)[number], string> = { get yellow() { return t('settings.options.amarelo') }, get pink() { return t('settings.options.rosa') }, get blue() { return t('settings.options.azul') }, get green() { return t('settings.options.verde') }, get orange() { return t('settings.options.laranja') }, get purple() { return t('settings.options.roxo') }, get white() { return t('settings.options.branco') }, get charcoal() { return t('settings.options.carvao') }, get slate() { return t('settings.options.ardosia') }, get midnight() { return t('settings.options.meia_noite') } }
const PLACEMENT: Control = sel([['stack', 'Empilhar'], ['freeSpace', 'Espaço Livre']])

const TELA = () => soon(tr('Tela e Padrões de Novos Itens')), TERM = () => soon(tr('Terminal: Início Rápido, Aparência e Avançado'))
const AMB = () => soon(tr('Git e tmux'))

const RAW: readonly OptionDef[] = [
  // Geral › Sistema
  opt({ key: 'appLanguage', tab: 'general', section: 'Sistema', get label() { return t('i18n.language') }, control: { kind: 'select', options: [{ value: '', get label() { return t('i18n.languageSystem') } }, ...AVAILABLE_LOCALES.map(l => ({ value: l, label: LOCALE_NAMES[l] }))] }, ready: true }),
  opt({ key: 'appearance', tab: 'general', section: 'Sistema', get label() { return t('settings.options.aparencia') }, control: sel([['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']]), ready: true }),
  opt({ key: 'pointerCursors', tab: 'general', section: 'Sistema', get label() { return t('settings.options.cursor_de_mao_ao_passar_o_mous') }, control: sw, ready: true }),
  opt({ key: 'sleepPrevention', tab: 'general', section: 'Sistema', get label() { return t('settings.options.impedir_a_suspensao') }, control: sel([['never', 'Nunca'], ['whileAgentsWork', 'Enquanto os agentes trabalham'], ['whileAppIsOpen', 'Enquanto o palco estiver aberto']]), ready: true }),
  opt({ key: 'confirmBeforeQuitting', tab: 'general', section: 'Sistema', get label() { return t('settings.options.solicitar_confirmacao_ao_encer') }, control: sw, ready: true }),
  opt({ key: 'resumeSessionsOnRelaunch', tab: 'general', section: 'Sistema', get label() { return t('settings.options.tentar_restaurar_as_sessoes_do') }, get hint() { return t('settings.options.melhor_esforco_nao_revive_um_p') }, control: sw, ready: true }),
  opt({ key: 'closeToTray', tab: 'general', section: 'Sistema', get label() { return t('settings.options.fechar_para_a_bandeja') }, control: sw, ready: true }),
  // Geral › Tela
  opt({ key: 'canvasBackground', tab: 'general', section: 'Tela', get label() { return t('settings.options.fundo') }, control: { kind: 'select', options: [{ value: 'grid', get label() { return t('settings.options.grade') } }, { value: 'plain', get label() { return t('settings.options.liso') } }, { value: 'transparent', get label() { return t('settings.options.transparente') }, get pending() { return TELA() } }] }, ready: true }),
  opt({ key: 'windowOpacity', tab: 'general', section: 'Tela', get label() { return t('settings.options.opacidade_da_janela') }, get hint() { return t('settings.options.vale_no_proximo_lancamento') }, control: sel([[100, '100%'], [95, '95%'], [90, '90%'], [85, '85%'], [80, '80%'], [70, '70%'], [60, '60%']]), ready: true }),
  opt({ key: 'ropeRouting', tab: 'general', section: 'Tela', get label() { return t('settings.options.estilo_das_conexoes') }, control: sel([['avoidNodes', 'Ao Redor dos Nós'], ['behindNodes', 'Atrás dos Nós'], ['circuit', 'Circuito']]), ready: true }),
  opt({ key: 'selectionIndicatorStyle', tab: 'general', section: 'Tela', get label() { return t('settings.options.estilo_de_selecao') }, control: sel([['dashedBorder', 'Borda Tracejada'], ['solidBorder', 'Borda Sólida'], ['corners', 'Cantos'], ['cornerDots', 'Pontos nos Cantos'], ['elevation', 'Elevação']]), ready: true }),
  opt({ key: 'cameraMovement', tab: 'general', section: 'Tela', get label() { return t('settings.options.movimento_da_camera') }, control: sel([['glide', 'Deslizar'], ['instant', 'Instantâneo']]), ready: true }),
  opt({ key: 'focusNodeOnHover', tab: 'general', section: 'Tela', get label() { return t('settings.options.focar_ao_passar_o_cursor') }, control: sw, ready: true }),
  opt({ key: 'rightDragPansCanvas', tab: 'general', section: 'Tela', get label() { return t('settings.options.arrastar_com_o_botao_direito_p') }, control: sw, ready: true }),
  opt({ key: 'confirmFileDelete', tab: 'general', section: 'Tela', get label() { return t('settings.options.confirmar_antes_de_excluir_arq') }, control: sw, ready: true }),
  opt({ key: 'zoomStepPercent', tab: 'general', section: 'Tela', get label() { return t('settings.options.passo_de_zoom_personalizado') }, get hint() { return t('settings.options.desligado_usa_o_passo_padrao_l') }, control: { kind: 'number', min: 2, max: 50, unit: '%', nullable: true, fallback: 10 }, ready: true }),
  opt({ key: 'alwaysCopyAttachments', tab: 'general', section: 'Tela', get label() { return t('settings.options.sempre_copiar_arquivos_para_o_') }, control: sw, ready: true }),
  // Geral › Tela › Padrões de Novos Itens (Personalizar…)
  opt({ key: 'defaultNoteColor', tab: 'general', section: 'Tela', face: 'Notas', get label() { return t('settings.options.cor') }, control: sel(NOTE_COLORS.map(c => [c, NOTE_COLOR_NAMES[c]] as [string, string])), ready: true }),
  opt({ key: 'defaultNoteRender', tab: 'general', section: 'Tela', face: 'Notas', get label() { return t('settings.options.renderizar_como') }, control: sel([['markdown', 'Markdown'], ['raw', 'Texto Bruto']]), ready: true }),
  opt({ key: 'defaultNoteSize', tab: 'general', section: 'Tela', face: 'Notas', get label() { return t('settings.options.tamanho_largura_altura') }, control: { kind: 'size' }, ready: true }),
  opt({ key: 'agentNotePlacement', tab: 'general', section: 'Tela', face: 'Notas', get label() { return t('settings.options.quando_um_agente_adiciona_outr') }, control: PLACEMENT, ready: true }),
  opt({ key: 'defaultNoteFontFamily', tab: 'general', section: 'Tela', face: 'Notas', get label() { return t('settings.options.fonte') }, control: { kind: 'select', options: [{ value: '', get label() { return t('settings.options.padrao') } }, { value: 'mono', get label() { return t('settings.options.mono') } }, { value: 'sans', get label() { return t('settings.options.sans') } }, { value: 'serif', get label() { return t('settings.options.serif') } }] }, ready: true }),
  opt({ key: 'defaultNoteFontSize', tab: 'general', section: 'Tela', face: 'Notas', get label() { return t('settings.options.tamanho_da_fonte') }, control: { kind: 'number', min: 8, max: 64, unit: 'pt' }, ready: true }),
  opt({ key: 'defaultTerminalSize', tab: 'general', section: 'Tela', face: 'Terminais', get label() { return t('settings.options.tamanho_largura_altura') }, control: { kind: 'size' }, ready: true }),
  opt({ key: 'defaultPortalSize', tab: 'general', section: 'Tela', face: 'Portais', get label() { return t('settings.options.tamanho_largura_altura') }, control: { kind: 'size' }, ready: true }),
  opt({ key: 'agentPortalPlacement', tab: 'general', section: 'Tela', face: 'Portais', get label() { return t('settings.options.quando_um_agente_adiciona_outr') }, control: PLACEMENT, ready: true }),
  opt({ key: 'fileEditorFontFamily', tab: 'general', section: 'Tela', face: 'Editor de Arquivos', get label() { return t('settings.options.familia_da_fonte') }, control: { kind: 'text' }, ready: true }),
  opt({ key: 'fileEditorFontSize', tab: 'general', section: 'Tela', face: 'Editor de Arquivos', get label() { return t('settings.options.tamanho') }, control: { kind: 'number', min: 8, max: 32, unit: 'pt' }, ready: true }),
  opt({ key: 'fileEditorTabWidth', tab: 'general', section: 'Tela', face: 'Editor de Arquivos', get label() { return t('settings.options.tamanho_da_tabulacao') }, control: sel([[2, '2'], [4, '4'], [8, '8']]), ready: true }),
  opt({ key: 'fileEditorRendersMarkdown', tab: 'general', section: 'Tela', face: 'Editor de Arquivos', get label() { return t('settings.options.renderizar_markdown') }, control: sw, ready: true }),
  // Geral › Notificações
  opt({ key: 'completionBadges', tab: 'general', section: 'Notificações', get label() { return t('settings.options.mostrar_selos_de_conclusao_de') }, control: sel([['all', 'Todos os terminais'], ['maestros', 'Apenas Maestros']]), ready: true }),
  opt({ key: 'showAppIconBadge', tab: 'general', section: 'Notificações', get label() { return t('settings.options.exibir_a_contagem_de_avisos_no') }, control: sw, ready: true }),
  opt({ key: 'flashTaskbarOnAttention', tab: 'general', section: 'Notificações', get label() { return t('settings.options.piscar_o_botao_da_barra_de_tar') }, control: sw, ready: true }),
  opt({ key: 'notifyOnTurnComplete', tab: 'general', section: 'Notificações', get label() { return t('settings.options.notificar_quando_um_agente_con') }, control: sw, ready: true }),
  opt({ key: 'notifyOnAttention', tab: 'general', section: 'Notificações', get label() { return t('settings.options.notificar_quando_um_agente_ped') }, control: sw, ready: true }),
  opt({ key: 'notifyOnFloorStatus', tab: 'general', section: 'Notificações', get label() { return t('settings.options.notificar_quando_um_andar_prec') }, control: sw, ready: true }),
  opt({ key: 'notifyOnPullRequests', tab: 'general', section: 'Notificações', get label() { return t('settings.options.notificar_quando_um_pull_reque') }, control: sw, ready: true }),
  // Geral › Ambientes
  opt({ key: 'wslEnabled', tab: 'general', section: 'Ambientes', get label() { return t('settings.options.wsl') }, get hint() { return t('settings.options.so_windows') }, control: sw, ready: false, get pending() { return t('settings.options.wsl_so_existe_no_windows_o_pal') } }),
  opt({ key: 'sshEnabled', tab: 'general', section: 'Ambientes', get label() { return t('settings.options.espacos_de_trabalho_ssh') }, control: sw, ready: true }),
  opt({ key: 'sshScriptPath', tab: 'general', section: 'Ambientes', get label() { return t('settings.options.caminho_do_script') }, control: { kind: 'text' }, ready: true }),
  opt({ key: 'sshAddToPath', tab: 'general', section: 'Ambientes', get label() { return t('settings.options.adicionar_palco_ao_path_em_hos') }, control: sw, ready: true }),
  opt({ key: 'dockerEnabled', tab: 'general', section: 'Ambientes', get label() { return t('settings.options.conteiner_docker') }, control: sw, ready: true }),
  opt({ key: 'sandboxEnabled', tab: 'general', section: 'Ambientes', get label() { return t('settings.options.docker_sandbox') }, control: sw, ready: true }),
  opt({ key: 'localTmuxEnabled', tab: 'general', section: 'Ambientes', get label() { return t('settings.options.tmux_local') }, get hint() { return t('settings.options.hospeda_os_terminais_locais_em') }, control: sw, ready: true }),
  opt({ key: 'tunnelPort', tab: 'general', section: 'Ambientes', get label() { return t('settings.options.porta_do_tunel') }, control: { kind: 'number', min: 1024, max: 65535 }, ready: true }),
  // Terminal › Aparência › Terminal
  opt({ key: 'defaultTerminalTheme', tab: 'terminal', section: 'Aparência', face: 'Terminal', get label() { return t('settings.options.tema') }, control: { kind: 'theme' }, ready: true }),
  opt({ key: 'terminalFontFamily', tab: 'terminal', section: 'Aparência', face: 'Terminal', get label() { return t('settings.options.familia_da_fonte') }, control: { kind: 'text' }, ready: true }),
  opt({ key: 'terminalFontSize', tab: 'terminal', section: 'Aparência', face: 'Terminal', get label() { return t('settings.options.tamanho_da_fonte') }, control: { kind: 'number', min: 8, max: 32, unit: 'pt' }, ready: true }),
  opt({ key: 'terminalPaddingHorizontal', tab: 'terminal', section: 'Aparência', face: 'Terminal', get label() { return t('settings.options.espacamento_horizontal') }, control: { kind: 'number', min: 0, max: 40, step: 2, unit: 'px' }, ready: true }),
  opt({ key: 'terminalPaddingVertical', tab: 'terminal', section: 'Aparência', face: 'Terminal', get label() { return t('settings.options.espacamento_vertical') }, control: { kind: 'number', min: 0, max: 40, step: 2, unit: 'px' }, ready: true }),
  opt({ key: 'terminalCursorBlink', tab: 'terminal', section: 'Aparência', face: 'Terminal', get label() { return t('settings.options.piscar_cursor_do_terminal') }, get hint() { return t('settings.options.extra_do_palco') }, control: sw, ready: true }),
  // Terminal › Aparência › Chat
  opt({ key: 'chatFontFamily', tab: 'terminal', section: 'Aparência', face: 'Chat', get label() { return t('settings.options.familia_da_fonte') }, get hint() { return t('settings.options.vazio_usa_a_fonte_do_sistema') }, control: { kind: 'text', get placeholder() { return t('settings.options.sistema') } }, ready: true }),
  opt({ key: 'chatFontSize', tab: 'terminal', section: 'Aparência', face: 'Chat', get label() { return t('settings.options.tamanho_da_fonte') }, control: { kind: 'number', min: 8, max: 32, unit: 'pt' }, ready: true }),
  // Terminal › Aparência › Compositor de Prompts
  opt({ key: 'promptComposerFontSize', tab: 'terminal', section: 'Aparência', face: 'Compositor de Prompts', get label() { return t('settings.options.tamanho_da_fonte') }, control: { kind: 'number', min: 10, max: 28, unit: 'pt', nullable: true, fallback: 13 }, ready: true }),
  // Terminal › Avançado
  opt({ key: 'preferredShellPath', tab: 'terminal', section: 'Avançado', get label() { return t('settings.options.shell') }, get hint() { return t('settings.options.qual_shell_os_novos_terminais_') }, control: { kind: 'text', get placeholder() { return t('settings.options.shell_de_login') }, nullable: true }, ready: false, get pending() { return t('settings.options.so_vale_no_windows_no_linux_os') } }),
  opt({ key: 'memoryLimitEnabled', tab: 'terminal', section: 'Avançado', get label() { return t('settings.options.limite_de_memoria_por_terminal') }, get hint() { return t('settings.options.encerra_os_processos_filhos_qu') }, control: sw, ready: true }),
  opt({ key: 'memoryLimitMB', tab: 'terminal', section: 'Avançado', get label() { return t('settings.options.limite_mb') }, control: { kind: 'number', min: 256, max: 65536, unit: 'MB' }, ready: true }),
  opt({ key: 'copyOnSelect', tab: 'terminal', section: 'Avançado', get label() { return t('settings.options.copiar_texto_ao_selecionar') }, control: sw, ready: true }),
  opt({ key: 'terminalScrollback', tab: 'terminal', section: 'Avançado', get label() { return t('settings.options.linhas_de_scrollback') }, get hint() { return t('settings.options.extra_do_palco') }, control: { kind: 'number', min: 100, max: 100000 }, ready: true }),
  // Agentes
  opt({ key: 'usageEnabled', tab: 'agents', section: 'Uso', get label() { return t('settings.options.ativar_uso_dos_agentes') }, control: sw, ready: true }),
  // Dados
  opt({ key: 'defaultPortalStorage', tab: 'data', section: 'Armazenamento dos Portais', get label() { return t('settings.options.escopo_padrao') }, get hint() { return t('settings.options.vale_para_os_novos_portais_os_') }, control: sel([['isolated', 'Isolado'], ['workspace', 'Espaço de Trabalho'], ['global', 'Global']]), ready: true })
]

/**
 * Seção de cada linha e o texto que a acompanha: `hint` fica embaixo da opção, `info` atrás do ícone (i). Os textos são do palco
 * (chaves `settings.hints.*` e `settings.groups.*`); opção sem entrada de texto fica só com o rótulo.
 */
type Group = 'language' | 'appearance' | 'energy' | 'exit' | 'navigation' | 'attachments' | 'badges' | 'systemNotifications' | 'environments' | 'theme' | 'font' | 'padding' | 'cursor' | 'session' | 'performance' | 'input' | 'computerUse' | 'usage' | 'portalStorage'
const LAYOUT: Partial<Record<PreferenceKey, [Group, ('hint' | 'info')?]>> = {
  appLanguage: ['language'], appearance: ['appearance', 'hint'], pointerCursors: ['appearance', 'hint'], sleepPrevention: ['energy', 'hint'],
  confirmBeforeQuitting: ['exit', 'hint'], resumeSessionsOnRelaunch: ['exit', 'info'], closeToTray: ['exit', 'hint'],
  canvasBackground: ['appearance'], windowOpacity: ['appearance', 'hint'], ropeRouting: ['appearance'], selectionIndicatorStyle: ['appearance'],
  cameraMovement: ['navigation', 'info'], focusNodeOnHover: ['navigation', 'info'], rightDragPansCanvas: ['navigation', 'info'], confirmFileDelete: ['navigation', 'hint'], zoomStepPercent: ['navigation', 'hint'],
  alwaysCopyAttachments: ['attachments', 'info'],
  completionBadges: ['badges', 'hint'], showAppIconBadge: ['badges', 'hint'], flashTaskbarOnAttention: ['badges', 'hint'],
  notifyOnTurnComplete: ['systemNotifications'], notifyOnAttention: ['systemNotifications'], notifyOnFloorStatus: ['systemNotifications', 'hint'], notifyOnPullRequests: ['systemNotifications', 'hint'],
  wslEnabled: ['environments', 'hint'], sshEnabled: ['environments', 'hint'], sshScriptPath: ['environments', 'hint'], sshAddToPath: ['environments'], dockerEnabled: ['environments', 'hint'], sandboxEnabled: ['environments', 'hint'], localTmuxEnabled: ['environments', 'hint'], tunnelPort: ['environments', 'hint'],
  defaultTerminalTheme: ['theme'], terminalFontFamily: ['font'], terminalFontSize: ['font'], terminalPaddingHorizontal: ['padding'], terminalPaddingVertical: ['padding'], terminalCursorBlink: ['cursor', 'hint'],
  chatFontFamily: ['font', 'hint'], chatFontSize: ['font'], promptComposerFontSize: ['font'],
  preferredShellPath: ['session', 'hint'], memoryLimitEnabled: ['performance', 'hint'], memoryLimitMB: ['performance'], terminalScrollback: ['performance', 'hint'], copyOnSelect: ['input'],
  usageEnabled: ['usage'], computerUseEnabled: ['computerUse', 'hint'], computerUseBypassPermissions: ['computerUse'], defaultPortalStorage: ['portalStorage', 'hint']
}
const getter = (o: object, key: string, read: () => string | undefined): void => { Object.defineProperty(o, key, { get: read, enumerable: true, configurable: true }) }
export const OPTIONS: readonly OptionDef[] = RAW.map(o => {
  const layout = LAYOUT[o.key]
  // Os padrões de novos itens (com `face` em Geral) são uma folha sem seções.
  if (!layout || (o.tab === 'general' && o.face)) return o
  const [group, text] = layout
  getter(o, 'group', () => t(`settings.groups.${group}`))
  if (text) {
    const key = `settings.hints.${o.key}` as Parameters<typeof t>[0]
    // Texto que já existia na opção (dicas do palco) continua valendo.
    const own = Object.getOwnPropertyDescriptor(o, 'hint')
    if (text === 'info') { getter(o, 'info', () => t(key)); getter(o, 'hint', () => undefined) } else if (!own) getter(o, 'hint', () => t(key))
  }
  return o
})

const act = (tab: TabId, section: string, label: string, pending: string | (() => string) | undefined, extra: Partial<ActionDef> = {}): ActionDef =>
  ({ tab, section, get label() { return tr(label) }, ready: !pending, ...(pending ? { get pending() { const p = typeof pending === 'function' ? pending() : pending; return tr(p) } } : {}), ...extra })
export const ACTIONS: readonly ActionDef[] = [
  // Geral › Git
  ...['Verificar', 'Restaurar Padrão…', 'Mostrar Pasta de Provedores', 'Restaurar Provedores Integrados', 'Recarregar'].map(l => act('general', 'Git', l, undefined)),
  // Agentes
  ...['Nova Responsabilidade'].map(l => act('agents', 'Responsabilidades', l, undefined)),
  act('agents', 'Prompts', 'Novo prompt', undefined), act('agents', 'Prompts', 'Mostrar pasta de prompts', undefined),
  act('agents', 'Skills', 'Adicionar Caminho Personalizado', undefined),
  act('agents', 'Uso', 'Atualizar Tudo', undefined), act('agents', 'Uso', 'Mostrar Pasta de Provedores', undefined), act('agents', 'Uso', 'Restaurar Provedores Integrados', undefined),
  // Dados
  ...['Alterar…', 'Mostrar na Pasta', 'Apagar Todos os Dados…'].map(l => act('data', 'Armazenamento', l, undefined)),
  ...['Gerenciar Backups…', 'Exportar Backup Completo…', 'Importar Backup…'].map(l => act('data', 'Backups', l, undefined)),
  act('data', 'Armazenamento dos Portais', 'Apagar Armazenamento Global…', undefined),
  // Wire (fora do escopo): só mostra
  ...['Habilitar Wire', 'Código de pareamento'].map(l => act('wire', 'Pareamento', l, 'Acesso remoto ainda indisponível.')),
  ...['Habilitar acesso manual', 'Senha'].map(l => act('wire', 'Manual', l, 'Acesso remoto ainda indisponível.')),
  ...['Endereços de rede', 'Porta', 'Somente tailnet'].map(l => act('wire', 'Rede', l, 'Acesso remoto ainda indisponível.')),
  ...['Computadores conectados', 'Revogar acesso'].map(l => act('wire', 'Dispositivos', l, 'Acesso remoto ainda indisponível.')),
  ...['Foto', 'Nome do usuário', 'Nome do computador'].map(l => act('wire', 'Perfil', l, 'Acesso remoto ainda indisponível.'))
]
for (const a of ACTIONS) if (a.tab === 'wire') getter(a, 'group', () => t('settings.groups.wire'))
export const optionsOf = (tab: TabId, section: string, face?: string): OptionDef[] => OPTIONS.filter(o => o.tab === tab && o.section === section && (o.face ?? undefined) === face)
export const actionsOf = (tab: TabId, section: string, face?: string): ActionDef[] => ACTIONS.filter(a => a.tab === tab && a.section === section && (a.face ?? undefined) === face)
