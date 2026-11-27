/**
* Paletas dos 17 temas do terminal: duas bases e 15 temas nomeados, sem lógica de apresentação.
* A ordem das 16 cores ANSI é a do xterm: preto, vermelho, verde, amarelo, azul, magenta, ciano, branco e as versões brilhantes.
*/
export interface TerminalThemeColors {
  background: string; foreground: string; cursor: string; cursorText: string | null
  selectionBackground: string; selectionForeground: string | null; selectionInactiveBackground?: string
  ansiPalette: readonly string[]
}
export interface TerminalTheme { id: string; name: string; colors: TerminalThemeColors }

export const THEMES: readonly TerminalTheme[] = [
  { id: "palco-dark", name: "Base Escuro", colors: {"background": "#1A1A1E", "foreground": "#E5E5EB", "cursor": "#E5E5EB", "cursorText": null, "selectionBackground": "#0A84FF4D", "selectionForeground": null, "selectionInactiveBackground": "#0A84FF33", "ansiPalette": ["#1A1A1E", "#FF453A", "#32D74B", "#FFD60A", "#0A84FF", "#BF5AF2", "#64D2FF", "#E5E5EA", "#48484A", "#FF6961", "#5AF78E", "#FFE066", "#409CFF", "#DA8FFF", "#8BE9FD", "#F5F5F7"]} },
  { id: "palco-light", name: "Base Claro", colors: {"background": "#FFFFFF", "foreground": "#1D1D1F", "cursor": "#1D1D1F", "cursorText": null, "selectionBackground": "#007AFF4D", "selectionForeground": null, "selectionInactiveBackground": "#007AFF33", "ansiPalette": ["#1D1D1F", "#C41A16", "#007400", "#826B28", "#0451A5", "#A831C4", "#0F7B8D", "#E5E5EA", "#86868B", "#EB3B36", "#23A13A", "#B09825", "#2C6EC4", "#C14FE0", "#1A9AAE", "#FFFFFF"]} },
  { id: "dracula", name: "Dracula", colors: {"background": "#282a36", "foreground": "#f8f8f2", "cursor": "#f8f8f2", "cursorText": "#282a36", "selectionBackground": "#44475a", "selectionForeground": "#ffffff", "ansiPalette": ["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2", "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff"]} },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", colors: {"background": "#1e1e2e", "foreground": "#cdd6f4", "cursor": "#f5e0dc", "cursorText": "#1e1e2e", "selectionBackground": "#585b70", "selectionForeground": "#cdd6f4", "ansiPalette": ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8", "#585b70", "#f37799", "#89d88b", "#ebd391", "#74a8fc", "#f2aede", "#6bd7ca", "#bac2de"]} },
  { id: "catppuccin-macchiato", name: "Catppuccin Macchiato", colors: {"background": "#24273a", "foreground": "#cad3f5", "cursor": "#f4dbd6", "cursorText": "#24273a", "selectionBackground": "#5b6078", "selectionForeground": "#cad3f5", "ansiPalette": ["#494d64", "#ed8796", "#a6da95", "#eed49f", "#8aadf4", "#f5bde6", "#8bd5ca", "#a5adcb", "#5b6078", "#ec7486", "#8ccf7f", "#e1c682", "#78a1f6", "#f2a9dd", "#63cbc0", "#b8c0e0"]} },
  { id: "catppuccin-latte", name: "Catppuccin Latte", colors: {"background": "#eff1f5", "foreground": "#4c4f69", "cursor": "#dc8a78", "cursorText": "#eff1f5", "selectionBackground": "#acb0be", "selectionForeground": "#4c4f69", "ansiPalette": ["#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#acb0be", "#6c6f85", "#de293e", "#49af3d", "#eea02d", "#456eff", "#fe85d8", "#2d9fa8", "#bcc0cc"]} },
  { id: "tokyo-night", name: "Tokyo Night", colors: {"background": "#1a1b26", "foreground": "#c0caf5", "cursor": "#c0caf5", "cursorText": "#15161e", "selectionBackground": "#33467c", "selectionForeground": "#c0caf5", "ansiPalette": ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6", "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"]} },
  { id: "tokyo-night-day", name: "Tokyo Night Day", colors: {"background": "#e1e2e7", "foreground": "#3760bf", "cursor": "#3760bf", "cursorText": "#e1e2e7", "selectionBackground": "#99a7df", "selectionForeground": "#3760bf", "ansiPalette": ["#e9e9ed", "#f52a65", "#587539", "#8c6c3e", "#2e7de9", "#9854f1", "#007197", "#6172b0", "#a1a6c5", "#f52a65", "#587539", "#8c6c3e", "#2e7de9", "#9854f1", "#007197", "#3760bf"]} },
  { id: "gruvbox-dark", name: "Gruvbox Dark", colors: {"background": "#282828", "foreground": "#ebdbb2", "cursor": "#ebdbb2", "cursorText": "#282828", "selectionBackground": "#665c54", "selectionForeground": "#ebdbb2", "ansiPalette": ["#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984", "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2"]} },
  { id: "gruvbox-light", name: "Gruvbox Light", colors: {"background": "#fbf1c7", "foreground": "#3c3836", "cursor": "#3c3836", "cursorText": "#fbf1c7", "selectionBackground": "#3c3836", "selectionForeground": "#fbf1c7", "ansiPalette": ["#fbf1c7", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#7c6f64", "#928374", "#9d0006", "#79740e", "#b57614", "#076678", "#8f3f71", "#427b58", "#3c3836"]} },
  { id: "nord", name: "Nord", colors: {"background": "#2e3440", "foreground": "#d8dee9", "cursor": "#eceff4", "cursorText": "#282828", "selectionBackground": "#eceff4", "selectionForeground": "#4c566a", "ansiPalette": ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0", "#596377", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4"]} },
  { id: "one-dark", name: "One Dark", colors: {"background": "#21252b", "foreground": "#abb2bf", "cursor": "#abb2bf", "cursorText": "#21252b", "selectionBackground": "#323844", "selectionForeground": "#abb2bf", "ansiPalette": ["#21252b", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf", "#767676", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf"]} },
  { id: "solarized-dark", name: "Solarized Dark", colors: {"background": "#001e27", "foreground": "#708284", "cursor": "#708284", "cursorText": "#002831", "selectionBackground": "#002831", "selectionForeground": "#819090", "ansiPalette": ["#002831", "#d11c24", "#738a05", "#a57706", "#2176c7", "#c61c6f", "#259286", "#eae3cb", "#475b62", "#bd3613", "#475b62", "#536870", "#708284", "#5956ba", "#819090", "#fcf4dc"]} },
  { id: "solarized-light", name: "Solarized Light", colors: {"background": "#fdf6e3", "foreground": "#657b83", "cursor": "#657b83", "cursorText": "#eee8d5", "selectionBackground": "#eee8d5", "selectionForeground": "#586e75", "ansiPalette": ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#bbb5a2", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"]} },
  { id: "rose-pine", name: "Rosé Pine", colors: {"background": "#191724", "foreground": "#e0def4", "cursor": "#e0def4", "cursorText": "#191724", "selectionBackground": "#403d52", "selectionForeground": "#e0def4", "ansiPalette": ["#26233a", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4", "#6e6a86", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4"]} },
  { id: "rose-pine-dawn", name: "Rosé Pine Dawn", colors: {"background": "#faf4ed", "foreground": "#575279", "cursor": "#575279", "cursorText": "#faf4ed", "selectionBackground": "#dfdad9", "selectionForeground": "#575279", "ansiPalette": ["#f2e9e1", "#b4637a", "#286983", "#ea9d34", "#56949f", "#907aa9", "#d7827e", "#575279", "#9893a5", "#b4637a", "#286983", "#ea9d34", "#56949f", "#907aa9", "#d7827e", "#575279"]} },
  { id: "everforest", name: "Everforest", colors: {"background": "#1e2326", "foreground": "#d3c6aa", "cursor": "#e69875", "cursorText": "#4c3743", "selectionBackground": "#4c3743", "selectionForeground": "#d3c6aa", "ansiPalette": ["#7a8478", "#e67e80", "#a7c080", "#dbbc7f", "#7fbbb3", "#d699b6", "#83c092", "#f2efdf", "#a6b0a0", "#f85552", "#8da101", "#dfa000", "#3a94c5", "#df69ba", "#35a77c", "#fffbef"]} }
]

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Tema claro: fundo com luminância acima de 0,5. */
export const isLightTheme = (t: TerminalTheme): boolean => luminance(t.colors.background) > 0.5
export const themeById = (id: string): TerminalTheme | undefined => THEMES.find(t => t.id === id)

/**
 * Tema que vale agora. `system`, vazio e `default` seguem a aparência; `dark` e `light` são as duas bases. Com par
 * (`defaultTerminalDarkThemeId`), o tema escuro só vale na aparência escura e `defaultTerminalTheme` na clara.
 * Id desconhecido cai na base escura.
 */
export function resolveTerminalTheme(p: { defaultTerminalTheme: string; defaultTerminalDarkThemeId: string | null }, appearanceIsLight: boolean): TerminalTheme {
  const base = (light: boolean): TerminalTheme => THEMES[light ? 1 : 0]!
  if (p.defaultTerminalDarkThemeId && !appearanceIsLight) return themeById(p.defaultTerminalDarkThemeId) ?? base(false)
  const id = p.defaultTerminalTheme
  if (id === '' || id === 'system' || id === 'default') return base(appearanceIsLight)
  if (id === 'dark') return base(false)
  if (id === 'light') return base(true)
  return themeById(id) ?? base(false)
}

const XTERM_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const
/** Tema do xterm: cursorAccent cai para o fundo; seleção sem cor de frente deixa a do texto. */
export function toXtermTheme(t: TerminalTheme): Record<string, string | undefined> {
  const c = t.colors
  return {
    background: c.background, foreground: c.foreground, cursor: c.cursor, cursorAccent: c.cursorText ?? c.background,
    selectionBackground: c.selectionBackground, ...(c.selectionForeground ? { selectionForeground: c.selectionForeground } : {}),
    ...(c.selectionInactiveBackground ? { selectionInactiveBackground: c.selectionInactiveBackground } : {}),
    ...Object.fromEntries(XTERM_NAMES.map((n, i) => [n, c.ansiPalette[i]]))
  }
}
