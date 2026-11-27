import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RoleCandidate, RoleDraft, RoleEntry } from '../../shared/agent-libraries'
import { RoleStore } from './roles'
function validate(d: RoleDraft): void {
 if (!d || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 200 || typeof d.text !== 'string' || d.text.length > 1_000_000 || d.workspaceId !== null && (typeof d.workspaceId !== 'string' || !d.workspaceId || d.workspaceId.length > 200) || d.icon !== undefined && (typeof d.icon !== 'string' || d.icon.length > 80) || d.color !== undefined && !/^#[a-f0-9]{6}$/i.test(d.color)) throw new Error('Responsabilidade inválida.')
}
/** Display-name edits retain the canonical name, so existing CLI/preset references remain valid. */
export class RoleLibrary {
 constructor(private readonly store: RoleStore, private readonly detach: (name: string) => void = () => {}, private readonly countTerminals: (name: string) => number = () => 0) {}
 list(): RoleEntry[] { return this.store.list().map(r => { const detail = this.store.details(r.name); return { ...r, displayName: detail.displayName ?? r.name, ...detail, workspaceId: this.store.scopeOf(r.name), terminalCount: this.countTerminals(r.name) } }) }
 save(d: RoleDraft): RoleEntry {
  validate(d); const all = this.list(), displayName = d.name.trim()
  if (all.some(r => r.name !== d.id && (r.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase() || r.name === this.store.canonical(displayName)))) throw new Error('Já existe uma função com este nome.')
  const name = d.id ? this.store.get(d.id).name : this.store.canonical(displayName)
  if (d.id) this.store.edit(name, d.text); else this.store.create(name, d.text)
  this.store.setScope(name, d.workspaceId); this.store.setDetails(name, { displayName, ...(d.icon ? { icon: d.icon } : {}), ...(d.color ? { color: d.color } : {}) })
  return this.list().find(r => r.name === name)!
 }
 remove(names: string[]): void {
  if (!Array.isArray(names) || !names.length || names.length > 1000 || names.some(n => typeof n !== 'string')) throw new Error('Seleção inválida.')
  const canonical = [...new Set(names.map(n => this.store.get(n).name))]
  for (const name of canonical) { this.detach(name); this.store.remove(name) }
 }
 discover(root: string): RoleCandidate[] {
  const base = join(root, '.palco', 'roles'), out: RoleCandidate[] = []
  // Never follow project symlinks into private directories.
  for (const p of [root, join(root, '.palco'), base]) if (!existsSync(p) || lstatSync(p).isSymbolicLink() || !lstatSync(p).isDirectory()) return out
  for (const name of readdirSync(base).slice(0, 1000)) {
   const dir = join(base, name), file = join(dir, 'role.json')
   try {
    if (lstatSync(dir).isSymbolicLink() || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || lstatSync(file).size > 256 * 1024) continue
    const v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file))) as Record<string, unknown>, text = v.text ?? v.instructions ?? v.systemPrompt
    const candidate = { name: v.name, text, workspaceId: null, ...(typeof v.icon === 'string' ? { icon: v.icon } : {}), ...(typeof v.color === 'string' ? { color: v.color } : {}) } as RoleDraft
    validate(candidate); out.push({ name: candidate.name, text: candidate.text, icon: candidate.icon, color: candidate.color })
   } catch { /* invalid candidate is not imported */ }
  }
  return out
 }
 import(candidates: RoleCandidate[], workspaceId: string): void {
  if (!Array.isArray(candidates) || candidates.length > 1000) throw new Error('Seleção inválida.')
  // Validate every candidate/collision before the first write.
  const names = new Set(this.list().flatMap(r => [r.name, this.store.canonical(r.displayName)]))
  for (const c of candidates) { validate({ ...c, workspaceId }); const n = this.store.canonical(c.name); if (names.has(n)) throw new Error('Já existe uma função com este nome.'); names.add(n) }
  for (const c of candidates) this.save({ ...c, workspaceId })
 }
}
