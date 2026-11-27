import { clipboard } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLIPBOARD_CH } from '../../shared/clipboard'
import { parseUriList } from '../uri-list'
import type { IpcArea } from './area'

const MAX_IMAGE_BYTES = 40 * 1024 * 1024
const MAX_TEXT = 2 * 1024 * 1024

async function blobOf(type: string): Promise<Blob | null> {
  for (const item of await clipboard.read()) {
    if (!item.types.includes(type)) continue
    const value = (await item.getType(type)) as unknown
    return value instanceof Blob ? value : new Blob([String(value)])
  }
  return null
}
/** Área de transferência do sistema para os menus do botão direito (Colar no canvas e no terminal). Copiar arquivo é do nó (`node-state.ts`). */
export const clipboardArea: IpcArea = ({ handle }) => {
  handle(CLIPBOARD_CH.read, async () => {
    const types = (await clipboard.read()).flatMap((item) => item.types)
    const uris = types.includes('text/uri-list') ? await blobOf('text/uri-list').then((b) => b?.text() ?? '') : ''
    return { text: (await clipboard.readText()).slice(0, MAX_TEXT), files: parseUriList(uris), image: types.some((t) => t.startsWith('image/')) }
  })
  handle(CLIPBOARD_CH.writeText, async (text) => {
    if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('texto inválido')
    await clipboard.writeText(text)
  })
  handle(CLIPBOARD_CH.saveImage, async () => {
    const image = await blobOf('image/png')
    if (!image || image.size === 0 || image.size > MAX_IMAGE_BYTES) return null
    const dir = join(homedir(), '.palco', 'attachments')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, `${randomUUID()}-imagem-colada.png`)
    await writeFile(path, new Uint8Array(await image.arrayBuffer()), { mode: 0o600, flag: 'wx' })
    return path
  })
}
