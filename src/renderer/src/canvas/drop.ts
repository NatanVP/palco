import type { FloorId, NewNode, Size, Vec } from '../../../shared/model'
import { newItemSize, noteDefaults } from '../../../shared/new-item'
import type { Preferences } from '../../../shared/preferences'
import { NOTE_FILE_EXT, isNoteFilePath } from '../../../shared/note-file'
import { PLACE_DEFAULTS } from './placement'

/** O que o main contou de cada caminho solto: pasta, arquivo, texto pequeno (vira nota) ou nada. */
export interface DroppedInfo { path: string; kind: 'dir' | 'file' | null; note: boolean; text?: string | null }
const base = (p: string): string => p.split('/').filter(Boolean).pop() || p
const snap = (v: number): number => Math.round(v / 20) * 20

/**
 * Nós criados ao soltar arquivos no canvas: pasta → árvore de pastas; .md/.txt pequeno → nota (com o conteúdo e os padrões de
 * nota); o resto → nó arquivo. Com "Sempre copiar arquivos" o nó aponta para a cópia (`copies[path]`); sem ela, para o original.
 * Vários itens descem em escada a partir do ponto solto; caminho que não existe mais fica de fora.
 */
export function nodesForDrop(items: readonly DroppedInfo[], at: Vec, prefs: Preferences, floorId: FloorId, copies: Readonly<Record<string, string>> = {}): NewNode[] {
  const out: NewNode[] = []
  for (const it of items) {
    if (!it.kind || prefs.alwaysCopyAttachments && it.kind === 'file' && !it.note && !copies[it.path]) continue
    const i = out.length, size: Size = it.kind === 'dir' ? PLACE_DEFAULTS.filetree : it.note && it.text != null ? (newItemSize('note', prefs) ?? PLACE_DEFAULTS.note) : PLACE_DEFAULTS.file
    const pos = { x: snap(at.x - size.w / 2) + i * 40, y: snap(at.y - size.h / 2) + i * 40 }, name = base(it.path)
    if (it.kind === 'dir') out.push({ kind: 'filetree', floorId, name, root: it.path, pos, size: { ...size } })
    else if (it.note && it.text != null) {
      const d = noteDefaults(prefs)
      // A nota fica ligada ao arquivo (markdown já formatado); com "Sempre copiar arquivos", é uma cópia solta.
      const link = !prefs.alwaysCopyAttachments && isNoteFilePath(it.path)
      out.push({ kind: 'note', floorId, name: name.replace(NOTE_FILE_EXT, ''), content: it.text, ...(link ? { linkedFile: it.path } : {}), render: /\.(md|markdown)$/i.test(it.path) ? 'markdown' : prefs.defaultNoteRender, color: d.color, fontSize: d.fontSize, ...(d.fontFamily ? { fontFamily: d.fontFamily } : {}), pos, size: { ...size } })
    } else out.push({ kind: 'file', floorId, name, path: copies[it.path] ?? it.path, pos, size: { ...size } })
  }
  return out
}
