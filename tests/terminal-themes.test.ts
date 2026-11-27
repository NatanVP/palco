import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultPreferences, validatePreferences } from '../src/shared/preferences'
import { THEMES, isLightTheme, resolveTerminalTheme, toXtermTheme } from '../src/shared/terminal-themes'
import { findOverLimit, MemoryGuard } from '../src/main/pty/memory-guard'
import { AgentCatalog, PresetStore, BUILTIN_PRESETS } from '../src/main/agents/presets'
import { RoleStore } from '../src/main/agents/roles'

describe('temas do terminal (17, com as paletas do palco)', () => {
  it('são 17 temas com 16 cores ANSI cada e ids únicos; as duas bases vêm primeiro', () => {
    expect(THEMES).toHaveLength(17)
    expect(new Set(THEMES.map(t => t.id)).size).toBe(17)
    expect(THEMES.slice(0, 2).map(t => t.id)).toEqual(['palco-dark', 'palco-light'])
    for (const t of THEMES) { expect(t.colors.ansiPalette, t.id).toHaveLength(16); expect(t.colors.background).toMatch(/^#[0-9a-fA-F]{6}$/) }
    expect(THEMES.find(t => t.id === 'dracula')!.colors.background.toLowerCase()).toBe('#282a36')
    expect(THEMES.find(t => t.id === 'catppuccin-latte')!.colors.ansiPalette[1]).toMatch(/^#/)
  })
  it('claro ou escuro pela luminância do fundo', () => {
    expect(isLightTheme(THEMES.find(t => t.id === 'palco-light')!)).toBe(true)
    expect(isLightTheme(THEMES.find(t => t.id === 'solarized-light')!)).toBe(true)
    expect(isLightTheme(THEMES.find(t => t.id === 'nord')!)).toBe(false)
    expect(THEMES.filter(isLightTheme).map(t => t.id)).toEqual(['palco-light', 'catppuccin-latte', 'tokyo-night-day', 'gruvbox-light', 'solarized-light', 'rose-pine-dawn'])
  })
  it('Sistema, Escuro e Claro resolvem para as bases; id inválido cai na base escura', () => {
    const r = (theme: string, dark: string | null, light: boolean) => resolveTerminalTheme({ defaultTerminalTheme: theme, defaultTerminalDarkThemeId: dark }, light).id
    expect(r('system', null, false)).toBe('palco-dark'); expect(r('system', null, true)).toBe('palco-light')
    expect(r('', null, true)).toBe('palco-light'); expect(r('default', null, false)).toBe('palco-dark')
    expect(r('dark', null, true)).toBe('palco-dark'); expect(r('light', null, false)).toBe('palco-light')
    expect(r('dracula', null, true)).toBe('dracula')
    expect(r('nao-existe', null, true)).toBe('palco-dark')
  })
  it('com par, o tema escuro só vale na aparência escura e o outro na clara', () => {
    const pair = { defaultTerminalTheme: 'gruvbox-light', defaultTerminalDarkThemeId: 'gruvbox-dark' }
    expect(resolveTerminalTheme(pair, false).id).toBe('gruvbox-dark')
    expect(resolveTerminalTheme(pair, true).id).toBe('gruvbox-light')
  })
  it('vira tema do xterm: 16 cores nos campos certos, cursorAccent cai para o fundo e seleção sem frente fica de fora', () => {
    const x = toXtermTheme(THEMES[0]!)
    expect(x).toMatchObject({ background: '#1A1A1E', foreground: '#E5E5EB', cursor: '#E5E5EB', cursorAccent: '#1A1A1E', black: '#1A1A1E', red: '#FF453A', brightWhite: '#F5F5F7', selectionBackground: '#0A84FF4D' })
    expect(x.selectionForeground).toBeUndefined()
    expect(toXtermTheme(THEMES.find(t => t.id === 'dracula')!).selectionForeground).toBe('#ffffff')
  })
  it('as preferências aceitam Escuro, Claro e o id de qualquer tema', () => {
    for (const v of ['system', 'dark', 'light', 'tokyo-night']) expect(validatePreferences({ defaultTerminalTheme: v }).defaultTerminalTheme).toBe(v)
    expect(() => validatePreferences({ defaultTerminalTheme: 'Tema Ruim!' })).toThrow()
  })
})

describe('fonte e espaçamento', () => {
  it('tamanho da fonte do terminal vai de 8 a 32', () => {
    expect(validatePreferences({ terminalFontSize: 32 }).terminalFontSize).toBe(32)
    expect(() => validatePreferences({ terminalFontSize: 33 })).toThrow()
    expect(() => validatePreferences({ terminalFontSize: 7 })).toThrow()
  })
  it('mexer no espaçamento horizontal desliga a herança do sistema; o vertical não', () => {
    expect(validatePreferences({ terminalPaddingHorizontal: 4 }).usesSystemHorizontalTerminalPadding).toBe(false)
    expect(validatePreferences({ terminalPaddingVertical: 4 }).usesSystemHorizontalTerminalPadding).toBe(true)
    expect(defaultPreferences().usesSystemHorizontalTerminalPadding).toBe(true)
  })
})

describe('limite de memória por terminal', () => {
  const tree = [{ pid: 10, rssKB: 50_000 }, { pid: 11, rssKB: 900_000 }, { pid: 12, rssKB: 1_300_000 }]
  it('soma a árvore do terminal (shell + filhos) e só aponta quem passa do limite', () => {
    expect(findOverLimit([{ id: 't1', pids: tree }, { id: 't2', pids: [{ pid: 20, rssKB: 1000 }] }], 2048)).toEqual([{ id: 't1', usedMB: Math.round(2_250_000 / 1024) }])
    expect(findOverLimit([{ id: 't1', pids: tree }], 4096)).toEqual([])
  })
  it('encerra só os processos filhos: o shell (a raiz) continua vivo', () => {
    const killed: number[] = []
    const guard = new MemoryGuard({ limitMB: () => 2048, enabled: () => true, terminals: () => [{ id: 't1', pids: tree }], kill: pid => killed.push(pid) })
    guard.check()
    expect(killed.sort()).toEqual([11, 12]); expect(killed).not.toContain(10)
  })
  it('desligado não mede nem mata', () => {
    const killed: number[] = []
    new MemoryGuard({ limitMB: () => 1, enabled: () => false, terminals: () => [{ id: 't1', pids: tree }], kill: pid => killed.push(pid) }).check()
    expect(killed).toEqual([])
  })
  it('conta quantos terminais passam de um limite novo (para o aviso de Reduzir Limite)', () => {
    const guard = new MemoryGuard({ limitMB: () => 2048, enabled: () => true, terminals: () => [{ id: 't1', pids: tree }], kill: () => {} })
    expect(guard.countAbove(1024)).toBe(1); expect(guard.countAbove(4096)).toBe(0)
  })
})

describe('presets do Início Rápido', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
  let roles!: RoleStore
  const store = (): PresetStore => { const d = mkdtempSync(join(tmpdir(), 'palco-pre-')); dirs.push(d); roles = new RoleStore(join(d, 'roles')); return new PresetStore(join(d, 'presets.json'), roles) }
  it('reordena pela lista de nomes e recusa nome que sobra ou falta', () => {
    const s = store(); s.create({ name: 'A', command: 'claude' }); s.create({ name: 'B', command: 'codex' }); s.create({ name: 'C', command: '' })
    s.reorder(['C', 'A', 'B']); expect(s.list().map(p => p.name)).toEqual(['C', 'A', 'B'])
    expect(() => s.reorder(['C', 'A'])).toThrow(); expect(() => s.reorder(['C', 'A', 'X'])).toThrow()
  })
  it('restaura os embutidos que faltam sem mexer nos existentes', () => {
    const s = store(); expect(BUILTIN_PRESETS.length).toBeGreaterThan(0)
    s.create({ name: BUILTIN_PRESETS[0]!.name, command: BUILTIN_PRESETS[0]!.command, quickStart: false })
    s.restoreDefaults()
    const names = s.list().map(p => p.name)
    for (const b of BUILTIN_PRESETS) expect(names).toContain(b.name)
    expect(s.list().find(p => p.name === BUILTIN_PRESETS[0]!.name)?.quickStart).toBe(false)
    expect(s.missingDefaults()).toEqual([])
  })
  it('no máximo 10 ativos: o 11º que for ligado é recusado', () => {
    const s = store()
    for (let i = 0; i < 11; i++) s.create({ name: `P${i}`, command: 'claude', quickStart: i < 10 })
    expect(() => s.set('P10', { quickStart: true })).toThrow(/10/)
    s.set('P0', { quickStart: false }); expect(s.set('P10', { quickStart: true }).quickStart).toBe(true)
  })
  it('AgentCatalog continua recrutando por preset', () => { const s = store(); s.create({ name: 'X', command: 'claude' }); expect(new AgentCatalog(s, roles).recruit({ preset: 'X' }).agent).toBe('claude') })
})
