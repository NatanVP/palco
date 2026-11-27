import { isPortalPartition, PORTAL_PARTITION, validUserAgent } from '../shared/portal-settings'

/** Política de URLs do renderer: só o documento do app (arquivo empacotado ou origem do servidor de dev). */
export function createUrlPolicy(opts: { indexFileUrl: string; devUrl?: string }): (url: string) => boolean {
  const dev = opts.devUrl ? safeUrl(opts.devUrl) : null
  const index = safeUrl(opts.indexFileUrl)
  return (url) => {
    const u = safeUrl(url)
    if (!u) return false
    if (dev) return u.origin === dev.origin && u.protocol === dev.protocol
    return !!index && u.protocol === 'file:' && u.pathname === index.pathname && u.host === index.host
  }
}

function safeUrl(s: string): URL | null {
  try {
    return new URL(s)
  } catch {
    return null
  }
}

/** Partição global do portal: sessão persistente, separada da sessão do app. */
export { PORTAL_PARTITION } from '../shared/portal-settings'

/** Páginas que o portal pode abrir (e que os agentes podem pedir): só http, https e file. */
export function isPortalUrl(url: string): boolean {
  const u = safeUrl(url)
  return u !== null && (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:')
}

/**
 * Navegação de dentro da página (clique, redirecionamento, iframe): só http, https e file, e `file://` só quando a página
 * atual já é local (ou ainda em branco). Um site remoto nunca leva o portal para um arquivo do disco.
 */
export function allowGuestNavigation(currentUrl: string, nextUrl: string): boolean {
  if (!isPortalUrl(nextUrl)) return false
  const next = safeUrl(nextUrl)
  if (next?.protocol !== 'file:') return true
  if (currentUrl === '' || currentUrl === 'about:blank') return true
  return safeUrl(currentUrl)?.protocol === 'file:'
}

/**
 * Política do `will-attach-webview`: o convidado nunca recebe preload nem Node, usa uma partição de portal
 * (a pedida pelo nó, se for uma de portal; senão a global) e só começa em http, https, file ou `about:blank` (a página inicial de um portal novo).
 * Altera `webPreferences` e `params` no lugar; devolve false quando o webview deve ser recusado.
 */
export function enforceWebviewPolicy(webPreferences: Record<string, unknown>, params: Record<string, unknown>): boolean {
  const src = typeof params.src === 'string' ? params.src : ''
  if (src !== 'about:blank' && !isPortalUrl(src)) return false
  delete webPreferences.preload
  delete webPreferences.preloadURL
  delete params.preload
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  if (!isPortalPartition(params.partition)) params.partition = PORTAL_PARTITION
  // O agente de usuário vem do atributo do webview: o main só aceita o que o nó aceitaria (uma linha imprimível, até 512).
  if (params.useragent !== undefined && (!validUserAgent(params.useragent) || params.useragent.trim() === '')) delete params.useragent
  return true
}
