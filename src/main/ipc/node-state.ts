import { clipboard, ClipboardItem, session, shell } from 'electron'
import { NODE_STATE_CH } from '../../shared/node-state'
import { portalPartitionFor } from '../../shared/portal-settings'
import { readFileForNode } from '../files'
import { isLaunchable, resolveTarget } from '../node-files'
import { unloadNodes, wakeNode } from '../node-state'
import { parseId, parseMemberIds } from '../validate'
import type { IpcArea } from './area'

const writePng = (png: Uint8Array): Promise<void> => clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])

/**
 * Menu do elemento: descarregar/acordar, mostrar na pasta, abrir, copiar arquivo, armazenamento e captura do portal.
 * Todo canal recebe o id do nó; o caminho sai do nó e o alvo real é conferido aqui (`node-files.ts`).
 */
export const nodeStateArea: IpcArea = ({ handle, deps }) => {
  const nodeOf = (raw: unknown) => {
    const id = parseId(raw), store = deps.registry.storeOfNode(id), node = store?.get().nodes[id]
    if (!store || !node) throw new Error('nó inexistente')
    return { id, store, node }
  }
  /** O arquivo de um nó arquivo: existe, é arquivo comum e o link, se for um, não sai da pasta. */
  const fileOf = async (raw: unknown) => {
    const { node } = nodeOf(raw)
    if (node.kind !== 'file') throw new Error('o elemento não tem arquivo')
    const target = await resolveTarget(node.path)
    if (target.dir) throw new Error('o elemento não tem arquivo')
    return { path: node.path, target }
  }
  const state = { registry: deps.registry, terminals: deps.terminals, portals: deps.portals }
  handle(NODE_STATE_CH.unload, (ids) => unloadNodes(state, parseMemberIds(ids)))
  handle(NODE_STATE_CH.wake, (id) => wakeNode(state, parseId(id)))
  handle(NODE_STATE_CH.reveal, async (id) => {
    const { node } = nodeOf(id)
    if (node.kind === 'note' && node.linkedFile) { shell.showItemInFolder((await resolveTarget(node.linkedFile)).real); return }
    if (node.kind === 'filetree') {
      const target = await resolveTarget(node.root)
      if (!target.dir) throw new Error('a raiz da árvore não é uma pasta')
      const error = await shell.openPath(target.real)
      if (error) throw new Error(error)
      return
    }
    // Mostrar um arquivo nunca o abre.
    shell.showItemInFolder((await fileOf(id)).path)
  })
  handle(NODE_STATE_CH.open, async (id) => {
    const { path, target } = await fileOf(id)
    if (await isLaunchable(path, target)) { shell.showItemInFolder(path); return 'revealed' }
    // Abre o alvo conferido, não o caminho do nó (um link trocado depois não muda o que se abre).
    const error = await shell.openPath(target.real)
    if (error) throw new Error(error)
    return 'opened'
  })
  handle(NODE_STATE_CH.copyFile, async (id) => {
    const { target } = await fileOf(id)
    const file = await readFileForNode(target.real)
    if (file.truncated || file.kind === 'binary') return false
    if (file.kind === 'text') { await clipboard.writeText(file.data); return true }
    if (!file.data.startsWith('data:image/png')) return false
    await writePng(Buffer.from(file.data.slice(file.data.indexOf(',') + 1), 'base64'))
    return true
  })
  handle(NODE_STATE_CH.clearPortalStorage, async (raw) => {
    const { id, store, node } = nodeOf(raw)
    if (node.kind !== 'portal') throw new Error('o nó não é um portal')
    await session.fromPartition(portalPartitionFor(node.storage, id, store.get().id)).clearStorageData()
  })
  handle(NODE_STATE_CH.copyScreenshot, async (raw) => {
    const { id, node } = nodeOf(raw)
    if (node.kind !== 'portal' || !deps.portals.capturePng) return false
    await writePng(await deps.portals.capturePng(id))
    return true
  })
}
