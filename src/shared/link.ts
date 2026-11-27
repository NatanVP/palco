/** Cartão de link: só endereços da web. */
const parse = (url: string): URL | null => { try { return new URL(url) } catch { return null } }
export function isWebUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(url)) return false
  const parsed = parse(url)
  return parsed !== null && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== ''
}
/** O título do cartão: o nome do servidor. */
export const linkHost = (url: string): string => parse(url)?.hostname || url
/** A linha de baixo: servidor e caminho. */
export function linkText(url: string): string {
  const parsed = parse(url)
  if (!parsed?.hostname) return url
  return parsed.pathname === '/' ? parsed.hostname : parsed.hostname + parsed.pathname
}
