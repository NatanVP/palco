import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { join, relative } from 'node:path'
import type { AgentKind } from '../shared/model'

/** Arquivo, dentro de cada skill instalada, com a versão (hash do conteúdo) que o palco copiou. */
export const VERSION_FILE = '.palco-version'
const SKILL_PREFIX = 'palco'

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...files(p))
    else out.push(p)
  }
  return out
}

/** Skills do palco na origem (`palco`, `palco-manager`, ...): só pastas `palco*` com `SKILL.md`. */
export function palcoSkills(source: string): string[] {
  if (!existsSync(source)) return []
  return readdirSync(source).filter((n) => n.startsWith(SKILL_PREFIX) && existsSync(join(source, n, 'SKILL.md'))).sort()
}

/** Versão de uma skill: hash dos caminhos e conteúdos dos arquivos dela. */
export function skillVersion(dir: string): string {
  const h = createHash('sha256')
  for (const f of files(dir)) {
    h.update(relative(dir, f)).update('\0').update(readFileSync(f)).update('\0')
  }
  return h.digest('hex').slice(0, 16)
}

/** O que está no caminho, sem seguir links; `undefined` quando não há nada. */
const entry = (path: string): Stats | undefined => lstatSync(path, { throwIfNoEntry: false })

/**
 * Prova de que a pasta é do palco: uma pasta de verdade com o marcador como arquivo de verdade. É a única coisa que o
 * palco substitui ou apaga. Link (na pasta ou no marcador) nunca conta; na dúvida, é do usuário.
 */
export function isManaged(dir: string): boolean {
  try { return entry(dir)?.isDirectory() === true && entry(join(dir, VERSION_FILE))?.isFile() === true } catch { return false }
}

function versionOf(source: string, name: string, versions: Map<string, string>): string {
  const from = join(source, name)
  let version = versions.get(from)
  if (version === undefined) { version = skillVersion(from); versions.set(from, version) }
  return version
}
const upToDate = (dir: string, version: string): boolean => isManaged(dir) && readFileSync(join(dir, VERSION_FILE), 'utf8').trim() === version && entry(join(dir, 'SKILL.md'))?.isFile() === true

/** Todas as skills do palco estão em `target`, gerenciadas e na versão atual? Sem skills na origem, não há o que provar. */
export function isInstalled(source: string, target: string, versions: Map<string, string> = new Map()): boolean {
  const names = palcoSkills(source)
  try { return names.length > 0 && entry(target)?.isSymbolicLink() !== true && names.every((n) => upToDate(join(target, n), versionOf(source, n, versions))) } catch { return false }
}

/** Skills que não podem ser instaladas em `target` porque o lugar delas tem algo que não é do palco. */
export function skillConflicts(source: string, target: string): string[] {
  return palcoSkills(source).filter((n) => { const to = join(target, n); try { return entry(to) !== undefined && !isManaged(to) } catch { return false } })
}

/**
 * Copia cada skill `palco*` de `source` para `target` (pasta `skills` de um agente). Só cria o que não existe ou troca o
 * que é do palco (`isManaged`): pasta, arquivo ou link do usuário com o mesmo nome fica como está (`skillConflicts` diz
 * quais). Só quando a versão muda, e troca a pasta de uma vez (cópia temporária conferida + rename): o agente nunca vê
 * meia skill, e a cópia anterior só é apagada depois de a nova estar no lugar. Devolve os nomes atualizados.
 */
export function installSkills(source: string, target: string, versions: Map<string, string> = new Map()): string[] {
  const updated: string[] = []
  if (entry(target)?.isSymbolicLink()) return updated
  for (const name of palcoSkills(source)) {
    const version = versionOf(source, name, versions)
    const to = join(target, name)
    const there = entry(to) !== undefined
    if (there && (!isManaged(to) || upToDate(to, version))) continue
    mkdirSync(target, { recursive: true })
    const tmp = join(target, `.${name}.${randomUUID()}.tmp`)
    const old = join(target, `.${name}.${randomUUID()}.old`)
    try {
      cpSync(join(source, name), tmp, { recursive: true })
      writeFileSync(join(tmp, VERSION_FILE), `${version}\n`)
      if (!upToDate(tmp, version)) throw new Error('A cópia da skill ficou incompleta.')
      if (there) renameSync(to, old)
      try { renameSync(tmp, to) } catch (e) { if (there) renameSync(old, to); throw e }
      // Só aqui, com a nova no lugar. Se a volta acima falhar, a anterior continua em `old`: não se apaga.
      rmSync(old, { recursive: true, force: true })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    updated.push(name)
  }
  return updated
}

/**
 * Pastas de skills de um terminal de agente: a padrão do CLI (`~/.claude/skills` ou `~/.codex/skills`) e, com conta
 * escolhida, a pasta da conta (`<configDir>/skills`, ex.: `~/.claude-sonnet/skills`). Shell e genéricos: nenhuma.
 */
export function skillTargets(agent: AgentKind, home: string, accountDir?: string): string[] {
  if (agent !== 'claude' && agent !== 'codex') return []
  const base = join(home, agent === 'claude' ? '.claude' : '.codex', 'skills')
  const account = accountDir === undefined ? undefined : join(accountDir, 'skills')
  return account === undefined || account === base ? [base] : [base, account]
}
