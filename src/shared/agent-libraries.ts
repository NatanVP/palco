export interface SavedPromptMeta { id: string; name: string; description: string; workspaceId: string | null }
export interface SavedPrompt extends SavedPromptMeta { body: string }
export interface PromptDraft { id?: string; name: string; description?: string; workspaceId: string | null; body: string }
/** Stable IDs are folder names, never paths. list(workspaceId) returns global + that workspace; omitted = all.
 * read(id) returns unexpanded text for @Prompts: the compositor owns inserting it and resolving mentions.
 * Both calls read disk afresh; malformed files are isolated in `problems`, never silently overwritten.
 */
export interface PromptsApi {
 list(workspaceId?: string): Promise<{ items: SavedPromptMeta[]; problems: Array<{ id: string; reason: string }> }>
 read(id: string): Promise<SavedPrompt>
 save(draft: PromptDraft): Promise<SavedPrompt>
 remove(id: string): Promise<string>
 undo(token: string): Promise<SavedPrompt>
 /** Abre a pasta do escopo (sem argumento ou null: a raiz, os globais). */
 showFolder(workspaceId?: string | null): Promise<void>
 /** A pasta do escopo no disco (null = global), criada se preciso: é o que "Copiar Caminho" copia. */
 directory(workspaceId: string | null): Promise<string>
}
export interface RoleEntry { name: string; displayName: string; text: string; workspaceId: string | null; icon?: string; color?: string; terminalCount: number }
export interface RoleDraft { id?: string; name: string; text: string; workspaceId: string | null; icon?: string; color?: string }
export interface RoleCandidate { name: string; text: string; icon?: string; color?: string }
export interface RoleLibraryApi {
 list(): Promise<RoleEntry[]>
 save(draft: RoleDraft): Promise<RoleEntry>
 remove(names: string[]): Promise<void>
 discover(workspaceId: string): Promise<RoleCandidate[]>
 import(candidates: RoleCandidate[], workspaceId: string): Promise<void>
}
/** `display` (o caminho com `~`), `conflicts` (skills não instaladas: há algo que não é do palco no lugar) e `unavailable` (caminho recusado) vêm do `list()` e não são gravados. */
export interface SkillBase { id: string; name: string; path: string; display?: string; conflicts?: string[]; unavailable?: boolean; enabled: boolean; icon?: string; builtin?: 'claude' | 'codex' }
export interface SkillDraft { id?: string; name: string; path: string; enabled: boolean; icon?: string }
export interface SkillsApi { list(): Promise<SkillBase[]>; save(draft: SkillDraft): Promise<SkillBase>; remove(id: string): Promise<void>; reorder(ids: string[]): Promise<void>; reset(): Promise<void> }
export const LIBRARY_CH = {
 promptList: 'palco:prompts:list', promptRead: 'palco:prompts:read', promptSave: 'palco:prompts:save', promptRemove: 'palco:prompts:remove', promptUndo: 'palco:prompts:undo', promptFolder: 'palco:prompts:folder', promptDirectory: 'palco:prompts:directory',
 roleList: 'palco:roles:list', roleSave: 'palco:roles:save', roleRemove: 'palco:roles:remove', roleDiscover: 'palco:roles:discover', roleImport: 'palco:roles:import',
 skillList: 'palco:skills:list', skillSave: 'palco:skills:save', skillRemove: 'palco:skills:remove', skillReorder: 'palco:skills:reorder', skillReset: 'palco:skills:reset'
} as const
