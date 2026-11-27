export interface ProviderSpec {
 schemaVersion: number; revision?: number; id: string; name: string; agent: 'claude' | 'codex' | 'antigravity'; command: string
 configEnv: string; loginArgs: string[]; logoutArgs: string[]; statusArgs: string[]
 apiKeyEnv: string; endpointEnv?: string; defaultEndpoint?: string
 usage: 'claude' | 'codex' | 'antigravity' | 'json'; usageArgs?: string[]; color: string
}
export interface ProviderView { id: string; name: string; state: 'bundled' | 'modified' | 'outOfDate' | 'custom' | 'requiresNewVersion' | 'invalid'; enabled: boolean; color: string; problem?: string; spec?: ProviderSpec; executablePath?: string | null; missing?: boolean }
export type ProviderArea = 'accounts' | 'usage'
export interface ProvidersApi { restoreOne(area: ProviderArea, id: string): Promise<void>; path(area: ProviderArea): Promise<string>; list(area: ProviderArea): Promise<ProviderView[]>; configure(area: ProviderArea, id: string, patch: { enabled?: boolean; color?: string }): Promise<void>; restore(area: ProviderArea, all: boolean): Promise<void>; showFolder(area: ProviderArea): Promise<void>; reload(area: ProviderArea): Promise<void> }
