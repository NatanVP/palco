/** Ações do menu do elemento que precisam do main. Todas recebem o id do nó: o main nunca abre um caminho vindo do renderer. */
export interface NodeStateApi {
  unload(ids: string[]): Promise<void>
  wake(id: string): Promise<void>
  /** "Mostrar na Pasta": o arquivo ou a raiz da árvore no gerenciador de arquivos. */
  reveal(id: string): Promise<void>
  /** "Abrir": o arquivo do nó no programa padrão. O que o sistema poderia executar é só mostrado na pasta (`revealed`). */
  open(id: string): Promise<'opened' | 'revealed'>
  /** "Copiar": o arquivo do nó (texto como texto, PNG como imagem); falso se o tipo não vai para a área de transferência. */
  copyFile(id: string): Promise<boolean>
  clearPortalStorage(id: string): Promise<void>
  /** Copia o PNG do portal para a área de transferência; falso se a página não está aberta. */
  copyScreenshot(id: string): Promise<boolean>
}

export const NODE_STATE_CH = {
  unload: 'palco:nodeState:unload', wake: 'palco:nodeState:wake', reveal: 'palco:nodeState:reveal', open: 'palco:nodeState:open',
  copyFile: 'palco:nodeState:copyFile', clearPortalStorage: 'palco:nodeState:clearPortalStorage', copyScreenshot: 'palco:nodeState:copyScreenshot'
} as const
