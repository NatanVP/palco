import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, sep } from 'node:path'
import type { WorkspaceStore } from '../domain/workspace-store'
import { readFdBounded } from '../secure-files'
import { isNoteFilePath } from '../../shared/note-file'
import type { CanvasNode, NoteNode } from '../../shared/model'

export const MAX_LINKED_NOTE_BYTES = 256 * 1024

/** O arquivo de verdade por trás do caminho: texto comum, e um link só vale se o alvo fica na pasta dele ou abaixo. */
function target(path: string): string {
  if (!isNoteFilePath(path)) throw new Error('a nota só se liga a um arquivo .md, .markdown ou .txt')
  const real = realpathSync(path)
  if (lstatSync(path).isSymbolicLink()) {
    const home = realpathSync(dirname(path))
    if (!real.startsWith(home.endsWith(sep) ? home : home + sep)) throw new Error('o link aponta para fora da pasta dele')
  }
  if (!isNoteFilePath(real) || !statSync(real).isFile()) throw new Error('o arquivo da nota não é um texto comum')
  return real
}

/** O texto do arquivo, ou `null` se ele não existe, não é texto UTF-8 ou passa do limite. */
export function readLinkedFile(path: string): string | null {
  try {
    const fd = openSync(target(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      if (!fstatSync(fd).isFile()) return null
      const bytes = readFdBounded(fd, MAX_LINKED_NOTE_BYTES)
      return bytes.includes(0) ? null : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } finally { closeSync(fd) }
  } catch { return null }
}

/** Grava por troca de nome, mantendo a permissão. Não escreve por cima do que não leria (binário, grande demais, link para fora). */
export function writeLinkedFile(path: string, content: string): void {
  if (!isNoteFilePath(path)) throw new Error('a nota só se liga a um arquivo .md, .markdown ou .txt')
  let real = path, mode = 0o644
  let exists = true
  try { lstatSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false }
  if (exists) {
    if (readLinkedFile(path) === null) throw new Error('o arquivo da nota não é um texto comum')
    real = target(path); mode = statSync(real).mode & 0o777
  }
  const temporary = join(dirname(real), `.${basename(real)}.${randomUUID()}.tmp`)
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, content); fsyncSync(fd) } finally { closeSync(fd) }
    chmodSync(temporary, mode)
    renameSync(temporary, real)
  } finally { rmSync(temporary, { force: true }) }
}

/**
 * Notas ligadas a arquivo. Ao ligar (ou voltar pelo desfazer), o arquivo manda; depois disso, o que mudar na nota é gravado nele
 * e o que mudar nele aparece na nota. `sync` roda a cada mudança dos workspaces; os observadores chamam `fileChanged`.
 */
export class LinkedNotes {
  private readonly tracked = new Map<string, { path: string; content: string }>()
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private syncing = false
  constructor(private readonly stores: () => WorkspaceStore[]) {}

  private linked(): Array<{ store: WorkspaceStore; node: NoteNode }> {
    const isLinked = (n: CanvasNode): n is NoteNode => n.kind === 'note' && n.linkedFile !== undefined
    return this.stores().filter((s) => !s.isReadOnly).flatMap((store) => store.pick(isLinked).map((node) => ({ store, node })))
  }

  sync(): void {
    if (this.syncing) return
    this.syncing = true
    try {
      const seen = new Set<string>()
      for (const { store, node } of this.linked()) {
        const path = node.linkedFile!, known = this.tracked.get(node.id)
        seen.add(node.id)
        if (!known || known.path !== path) {
          const content = readLinkedFile(path)
          this.tracked.set(node.id, { path, content: content ?? node.content })
          if (content === null) store.setLinkedContent(node.id, node.content, true)
          else store.setLinkedContent(node.id, content, false)
        } else if (node.content !== known.content) {
          known.content = node.content
          let failed = false
          try { writeLinkedFile(path, node.content) }
          catch (error) { failed = true; console.warn('palco: nota não gravada no arquivo:', error instanceof Error ? error.message : error) }
          store.setLinkedContent(node.id, node.content, failed)
        }
      }
      for (const id of [...this.tracked.keys()]) if (!seen.has(id)) this.tracked.delete(id)
      this.watchFolders()
    } finally { this.syncing = false }
  }

  fileChanged(path: string): void {
    const content = readLinkedFile(path)
    this.syncing = true
    try {
      for (const { store, node } of this.linked()) {
        const known = this.tracked.get(node.id)
        if (node.linkedFile !== path || !known) continue
        if (content === null) store.setLinkedContent(node.id, node.content, true)
        else { known.content = content; store.setLinkedContent(node.id, content, false) }
      }
    } finally { this.syncing = false }
  }

  /** "Mover para fora": o texto vai para o arquivo escolhido, e a nota passa a ser ele. */
  moveOut(store: WorkspaceStore, id: string, path: string): void {
    const node = store.get().nodes[id]
    if (node?.kind !== 'note') throw new Error('o nó não é uma nota')
    writeLinkedFile(path, node.content)
    store.linkNote(id, path)
  }

  /** Observa a pasta de cada arquivo: editores gravam trocando o nome, o que um observador do próprio arquivo perderia. */
  private watchFolders(): void {
    const wanted = new Set([...this.tracked.values()].map((t) => dirname(t.path)))
    for (const [folder, watcher] of this.watchers) if (!wanted.has(folder)) { watcher.close(); this.watchers.delete(folder) }
    for (const folder of wanted) {
      if (this.watchers.has(folder)) continue
      try {
        const watcher = watch(folder, (_event, name) => {
          for (const path of new Set([...this.tracked.values()].map((t) => t.path))) {
            if (dirname(path) !== folder || (name !== null && String(name) !== basename(path))) continue
            clearTimeout(this.timers.get(path))
            this.timers.set(path, setTimeout(() => { this.timers.delete(path); this.fileChanged(path) }, 80))
          }
        })
        watcher.on('error', () => { watcher.close(); this.watchers.delete(folder) })
        this.watchers.set(folder, watcher)
      } catch { /* pasta ausente: a próxima sincronização tenta de novo */ }
    }
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.close()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.watchers.clear(); this.timers.clear(); this.tracked.clear()
  }
}
