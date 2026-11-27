import type { AgentKind } from './model'

/** O que uma partitura faria ao ser inserida: mostrado antes de aceitar um arquivo e antes de iniciar uma importada. */
export interface PartituraReview {
  name: string
  /** Veio de arquivo e os comandos ainda não foram confirmados. */
  imported: boolean
  /** `environmentUser`: só em Docker e Sandbox; vazio = o usuário padrão do ambiente. */
  terminals: Array<{ name: string; agent: AgentKind; command: string; cwd: string; environment: string; environmentUser?: string; maestro: boolean; role?: string }>
  portals: string[]
  /** Arquivos e pastas do disco que a montagem abre. */
  paths: string[]
}
export interface PartituraItem { kind: string; name: string }
/** O que "Atualizar com a seleção" vai fazer com a partitura guardada. */
export interface PartituraUpdatePreview {
  name: string
  before: number
  after: number
  connections: [number, number]
  removed: PartituraItem[]
  added: PartituraItem[]
  changed: PartituraItem[]
}
