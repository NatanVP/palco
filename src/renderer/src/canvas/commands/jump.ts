const DOUBLE_TAP_MS = 400, ARMED_MS = 2000
/**
 * "Modificador para pular ao espaço de trabalho": dois toques no modificador armam o salto; o número seguinte (1–9), dentro de 2 s,
 * escolhe o espaço de trabalho e desarma. Número fora de alcance (maior que a quantidade) não faz nada.
 */
export class WorkspaceJumpArm {
  private lastTap = -Infinity
  private armedAt = -Infinity
  tap(now: number): void {
    if (now - this.lastTap <= DOUBLE_TAP_MS) { this.armedAt = now; this.lastTap = -Infinity } else this.lastTap = now
  }
  armed(now: number): boolean { return now - this.armedAt <= ARMED_MS }
  /** Índice (base zero) do espaço escolhido, ou null. */
  digit(now: number, n: number): number | null {
    if (!this.armed(now) || n < 1) return null
    this.armedAt = -Infinity
    return n - 1
  }
}
