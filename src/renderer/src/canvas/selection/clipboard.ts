import type { SystemClipboard } from '../../../../shared/clipboard'
import type { CanvasClip } from './group'

export interface ElementClip { token: string; data: CanvasClip; pastes?: number }

let current: ElementClip | null = null
/**
 * A área de transferência dos elementos do canvas ("Copiar Elemento" e Ctrl+C), comum a todos os workspaces. Ela deixa uma marca
 * na área de transferência do sistema: enquanto a marca estiver lá, Colar cola os elementos; se o usuário copiar outra coisa
 * depois (um arquivo, um endereço), vale o que ele copiou.
 */
export const elementClipboard = {
  get: (): ElementClip | null => current,
  set(data: CanvasClip): ElementClip {
    current = { token: `palco:elements:${crypto.randomUUID()}`, data, pastes: 0 }
    void window.palco?.clipboard?.writeText(current.token).catch(() => {})
    return current
  },
  clear(): void { current = null }
}

export type PasteSource = { kind: 'elements'; clip: ElementClip } | { kind: 'files'; files: string[] } | { kind: 'image' } | { kind: 'url'; url: string } | { kind: 'nothing' }

const URL_LINE = /^https?:\/\/[^\s]+$/i
/** O que o Colar do canvas usa: os elementos copiados; senão arquivos, imagem ou um endereço do sistema. */
export function decidePaste(system: SystemClipboard, clip: ElementClip | null): PasteSource {
  const text = system.text.trim()
  if (clip && (text === clip.token || (!text && !system.files.length && !system.image))) return { kind: 'elements', clip }
  if (system.files.length) return { kind: 'files', files: system.files }
  if (system.image) return { kind: 'image' }
  return URL_LINE.test(text) ? { kind: 'url', url: text } : { kind: 'nothing' }
}
