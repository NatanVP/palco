import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { MAX_ATTACHMENT_BYTES } from './chat/attach'

/** O mesmo teto dos anexos do chat: o que passar dele não seria entregue ao agente de qualquer forma. */
export const MAX_PASTED_BYTES = MAX_ATTACHMENT_BYTES
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }

/** Nome de arquivo sem caminho, sem ponto no começo e só com caracteres comuns. */
function safeName(name: string, mime: string): string {
  const clean = basename(String(name)).replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^[.\s_-]+/, '').slice(-100)
  return clean || `imagem-colada.${EXT[mime] ?? 'bin'}`
}

/**
 * O que é colado sem existir em disco (captura de tela) vira arquivo numa pasta temporária do palco, criada só quando preciso.
 * Fica fora de `~/.palco` (pasta que nunca vira anexo) e é apagada ao encerrar o app.
 */
export function createPastedFiles(base: string): { write(name: string, mime: string, data: Uint8Array): string; dispose(): void } {
  let dir: string | null = null, count = 0
  return {
    write(name, mime, data) {
      if (!data || data.byteLength === 0 || data.byteLength > MAX_PASTED_BYTES) throw new Error('o conteúdo colado está vazio ou é grande demais para anexar')
      dir ??= mkdtempSync(join(base, 'palco-anexos-'))
      const path = join(dir, `${++count}-${safeName(name, mime)}`)
      writeFileSync(path, data, { flag: 'wx', mode: 0o600 })
      return path
    },
    dispose() { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null }
  }
}
