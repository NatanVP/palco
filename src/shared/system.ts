export type NoticeKind = 'turn' | 'attention' | 'floor' | 'pullRequest'
export interface SystemNotice {
  id: string
  kind: NoticeKind
  title: string
  body: string
  terminalId?: string
  workspaceId?: string
  floorId?: string | null
  timestamp: number
}
export type NoticeInput = Omit<SystemNotice, 'id' | 'timestamp'>
export interface SystemSnapshot { notices: SystemNotice[]; badgeTerminalIds: string[]; workingTerminalIds: string[] }
export interface SystemApi {
  snapshot(): Promise<SystemSnapshot>
  onChange(cb: (state: SystemSnapshot) => void): () => void
  nextAttention(): Promise<SystemNotice | null>
  focus(id: string): Promise<void>
  dismiss(id: string): Promise<void>
}
export const SYSTEM_CH = { snapshot: 'palco:system:snapshot', changed: 'palco:system:changed', next: 'palco:system:nextAttention', focus: 'palco:system:focus', dismiss: 'palco:system:dismiss' } as const
