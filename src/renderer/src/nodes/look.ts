import type { TerminalNode } from '../../../shared/model'
import type { Preferences } from '../../../shared/preferences'
import { resolveTerminalTheme, type TerminalTheme } from '../../../shared/terminal-themes'

/** Fonte e tema do terminal: os do nó (vindos do preset ou do Editar) ganham dos globais. */
export function terminalLook(node: Pick<TerminalNode, 'fontFamily' | 'fontSize' | 'themeId' | 'darkThemeId'>, p: Pick<Preferences, 'terminalFontFamily' | 'terminalFontSize' | 'defaultTerminalTheme' | 'defaultTerminalDarkThemeId'>, appearanceIsLight: boolean): { fontFamily: string; fontSize: number; theme: TerminalTheme } {
  const own = node.themeId !== undefined
  return {
    fontFamily: node.fontFamily ?? p.terminalFontFamily, fontSize: node.fontSize ?? p.terminalFontSize,
    theme: resolveTerminalTheme(own ? { defaultTerminalTheme: node.themeId!, defaultTerminalDarkThemeId: node.darkThemeId ?? null } : p, appearanceIsLight)
  }
}
export function chatLook(node: Pick<TerminalNode, 'chatFontFamily' | 'chatFontSize'>, p: Pick<Preferences, 'chatFontFamily' | 'chatFontSize'>): { fontFamily: string; fontSize: number } {
  return { fontFamily: node.chatFontFamily ?? p.chatFontFamily, fontSize: node.chatFontSize ?? p.chatFontSize }
}
