import type { Session, WebContents } from 'electron'

/** Quanto tempo vale o pedido do usuário para abrir o microfone. */
const ARMED_MS = 15_000

/** O microfone só abre logo depois de o app pedir (o usuário clicou ou usou o atalho). */
export class MicGate {
  private until = 0
  constructor(private readonly now: () => number = Date.now) {}
  arm(): void { this.until = this.now() + ARMED_MS }
  open(): boolean { return this.now() <= this.until }
}

export interface MicApp { gate: MicGate; isApp(contents: WebContents | null): boolean; isTrustedUrl(url: string): boolean }

const CAPTURE = new Set(['media', 'display-capture'])
/** Acesso a aparelhos: sem controle próprio o Electron já nega a consulta; continua negado. */
const DEVICES = new Set(['serial', 'hid', 'usb'])

/**
 * Sem controle, o Electron aprova qualquer permissão. Aqui a captura fica fechada: só a janela do app, só áudio e só com o
 * portão aberto. Sessões de portal (`app === null`) nunca usam microfone, câmera nem captura de tela. O resto segue como era.
 */
export function installMicPolicy(session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>, app: MicApp | null): void {
  const allowed = (contents: WebContents | null, url: string, types: readonly string[]): boolean =>
    app !== null && app.isApp(contents) && app.isTrustedUrl(url) && app.gate.open() && types.length > 0 && types.every((t) => t === 'audio')
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!CAPTURE.has(permission)) { callback(true); return }
    const { requestingUrl, mediaTypes } = details as { requestingUrl?: string; mediaTypes?: string[] }
    callback(permission === 'media' && allowed(contents, requestingUrl ?? '', mediaTypes ?? []))
  })
  session.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (!CAPTURE.has(permission)) return !DEVICES.has(permission)
    const { requestingUrl, mediaType } = details as { requestingUrl?: string; mediaType?: string }
    return permission === 'media' && allowed(contents, requestingUrl ?? origin, mediaType ? [mediaType] : [])
  })
}
