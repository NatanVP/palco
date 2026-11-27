/** Configuração de um portal: endereço, nome, agente de usuário e armazenamento (diálogo Novo Portal e Editar portal). */

/** Onde ficam cookies, cache e dados locais do portal. */
export type PortalStorage = 'isolated' | 'workspace' | 'global'
export const PORTAL_STORAGES: readonly PortalStorage[] = ['isolated', 'workspace', 'global']
export const PORTAL_STORAGE_LABEL: Record<PortalStorage, string> = { isolated: 'Isolado', workspace: 'Workspace', global: 'Global' }
export const PORTAL_STORAGE_HINT: Record<PortalStorage, string> = {
  isolated: 'Só este portal: login e dados não se misturam com os outros.',
  workspace: 'Compartilhado pelos portais deste workspace que também usam Workspace.',
  global: 'Compartilhado por todos os portais em Global, em qualquer workspace.'
}

/** Partição persistente do armazenamento Global e dos portais sem escolha explícita. */
export const PORTAL_PARTITION = 'persist:palco-portal'

/** Partição Electron do portal: por portal, por workspace ou a global. */
export function portalPartitionFor(storage: PortalStorage | undefined, nodeId: string, workspaceId: string): string {
  if (storage === 'isolated') return `persist:portal-${nodeId}`
  if (storage === 'workspace') return `persist:portal-ws-${workspaceId}`
  return PORTAL_PARTITION
}

/** Só partições de portal: nunca a sessão do app nem um nome qualquer vindo do renderer. */
export function isPortalPartition(p: unknown): p is string {
  return typeof p === 'string' && (p === PORTAL_PARTITION || /^persist:portal-[A-Za-z0-9_-]{1,80}$/.test(p))
}

export const MAX_PORTAL_NAME = 120
export const MAX_USER_AGENT = 512

/** Nome opcional: aparado; vazio vira "Portal"; repetido (sem diferenciar maiúsculas) ganha " 2", " 3"... */
export function uniquePortalName(input: string, existing: readonly string[]): string {
  const base = input.trim().slice(0, MAX_PORTAL_NAME) || 'Portal'
  const taken = new Set(existing.map((n) => n.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`
    const name = `${base.slice(0, MAX_PORTAL_NAME - suffix.length)}${suffix}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

const isLocalHost = (host: string): boolean =>
  host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]'

/** Rede local: faixas privadas (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10), `*.local` e nome sem ponto (`nas`). Servidor de desenvolvimento aí quase nunca tem TLS. */
const isPrivateHost = (host: string): boolean => {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2])
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  if (host.startsWith('[')) return /^\[(f[cd][0-9a-f]{2}|fe80):/.test(host)
  return host.endsWith('.local') || !host.includes('.')
}

/**
 * Endereço do diálogo: vazio abre a página em branco; caminho absoluto vira file://; sem esquema ganha https,
 * ou http para localhost, loopback e rede local. Só http, https e file passam.
 */
export function normalizePortalInput(input: string): string | null {
  const text = input.trim()
  if (text === '') return 'about:blank'
  let candidate: string
  if (text.startsWith('/')) candidate = `file://${text}`
  else if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+(\/|$)/.test(text)) candidate = text
  else {
    let host: string
    try { host = new URL(`http://${text}`).hostname.toLowerCase() } catch { return null }
    candidate = `${isLocalHost(host) || isPrivateHost(host) ? 'http' : 'https'}://${text}`
  }
  try {
    const u = new URL(candidate)
    if (u.protocol === 'file:') return u.href
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '' ? u.href : null
  } catch {
    return null
  }
}

export interface UserAgentPreset { label: string; ua: string }
export interface UserAgentGroup { group: 'Computador' | 'Celular'; items: UserAgentPreset[] }

/** Firefox não segue a versão do Chromium; esta é a declarada nos presets dele. */
const FIREFOX = 145

/**
 * Identidades prontas, montadas com a versão do Chromium instalado. Mudam só o que o site lê:
 * o motor continua sendo o Chromium (não há emulação de tela nem de toque).
 */
export function userAgentPresets(chromeMajor: number): UserAgentGroup[] {
  const v = `${chromeMajor}.0.0.0`
  const chrome = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`
  const chromeAndroid = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36`
  return [
    { group: 'Computador', items: [
      { label: 'Chrome', ua: chrome },
      { label: 'Firefox', ua: `Mozilla/5.0 (X11; Linux x86_64; rv:${FIREFOX}.0) Gecko/20100101 Firefox/${FIREFOX}.0` },
      { label: 'Microsoft Edge', ua: `${chrome} Edg/${v}` }
    ] },
    { group: 'Celular', items: [
      { label: 'Safari (iPhone)', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' },
      { label: 'Chrome (Android)', ua: chromeAndroid },
      { label: 'Firefox (Android)', ua: `Mozilla/5.0 (Android 14; Mobile; rv:${FIREFOX}.0) Gecko/${FIREFOX}.0 Firefox/${FIREFOX}.0` },
      { label: 'Microsoft Edge (Android)', ua: `${chromeAndroid} EdgA/${v}` }
    ] }
  ]
}

/** Versão principal do Chromium a partir do user agent do próprio app (fallback razoável). */
export function chromeMajorOf(ua: string): number {
  const m = /Chrome\/(\d+)/.exec(ua)
  return m ? Number(m[1]) : 140
}

/** Agente de usuário válido: uma linha, caracteres imprimíveis, até 512. */
export function validUserAgent(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_USER_AGENT && /^[\x20-\x7e]*$/.test(v)
}
