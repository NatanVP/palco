/** Campos opcionais de aparência e comportamento do terminal (diálogo Novo Terminal). */
import { validateEnvironment } from '../../shared/environment'
import { isValidAppearanceField } from '../../shared/appearance'
export const TERMINAL_EXTRAS = ['themeId', 'darkThemeId', 'fontFamily', 'chatFontFamily', 'chatFontSize', 'environment', 'accountId', 'color', 'icon', 'fontSize', 'monitor', 'maestro', 'chatMode', 'chatShowsShell'] as const

const valid: Record<(typeof TERMINAL_EXTRAS)[number], (v: unknown) => boolean> = {
  accountId: (v) => typeof v === 'string' && v.trim() !== '' && v.length <= 200,
  color: (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v),
  // Nome de ícone lucide (kebab-case) ou um emoji (poucos code points).
  icon: (v) => typeof v === 'string' && v.trim() !== '' && (/^[a-z0-9-]{1,48}$/.test(v) || [...v].length <= 8),
  fontSize: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 8 && v <= 40,
  monitor: (v) => typeof v === 'boolean',
  // Onde o terminal roda (local, tmux, SSH, Docker, Sandbox): validado com as regras de host/usuário/contêiner.
  themeId: (v) => isValidAppearanceField('themeId', v), darkThemeId: (v) => isValidAppearanceField('darkThemeId', v),
  fontFamily: (v) => isValidAppearanceField('fontFamily', v), chatFontFamily: (v) => isValidAppearanceField('chatFontFamily', v), chatFontSize: (v) => isValidAppearanceField('chatFontSize', v),
  environment: (v) => { try { validateEnvironment(v); return true } catch { return false } },
  maestro: (v) => typeof v === 'boolean',
  chatMode: (v) => typeof v === 'boolean',
  chatShowsShell: (v) => typeof v === 'boolean'
}

/** Nomes dos campos extras presentes e inválidos (o IPC recusa; o schema remove com aviso). */
export function invalidTerminalExtras(o: Record<string, unknown>): string[] {
  return TERMINAL_EXTRAS.filter((k) => o[k] !== undefined && !valid[k](o[k]))
}

/** Só os campos extras presentes (já validados por quem chama). */
export function pickTerminalExtras(o: Record<string, unknown>): Partial<Record<(typeof TERMINAL_EXTRAS)[number], never>> {
  // O ambiente é regravado normalizado (só os campos do tipo; porta padrão 22): nada além do validado chega ao arquivo.
  return Object.fromEntries(TERMINAL_EXTRAS.filter((k) => o[k] !== undefined).map((k) => [k, k === 'environment' ? validateEnvironment(o[k]) : o[k]])) as never
}

/** Role (instruções de sistema) só existe para Claude e Codex. */
export const takesRole = (agent: unknown): boolean => agent === 'claude' || agent === 'codex'
