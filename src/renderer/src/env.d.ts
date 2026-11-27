declare module '*.css'

interface Window {
  /** Extras do preload fora de PalcoApi: aviso do store (arquivo recuperado, somente leitura...). */
  palcoMeta: {
    warning(): Promise<string | null>
    onWarning(cb: (warning: string | null) => void): () => void
  }
}
