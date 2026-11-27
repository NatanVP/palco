import { t } from '../i18n'
/** Abas e sub-abas da janela de Configurações, agrupadas por área de uso. */
export const SETTINGS_TABS = [
  { id: 'general', get label() { return t('settings.catalog.geral') }, sections: ['Sistema', 'Tela', 'Notificações', 'Ambientes', 'Git'] },
  { id: 'terminal', get label() { return t('settings.catalog.terminal') }, sections: ['Início Rápido', 'Aparência', 'Avançado'] },
  { id: 'agents', get label() { return t('settings.catalog.agentes') }, sections: ['Responsabilidades', 'Prompts', 'Skills', 'Contas', 'Uso'] },
  { id: 'shortcuts', get label() { return t('settings.catalog.atalhos') }, sections: [] },
  { id: 'wire', get label() { return t('settings.catalog.wire') }, sections: ['Pareamento', 'Manual', 'Rede', 'Dispositivos', 'Perfil'] },
  { id: 'data', get label() { return t('settings.catalog.dados') }, sections: ['Armazenamento', 'Backups', 'Armazenamento dos Portais'] },
  { id: 'about', get label() { return t('settings.catalog.sobre') }, sections: [] }
] as const
export type TabId = (typeof SETTINGS_TABS)[number]['id']

/** Terceiro nível: Terminal › Aparência tem Terminal | Chat | Compositor de Prompts. */
export const APPEARANCE_FACES = ['Terminal', 'Chat', 'Compositor de Prompts'] as const
/** "Personalizar…" em Geral › Tela abre os Padrões de Novos Itens com estas abas. */
export const ITEM_FACES = ['Notas', 'Terminais', 'Portais', 'Editor de Arquivos'] as const

/** Mensagem de indisponibilidade exibida enquanto a opção não tem um consumidor ativo. */
export const soon = (what: string): string => t('settings.soon', { what })
