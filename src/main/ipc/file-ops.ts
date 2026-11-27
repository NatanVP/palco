import { homedir, tmpdir } from 'node:os'
import { createPastedFiles } from '../pasted-files'
import { join } from 'node:path'
import { pathKind, readNoteText, renameEntry, storeAttachment, trashEntry } from '../file-ops'
import type { IpcArea } from './area'

export const FILEOPS_CH = { trash: 'palco:files:trash', rename: 'palco:files:rename', store: 'palco:files:storeAttachment', kind: 'palco:files:kind', noteText: 'palco:files:noteText', materialize: 'palco:files:materialize' } as const
/** Gerenciador de arquivos da árvore de pastas e os anexos do canvas. As regras de caminho vivem em `file-ops.ts` (testadas). */
export const fileOpsArea: IpcArea = ({ handle }) => {
  const pasted = createPastedFiles(tmpdir())
  handle(FILEOPS_CH.materialize, (name, mime, data) => {
    if (typeof name !== 'string' || typeof mime !== 'string' || !(data instanceof ArrayBuffer || data instanceof Uint8Array)) throw new Error('anexo inválido')
    return pasted.write(name, mime, data instanceof Uint8Array ? data : new Uint8Array(data))
  })
  handle(FILEOPS_CH.trash, async path => { await trashEntry(path as string, homedir()) })
  handle(FILEOPS_CH.rename, (path, name) => renameEntry(path as string, name as string, homedir()))
  handle(FILEOPS_CH.kind, path => pathKind(path as string))
  handle(FILEOPS_CH.noteText, path => readNoteText(path as string))
  handle(FILEOPS_CH.store, source => storeAttachment(source as string, join(homedir(), '.palco', 'attachments')))
  return () => pasted.dispose()
}
