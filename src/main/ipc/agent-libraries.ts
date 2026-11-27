import { shell } from 'electron'
import type { IpcArea } from './area'
import { LIBRARY_CH as CH, type PromptDraft, type RoleDraft, type RoleCandidate, type SkillDraft } from '../../shared/agent-libraries'
import type { PromptStore } from '../prompts/prompt-store'
import type { RoleLibrary } from '../agents/role-library'
import type { SkillBases } from '../skill-bases'
interface Libraries { prompts: PromptStore; roles: RoleLibrary; skills: SkillBases; root(workspaceId: string): string; hasWorkspace(id: string): boolean }
const services = new WeakMap<object, Libraries>()
export function attachLibraries(registry: object, value: Libraries): () => void { services.set(registry, value); return () => { services.delete(registry) } }
const id = (v: unknown): string => { if (typeof v !== 'string' || !v || v.length > 400) throw new Error('Identificador inválido.'); return v }
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Entrada inválida.'); return v as Record<string, unknown> }
/** Authenticated IPC is provided by the area wrapper; store validation also protects CLI and direct callers. */
export const agentLibrariesArea: IpcArea = ({ handle, deps }) => {
 const service = (): Libraries => { const s = services.get(deps.registry); if (!s) throw new Error('Bibliotecas indisponíveis.'); return s }
 const scope = (v: unknown): void => { if (v !== null && (typeof v !== 'string' || !service().hasWorkspace(v))) throw new Error('Espaço de trabalho não encontrado.') }
 handle(CH.promptList, workspace => { if (workspace !== undefined) id(workspace); return service().prompts.list(workspace as string | undefined) })
 handle(CH.promptRead, value => service().prompts.read(id(value)))
 handle(CH.promptSave, value => { const d = object(value); scope(d.workspaceId); return service().prompts.save(d as unknown as PromptDraft) })
 handle(CH.promptRemove, value => service().prompts.remove(id(value)))
 handle(CH.promptUndo, value => service().prompts.undo(id(value)))
 handle(CH.promptDirectory, value => { scope(value); return service().prompts.directory(value as string | null) })
 handle(CH.promptFolder, async value => { const workspace = value ?? null; scope(workspace); const dir = service().prompts.directory(workspace as string | null); const error = await shell.openPath(dir); if (error) throw new Error('Não foi possível abrir a pasta de prompts.') })
 handle(CH.roleList, () => service().roles.list())
 handle(CH.roleSave, value => { const d = object(value); scope(d.workspaceId); return service().roles.save(d as unknown as RoleDraft) })
 handle(CH.roleRemove, names => { if (!Array.isArray(names)) throw new Error('Seleção inválida.'); service().roles.remove(names) })
 handle(CH.roleDiscover, value => service().roles.discover(service().root(id(value))))
 handle(CH.roleImport, (candidates, workspace) => { id(workspace); scope(workspace); if (!Array.isArray(candidates)) throw new Error('Seleção inválida.'); service().roles.import(candidates as RoleCandidate[], workspace as string) })
 handle(CH.skillList, () => service().skills.list())
 handle(CH.skillSave, value => service().skills.save(object(value) as unknown as SkillDraft))
 handle(CH.skillReset, () => service().skills.reset())
 handle(CH.skillRemove, value => service().skills.remove(id(value)))
 handle(CH.skillReorder, values => { if (!Array.isArray(values)) throw new Error('Ordem inválida.'); service().skills.reorder(values) })
}
