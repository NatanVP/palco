/** O que o menu do botão direito precisa do xterm vivo de cada terminal (a tela fica no componente; o menu, no canvas). */
export interface TerminalHandle {
  selection(): string
  /** `paste` do xterm: respeita o bracketed paste do programa que está rodando. */
  paste(text: string): void
  selectAll(): void
  focus(): void
  /** Colunas e linhas atuais (a prévia do chat as copia). */
  size?(): { cols: number; rows: number }
}

const handles = new Map<string, TerminalHandle>()

export function registerTerminal(id: string, handle: TerminalHandle): () => void {
  handles.set(id, handle)
  return () => { if (handles.get(id) === handle) handles.delete(id) }
}

export const terminalHandle = (id: string): TerminalHandle | undefined => handles.get(id)

/** Caminho colado no terminal: entre aspas simples quando tem algo que o shell separaria ou expandiria. */
export const quotePath = (path: string): string => (/^[A-Za-z0-9_./~+-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`)
