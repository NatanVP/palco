import type { CanvasNode } from '../../../shared/model'
import { t } from '../i18n'

export type MentionSection = 'terminals' | 'notes' | 'portals' | 'floors' | 'workspaces' | 'actions' | 'files' | 'prompts'
export interface MentionItem { section: MentionSection; id: string; label: string; hint?: string; /** Texto inserido no prompt; ausente = é uma ação ou está indisponível. */ insert?: string; disabled?: string }
export const SECTION_LABEL: Record<MentionSection, string> = { get terminals() { return t('composer.mentions.terminais') }, get notes() { return t('composer.mentions.notas') }, get portals() { return t('composer.mentions.portais') }, get floors() { return t('composer.mentions.andares') }, get workspaces() { return t('composer.mentions.espacos_de_trabalho') }, get actions() { return t('composer.mentions.acoes') }, get files() { return t('composer.mentions.arquivos') }, get prompts() { return t('composer.mentions.prompts_2') } }
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** A menção que está sendo digitada: um `@` no começo do texto ou depois de espaço, e o que veio depois dele até o cursor (sem espaços). */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret), at = before.lastIndexOf('@')
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null
  const query = before.slice(at + 1)
  return /\s/.test(query) ? null : { start: at, query }
}
/** Troca `@consulta` pelo texto escolhido (com um espaço depois) e devolve o novo texto e onde fica o cursor. */
export function applyMention(text: string, caret: number, start: number, insert: string): { text: string; caret: number } {
  const next = `${text.slice(0, start)}${insert} ${text.slice(caret)}`
  return { text: next, caret: start + insert.length + 1 }
}
/** Nome com espaço ou aspas vira `@"Nome"`; os outros, `@Nome`. */
export const mentionName = (name: string): string => (/[\s"]/.test(name) ? `@"${name.replace(/"/g, "'")}"` : `@${name}`)

export interface MentionSource {
  nodes: readonly CanvasNode[]
  selfId: string
  floors: ReadonlyArray<{ id: string; name: string }>
  workspaces: ReadonlyArray<{ id: string; name: string }>
  actions: ReadonlyArray<{ id: string; label: string }>
}
/** As menções disponíveis, por seção. Prompts salvos ainda dependem do gerenciador de prompts: aparece desabilitado, com o motivo. */
export function mentionItems(src: MentionSource, query: string, promptsReady = false): MentionItem[] {
  const q = fold(query), match = (label: string): boolean => !q || fold(label).includes(q)
  const items: MentionItem[] = []
  for (const n of src.nodes) {
    if (n.id === src.selfId || !match(n.name)) continue
    const section: MentionSection | null = n.kind === 'terminal' ? 'terminals' : n.kind === 'note' ? 'notes' : n.kind === 'portal' ? 'portals' : null
    if (section) items.push({ section, id: n.id, label: n.name, insert: mentionName(n.name) })
  }
  for (const f of src.floors) if (match(f.name)) items.push({ section: 'floors', id: f.id, label: f.name, insert: mentionName(t('composer.mentions.andar_name', { name: f.name })) })
  for (const w of src.workspaces) if (match(w.name)) items.push({ section: 'workspaces', id: w.id, label: w.name, insert: mentionName(w.name) })
  for (const a of src.actions) if (match(a.label)) items.push({ section: 'actions', id: a.id, label: a.label })
  if (match('arquivo') || match(t('composer.mentions.arquivo'))) items.push({ section: 'files', id: 'file', label: t('composer.mentions.arquivo') })
  if (match('prompts') || match('prompt')) items.push(promptsReady ? { section: 'prompts', id: 'prompts', label: t('composer.mentions.prompts') } : { section: 'prompts', id: 'prompts', label: t('composer.mentions.prompts'), disabled: t('composer.mentions.depende_do_gerenciador_de_prom') })
  const order: MentionSection[] = ['terminals', 'notes', 'portals', 'floors', 'workspaces', 'actions', 'files', 'prompts']
  return order.flatMap(s => items.filter(i => i.section === s))
}

/** Prompts salvos para o submenu do @Prompts: filtra por nome e descrição (sem acento nem caixa), os do espaço de trabalho atual antes dos globais. */
export function promptRows<T extends { name: string; description: string; workspaceId: string | null }>(list: readonly T[], query: string, workspaceId: string | null): T[] {
  const q = fold(query)
  return list.filter(p => !q || fold(p.name).includes(q) || fold(p.description).includes(q))
    .map((p, i) => ({ p, i })).sort((a, b) => Number(b.p.workspaceId === workspaceId && workspaceId !== null) - Number(a.p.workspaceId === workspaceId && workspaceId !== null) || a.i - b.i).map(x => x.p)
}

/** Texto colado grande vira uma pílula no campo ("Texto colado #1 · 12 linhas") e só é expandido ao enviar. */
export const PASTE_MIN_LINES = 5, PASTE_MIN_CHARS = 500
export const isLargePaste = (text: string): boolean => text.split('\n').length >= PASTE_MIN_LINES || text.length >= PASTE_MIN_CHARS
export function pasteLabel(n: number, text: string): string {
  const lines = text.split('\n').length
  return t('composer.mentions.texto_colado', { n, size: lines === 1 ? t('composer.mentions.length_caracteres', { length: text.length }) : t('composer.mentions.lines_linhas', { lines }) })
}
export function expandPastes(draft: string, pastes: ReadonlyMap<string, string>): string {
  let out = draft
  for (const [label, text] of pastes) out = out.split(label).join(text)
  return out
}
