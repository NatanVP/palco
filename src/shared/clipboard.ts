/** O que a área de transferência do sistema tem, visto pelo main: texto, arquivos copiados no gerenciador e se há imagem. */
export interface SystemClipboard { text: string; files: string[]; image: boolean }

export interface ClipboardApi {
  read(): Promise<SystemClipboard>
  writeText(text: string): Promise<void>
  /** Grava a imagem copiada na pasta de anexos do palco e devolve o caminho; `null` sem imagem. */
  saveImage(): Promise<string | null>
}

export const CLIPBOARD_CH = {
  read: 'palco:clipboard:read', writeText: 'palco:clipboard:writeText', saveImage: 'palco:clipboard:saveImage'
} as const
