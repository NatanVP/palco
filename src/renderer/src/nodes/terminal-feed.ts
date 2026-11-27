/** `cols`/`rows`: o tamanho em que `data` foi desenhado. */
export interface Snapshot { data: string; seq: number; gen: number; cols?: number; rows?: number }

export interface FeedSink {
  write(data: string): void
  /** Limpa a tela (nova geração do processo). */
  reset(): void
  /** Pede ao main um novo snapshot; a resposta volta por `applySnapshot`. */
  requestAttach(): void
}

/**
 * Costura snapshot + chunks de um terminal. Cada processo tem uma geração; ao mudar,
 * a tela é zerada e o attach refeito, e tudo que ainda chega da geração antiga é descartado.
 */
export class TerminalFeed {
  private ready = false
  private gen = 0
  private lastSeq = 0
  private buffered: Array<[string, number, number]> = []

  constructor(private readonly sink: FeedSink) {}

  start(): void {
    this.ready = false
    this.buffered = []
    this.sink.requestAttach()
  }

  onData(data: string, seq: number, gen: number): void {
    if (this.gen !== 0 && gen < this.gen) return
    if (this.ready && gen === this.gen) {
      if (seq > this.lastSeq) {
        this.lastSeq = seq
        this.sink.write(data)
      }
      return
    }
    const regime = this.ready && gen > this.gen
    this.buffered.push([data, seq, gen])
    if (regime) {
      // Processo novo (restart local ou externo): zera a tela e refaz o attach.
      this.ready = false
      this.sink.reset()
      this.sink.requestAttach()
    }
  }

  applySnapshot(snap: Snapshot): void {
    const newest = this.buffered.reduce((m, [, , g]) => Math.max(m, g), 0)
    if (newest > snap.gen) {
      // A resposta é de um processo que já foi substituído: descarta e refaz.
      this.buffered = this.buffered.filter(([, , g]) => g >= newest)
      this.sink.reset()
      this.sink.requestAttach()
      return
    }
    this.gen = snap.gen
    this.lastSeq = snap.seq
    this.sink.write(snap.data)
    const pending = this.buffered
    this.buffered = []
    for (const [data, seq, gen] of pending) {
      if (gen === this.gen && seq > this.lastSeq) {
        this.lastSeq = seq
        this.sink.write(data)
      }
    }
    this.ready = true
  }
}
