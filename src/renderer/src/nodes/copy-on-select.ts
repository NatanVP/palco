/** "Copiar ao selecionar" só escreve quando a seleção para de mudar: arrastar não passa dezenas de trechos pela área de transferência. */
export function debouncedCopy(write: (text: string) => void, ms: number): { push(text: string): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => { clearTimeout(timer); timer = undefined }
  return {
    push: (text) => { cancel(); if (text) timer = setTimeout(() => write(text), ms) },
    dispose: cancel
  }
}
