import { fileURLToPath } from 'node:url'

/** `text/uri-list` (arquivos copiados no gerenciador de arquivos) em caminhos locais; o que não for `file:` fica de fora. */
export function parseUriList(list: string): string[] {
  return list.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith('file://')) return []
    try { return [fileURLToPath(line.trim())] } catch { return [] }
  }).slice(0, 100)
}
