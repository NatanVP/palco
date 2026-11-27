import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { PromptDraft, SavedPrompt, SavedPromptMeta } from '../../shared/agent-libraries'
import { slugFloorName } from '../domain/floor-name'
import { assertWorkspaceId, validWorkspaceId } from '../domain/workspace-id'
const MAX = 256 * 1024
/** `slug` (global, na raiz) ou `idDoEspaço/slug`. */
const idOf = (id: unknown): string => { if (typeof id !== 'string' || !/^(?:[A-Za-z0-9_-]{1,128}\/)?[a-z0-9][a-z0-9-]{0,199}$/.test(id)) throw new Error('ID de prompt inválido'); return id }
const folderOf = (id: string): string | null => (id.includes('/') ? id.slice(0, id.indexOf('/')) : null)
const isLink = (path: string): boolean => { try { return lstatSync(path).isSymbolicLink() } catch { return false } }
/** O palco só reescreve o AGENTS.md que ele mesmo criou (o que ainda começa com esta linha). */
const GUIDE_MARK = '<!-- palco: gerado -->'
const GUIDE = `${GUIDE_MARK}
# Prompts salvos do palco

Cada pasta com um \`PROMPT.md\` é um prompt que o usuário insere pelo @Prompts do Compositor.

- Globais: \`<nome-do-prompt>/PROMPT.md\` nesta pasta.
- De um espaço de trabalho: \`<id-do-espaço>/<nome-do-prompt>/PROMPT.md\`. Não invente o id: peça ao usuário o caminho copiado em Configurações › Agentes › Prompts, com o espaço escolhido.
- Nome de pasta em minúsculas, com hífens.

O arquivo é UTF-8, de até 256 KB, com cabeçalho obrigatório:

\`\`\`markdown
---
name: Revisar mudanças
description: opcional, uma linha
---
O texto do prompt.
\`\`\`

Só o \`PROMPT.md\` é inserido. Este arquivo não é um prompt.
`
function draft(value: PromptDraft): void {
 if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 || typeof value.body !== 'string' || !value.body.trim() || (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 2000)) || value.workspaceId !== null && (typeof value.workspaceId !== 'string' || !value.workspaceId || value.workspaceId.length > 200)) throw new Error('Prompt inválido: preencha nome e corpo.')
}
/** Liga a biblioteca às exclusões de workspace. A limpeza que falha só avisa: o workspace já saiu. */
export function removePromptsWithWorkspace(registry: { onRemoved(cb: (id: string) => void): () => void }, prompts: PromptStore, warn: (error: unknown) => void = () => {}): () => void {
 return registry.onRemoved(id => { try { prompts.removeWorkspace(id) } catch (error) { warn(error) } })
}
/** One folder/PROMPT.md per prompt. JSON-quoted scalar frontmatter is a deliberate YAML subset, not executable YAML. */
export class PromptStore {
 private deleted = new Map<string, SavedPrompt>()
 constructor(readonly dir: string) {}
 private file(id: string): string {
  idOf(id)
  let path = this.dir
  for (const part of ['', ...id.split('/')]) { if (part) path = join(path, part); if (isLink(path)) throw new Error('Links simbólicos não são permitidos na biblioteca.') }
  const file = join(path, 'PROMPT.md')
  if (isLink(file)) throw new Error('PROMPT.md não pode ser um link.')
  return file
 }
 /** A pasta onde ficam os prompts do escopo (criada na hora, com o guia para agentes na raiz). */
 directory(workspaceId: string | null): string {
  if (workspaceId !== null) assertWorkspaceId(workspaceId)
  const path = workspaceId === null ? this.dir : join(this.dir, workspaceId)
  if (isLink(this.dir) || isLink(path)) throw new Error('A pasta de prompts não pode ser um link.')
  if (existsSync(join(path, 'PROMPT.md')) && workspaceId !== null) throw new Error('Há um prompt global ocupando a pasta deste espaço de trabalho.')
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const guide = join(this.dir, 'AGENTS.md')
  if (!isLink(guide) && (!existsSync(guide) || readFileSync(guide, 'utf8').startsWith(GUIDE_MARK))) writeFileSync(guide, GUIDE, { mode: 0o600 })
  return path
 }
 /** Os ids em disco: pastas com PROMPT.md na raiz e as de dentro das pastas de espaço de trabalho. Arquivos soltos não contam. */
 private ids(): string[] {
  const folders = (path: string) => readdirSync(path, { withFileTypes: true }).filter(e => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink())).sort((a, b) => (a.name < b.name ? -1 : 1))
  return folders(this.dir).flatMap(e => {
   const path = join(this.dir, e.name)
   if (!e.isDirectory() || existsSync(join(path, 'PROMPT.md')) || !validWorkspaceId(e.name)) return [e.name]
   const inside = folders(path)
   if (inside.length) return inside.map(child => `${e.name}/${child.name}`)
   // Pasta de espaço ainda vazia: não é problema. Pasta com arquivos soltos e sem PROMPT.md, é.
   return readdirSync(path).some(n => !n.startsWith('.')) ? [e.name] : []
  })
 }
 list(workspaceId?: string): { items: SavedPromptMeta[]; problems: Array<{ id: string; reason: string }> } {
  const items: SavedPromptMeta[] = [], problems: Array<{ id: string; reason: string }> = []
  if (!existsSync(this.dir)) return { items, problems }
  if (lstatSync(this.dir).isSymbolicLink()) throw new Error('A pasta de prompts não pode ser um link.')
  for (const id of this.ids()) {
   try { const { body: _body, ...meta } = this.read(id); if (workspaceId === undefined || meta.workspaceId === null || meta.workspaceId === workspaceId) items.push(meta) }
   catch (e) { problems.push({ id, reason: e instanceof Error ? e.message : 'Não foi possível ler.' }) }
  }
  return { items, problems }
 }
 read(id: string): SavedPrompt {
  const file = this.file(id), stat = lstatSync(file)
  if (!stat.isFile() || stat.size > MAX) throw new Error('PROMPT.md deve ser um arquivo de até 256 KB.')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file)) } catch { throw new Error('PROMPT.md não é UTF-8 válido.') }
  const match = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw new Error('Frontmatter ausente: use delimitadores ---.')
  const meta: Record<string, unknown> = {}
  for (const line of match[1]!.split('\n')) {
   if (!line.trim() || line.trim().startsWith('#')) continue
   const m = line.match(/^(name|description|workspaceId):\s*(.*)$/)
   if (!m) throw new Error('Campo de frontmatter inválido.')
   if (Object.hasOwn(meta, m[1]!)) throw new Error('Campo duplicado no frontmatter.')
   const raw = m[2]!.trim(); try { meta[m[1]!] = raw === 'null' ? null : raw.startsWith('"') ? JSON.parse(raw) : raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw } catch { throw new Error('Valor de frontmatter inválido.') }
  }
  const result = { id, name: meta.name, description: meta.description ?? '', workspaceId: folderOf(id) ?? meta.workspaceId ?? null, body: match[2] } as SavedPrompt
  draft(result); return result
 }
 save(input: PromptDraft): SavedPrompt {
  draft(input)
  const name = input.name.trim(), items = this.list().items, workspace = input.workspaceId
  if (workspace !== null) assertWorkspaceId(workspace)
  if (items.some(p => p.id !== input.id && p.name.toLocaleLowerCase() === name.toLocaleLowerCase() && p.workspaceId === workspace)) throw new Error('Já existe um prompt com este nome neste escopo.')
  const old = input.id
  if (old) this.read(old)
  const folder = workspace === null ? '' : `${workspace}/`
  // Fica no lugar quando já está na pasta do escopo; senão (novo, ou mudou de escopo) ganha uma pasta livre no destino.
  let id = old && (folderOf(old) ?? null) === workspace ? old : undefined
  if (!id) {
   if (workspace !== null) this.directory(workspace)
   const base = old ? old.slice(old.indexOf('/') + 1) : slugFloorName(name).slice(0, 160)
   let slug = base, n = 2
   while (existsSync(join(this.dir, folder + slug))) slug = `${base}-${n++}`
   id = folder + slug
  }
  const description = input.description ?? '', text = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\nworkspaceId: ${JSON.stringify(workspace)}\n---\n${input.body}`
  if (Buffer.byteLength(text) > MAX) throw new Error('PROMPT.md excede 256 KB.')
  const result = { id, name, description, body: input.body, workspaceId: workspace }
  // A pasta inteira se muda: o usuário pode ter outros arquivos dentro dela.
  if (old && old !== id) { this.move(old, id, text); return result }
  const file = this.file(id)
  mkdirSync(join(this.dir, id), { recursive: true, mode: 0o700 }); const tmp = file + '.' + randomUUID() + '.tmp'
  try { writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 }); renameSync(tmp, file) } finally { rmSync(tmp, { force: true }) }
  return result
 }
 /**
  * Muda a pasta de lugar já com o texto novo, tudo ou nada: monta a nova numa pasta oculta (que a lista ignora),
  * confere, publica com um rename e só então tira a antiga. Qualquer falha deixa a antiga como estava, no mesmo id.
  */
 private move(old: string, id: string, text: string): void {
  this.file(old); this.file(id)
  const from = join(this.dir, old), to = join(this.dir, id), hidden = (path: string, kind: string) => join(dirname(path), `.${basename(path)}.${randomUUID()}.${kind}`)
  const staging = hidden(to, 'tmp'), retired = hidden(from, 'old')
  mkdirSync(dirname(to), { recursive: true, mode: 0o700 })
  try {
   // `verbatimSymlinks`: um link entre os anexos continua o mesmo link, sem ser seguido.
   cpSync(from, staging, { recursive: true, verbatimSymlinks: true })
   const file = join(staging, 'PROMPT.md')
   writeFileSync(file, text, { mode: 0o600 })
   if (readFileSync(file, 'utf8') !== text) throw new Error('Não foi possível gravar o prompt no destino.')
   renameSync(staging, to)
  } finally { rmSync(staging, { recursive: true, force: true }) }
  // Tirar a antiga também é um rename só; se falhar, a nova (cópia nossa) é desfeita.
  try { renameSync(from, retired) } catch (e) { rmSync(to, { recursive: true, force: true }); throw e }
  try { rmSync(retired, { recursive: true, force: true }) } catch { /* já está fora da lista; sobra uma pasta oculta */ }
 }
 /**
  * O workspace foi excluído: some a pasta dele, com o que houver dentro. Link no lugar da biblioteca ou da pasta fica como está
  * (nada é seguido; os links de dentro são só desfeitos), e uma pasta que é um prompt global não é de workspace nenhum.
  */
 removeWorkspace(workspaceId: string): void {
  assertWorkspaceId(workspaceId)
  for (const [token, p] of this.deleted) if (p.workspaceId === workspaceId) this.deleted.delete(token)
  const path = join(this.dir, workspaceId)
  if (isLink(this.dir) || isLink(path) || !existsSync(path) || !lstatSync(path).isDirectory() || existsSync(join(path, 'PROMPT.md'))) return
  rmSync(path, { recursive: true, force: true })
 }
 remove(id: string): string {
  const p = this.read(id); rmSync(this.file(id));
  try { rmdirSync(join(this.dir, id)) } catch { /* preserve other user-authored files */ } // preserve other user-authored files in that folder
  const token = randomUUID(); this.deleted.set(token, p); if (this.deleted.size > 50) this.deleted.delete(this.deleted.keys().next().value!)
  return token
 }
 undo(token: string): SavedPrompt {
  const p = this.deleted.get(token); if (!p) throw new Error('Não é mais possível desfazer.')
  if (existsSync(this.file(p.id)) || this.list().items.some(x => x.workspaceId === p.workspaceId && x.name.toLocaleLowerCase() === p.name.toLocaleLowerCase())) throw new Error('Já existe um prompt neste local; nenhum arquivo foi substituído.')
  // Restore the stable ID (save would reject the deliberately absent file).
  const file = this.file(p.id), text = `---\nname: ${JSON.stringify(p.name)}\ndescription: ${JSON.stringify(p.description)}\nworkspaceId: ${JSON.stringify(p.workspaceId)}\n---\n${p.body}`
  mkdirSync(join(this.dir, p.id), { recursive: true, mode: 0o700 }); writeFileSync(file, text, { flag: 'wx', mode: 0o600 }); this.deleted.delete(token); return p
 }
}
