/** Erro com status HTTP lançado pelas rotas em módulo próprio (rotinas, workspaces); o servidor responde com ele. */
export class RouteError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** Mensagem única de "precisa do Maestro" (skills palco-routines, palco-workspace e palco-manager). */
export const NOT_MAESTRO = 'este terminal não é o Maestro: este comando exige o Modo Maestro. Peça ao usuário para ligar o Maestro neste terminal pelo canvas.'

export function requireMaestro(caller: { maestro?: boolean }): void {
  if (caller.maestro !== true) throw new RouteError(403, NOT_MAESTRO)
}
