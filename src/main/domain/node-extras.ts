import { NOTE_FONT_FAMILIES } from '../../shared/model'
import { PORTAL_STORAGES, validUserAgent } from '../../shared/portal-settings'

/** Campos opcionais da nota (barra contextual): cor do cartão, fonte, trava e fichário. */
export const NOTE_EXTRAS = ['color', 'fontSize', 'fontFamily', 'locked', 'stackId', 'nameFixed', 'render'] as const
/** Campos opcionais do portal: moldura (barra de endereço) oculta, agente de usuário e armazenamento. */
export const PORTAL_EXTRAS = ['chromeHidden', 'userAgent', 'storage'] as const

export const NOTE_FONT_MIN = 10
export const NOTE_FONT_MAX = 32

const valid: Record<(typeof NOTE_EXTRAS)[number] | (typeof PORTAL_EXTRAS)[number], (v: unknown) => boolean> = {
  color: (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v),
  fontSize: (v) => typeof v === 'number' && Number.isInteger(v) && v >= NOTE_FONT_MIN && v <= NOTE_FONT_MAX,
  fontFamily: (v) => typeof v === 'string' && (NOTE_FONT_FAMILIES as readonly string[]).includes(v),
  locked: (v) => typeof v === 'boolean',
  // Id de fichário: curto e sem separadores de caminho (vira chave no renderer).
  stackId: (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v),
  chromeHidden: (v) => typeof v === 'boolean',
  userAgent: (v) => validUserAgent(v) && v.trim() !== '',
  storage: (v) => (PORTAL_STORAGES as readonly unknown[]).includes(v),
  nameFixed: (v) => typeof v === 'boolean',
  render: (v) => v === 'markdown' || v === 'raw'
}

export const validExtra = (key: string, v: unknown): boolean => (valid as Record<string, (v: unknown) => boolean>)[key]?.(v) === true

/** Campos extras presentes e inválidos do nó (o schema remove com aviso). */
export function invalidNodeExtras(kind: unknown, o: Record<string, unknown>): string[] {
  const keys: readonly string[] = kind === 'note' ? NOTE_EXTRAS : kind === 'portal' ? PORTAL_EXTRAS : []
  return keys.filter((k) => o[k] !== undefined && !validExtra(k, o[k]))
}

/** "Abrir no navegador": só http e https vão para o navegador do sistema. */
export function parseExternalUrl(v: unknown): string {
  if (typeof v !== 'string' || v.length > 4096) throw new Error('endereço inválido')
  let url: URL
  try { url = new URL(v.trim()) } catch { throw new Error('endereço inválido') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('só endereços http e https abrem no navegador')
  return url.href
}
