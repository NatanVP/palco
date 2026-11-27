import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultPreferences, validatePreferences } from '../src/shared/preferences'
import { PreferencesStore } from '../src/main/preferences/preferences-store'
import { writeEnvelopeAtomic } from '../src/main/domain/envelope'
import * as seam from '../src/main/ipc/area'
import { AREAS } from '../src/main/ipc/index'
import * as cut from '../src/renderer/src/canvas/connection-cut'
import { OPTIONS, ACTIONS } from '../src/renderer/src/settings/options'
import { SETTINGS_TABS } from '../src/renderer/src/settings/catalog'

const dirs: string[] = []
const file = () => { const d = mkdtempSync(join(tmpdir(), 'palco-preferences-')); dirs.push(d); return join(d, 'preferences.json') }
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))

describe('preferências: campos novos com os padrões do palco', () => {
  const d = defaultPreferences() as unknown as Record<string, unknown>
  it('Geral › Sistema, Tela e Notificações', () => {
    expect(d).toMatchObject({
      appLanguage: null, sleepPrevention: 'whileAgentsWork', confirmBeforeQuitting: false, resumeSessionsOnRelaunch: true, closeToTray: false,
      windowOpacity: 100, ropeRouting: 'avoidNodes', selectionIndicatorStyle: 'dashedBorder', cameraMovement: 'glide',
      focusNodeOnHover: false, rightDragPansCanvas: false, confirmFileDelete: true, zoomStepPercent: null, alwaysCopyAttachments: false,
      completionBadges: 'all', showAppIconBadge: true, flashTaskbarOnAttention: false, notifyOnTurnComplete: false,
      notifyOnAttention: true, notifyOnFloorStatus: true, notifyOnPullRequests: true
    })
  })
  it('Padrões de Novos Itens e Ambientes', () => {
    expect(d).toMatchObject({
      defaultNoteColor: 'yellow', defaultNoteRender: 'markdown', defaultNoteSize: { width: 260, height: 160 }, agentNotePlacement: 'stack',
      defaultNoteFontFamily: null, defaultNoteFontSize: 14, defaultTerminalSize: { width: 800, height: 500 },
      defaultPortalSize: { width: 800, height: 600 }, agentPortalPlacement: 'stack',
      fileEditorFontFamily: "Cascadia Mono, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace", fileEditorFontSize: 13, fileEditorTabWidth: 4, fileEditorRendersMarkdown: true,
      wslEnabled: true, sshEnabled: false, sshScriptPath: '~/.palco/bin/palco', sshAddToPath: true, dockerEnabled: false, sandboxEnabled: false, localTmuxEnabled: false, tunnelPort: 7433
    })
  })
  it('Terminal e Agentes', () => {
    expect(d).toMatchObject({
      defaultTerminalTheme: 'system', defaultTerminalDarkThemeId: null, terminalPaddingHorizontal: 0, terminalPaddingVertical: 0,
      usesSystemHorizontalTerminalPadding: true, chatFontFamily: '', chatFontSize: 13, promptComposerFontSize: null,
      memoryLimitEnabled: false, memoryLimitMB: 2048, preferredShellPath: null, computerUseEnabled: false, computerUseBypassPermissions: false
    })
  })
  it('aceita valores válidos e recusa os inválidos de cada campo novo', () => {
    const ok = validatePreferences({ ropeRouting: 'circuit', windowOpacity: 90, zoomStepPercent: 10, defaultNoteSize: { width: 300, height: 200 }, memoryLimitMB: 4096, canvasBackground: 'transparent', appLanguage: 'pt-BR', preferredShellPath: '/bin/zsh', promptComposerFontSize: 16, tunnelPort: 8000 })
    expect(ok).toMatchObject({ ropeRouting: 'circuit', windowOpacity: 90, zoomStepPercent: 10, canvasBackground: 'transparent', appLanguage: 'pt-BR' })
    for (const bad of [{ ropeRouting: 'reta' }, { windowOpacity: 55 }, { zoomStepPercent: 1 }, { zoomStepPercent: 51 }, { defaultNoteSize: { width: 0, height: 100 } },
      { defaultNoteSize: [1, 2] }, { defaultNoteFontSize: 65 }, { fileEditorTabWidth: 3 }, { tunnelPort: 80 }, { tunnelPort: 70000 }, { memoryLimitMB: 10 },
      { promptComposerFontSize: 9 }, { chatFontSize: 33 }, { terminalPaddingHorizontal: 41 }, { terminalPaddingVertical: 3 }, { appLanguage: 'xx' },
      { sleepPrevention: 'sempre' }, { defaultNoteColor: 'rosa-choque' }, { sshScriptPath: '' }, { preferredShellPath: 'a'.repeat(5000) }, { completionBadges: 'x' }])
      expect(() => validatePreferences(bad), JSON.stringify(bad)).toThrow()
  })
  it('espaçamento: passo de 2 em 0–40; o horizontal mexido desliga a herança do sistema', () => {
    expect(validatePreferences({ terminalPaddingHorizontal: 8 }).usesSystemHorizontalTerminalPadding).toBe(false)
    expect(validatePreferences({ terminalPaddingVertical: 8 }).usesSystemHorizontalTerminalPadding).toBe(true)
  })
})

describe('migração v4', () => {
  it('arquivo v3 (só os campos antigos) ganha os campos novos nos padrões e passa a gravar v4', () => {
    const f = file()
    writeEnvelopeAtomic(f, 'preferences', 3, { appearance: 'light', terminalFontSize: 16, shortcuts: {} })
    const s = new PreferencesStore(f)
    expect(s.get()).toMatchObject({ appearance: 'light', terminalFontSize: 16, ropeRouting: 'avoidNodes', memoryLimitMB: 2048 })
    s.set({ cameraMovement: 'instant' })
    const saved = JSON.parse(readFileSync(f, 'utf8'))
    expect(saved.schemaVersion).toBe(4)
    expect(new PreferencesStore(f).get().cameraMovement).toBe('instant')
  })
  it('arquivo de versão futura continua somente leitura', () => {
    const f = file(); writeEnvelopeAtomic(f, 'preferences', 5, { appearance: 'light' })
    const s = new PreferencesStore(f)
    expect(() => s.set({ ropeRouting: 'circuit' })).toThrow(/somente leitura/)
  })
  it('campo novo inválido no arquivo é ignorado sem derrubar o resto', () => {
    const f = file(); writeEnvelopeAtomic(f, 'preferences', 4, { appearance: 'light', ropeRouting: 'reta' })
    const s = new PreferencesStore(f)
    expect(s.get()).toMatchObject({ appearance: 'light', ropeRouting: 'avoidNodes' })
    expect(s.warning).toMatch(/ropeRouting/)
  })
})

describe('registro do IPC por área', () => {
  it('registra cada área com os canais dela e a limpeza remove só esses canais', () => {
    const removed: string[] = [], handled: string[] = []
    const ctx = { handle: (c: string) => { handled.push(c) }, listen: vi.fn(), send: vi.fn(), deps: {} as never, removeChannel: (c: string) => removed.push(c) }
    const order: string[] = []
    const a: seam.IpcArea = (c) => { c.handle('palco:a:x', () => 1); order.push('a'); return () => order.push('off-a') }
    const b: seam.IpcArea = (c) => { c.handle('palco:b:y', () => 2); order.push('b') }
    const off = seam.registerAreas?.([a, b], ctx as never)
    expect(order).toEqual(['a', 'b']); expect(handled).toEqual(['palco:a:x', 'palco:b:y'])
    off?.()
    expect(removed.sort()).toEqual(['palco:a:x', 'palco:b:y']); expect(order).toContain('off-a')
  })
  it('a lista de áreas de IPC contém áreas registradas', () => {
    expect(AREAS.length).toBeGreaterThanOrEqual(1)
  })
})

describe('cortar corda entra no histórico', () => {
  it('cutConnections manda um lote connection.remove por corda, numa transação só', async () => {
    const commit = vi.fn(async () => [])
    await cut.cutConnections?.({ commit } as never, 'w1', ['a', 'b'])
    expect(commit).toHaveBeenCalledWith('w1', [{ type: 'connection.remove', id: 'a' }, { type: 'connection.remove', id: 'b' }])
    await cut.cutConnections?.({ commit } as never, 'w1', [])
    expect(commit).toHaveBeenCalledTimes(1)
  })
})

describe('inventário das opções', () => {
  it('as abas e sub-abas são as do palco', () => {
    const t = Object.fromEntries(SETTINGS_TABS.map(x => [x.label, x.sections]))
    expect(Object.keys(t)).toEqual(['Geral', 'Terminal', 'Agentes', 'Atalhos', 'Wire', 'Dados', 'Sobre'])
    expect(t['Geral']).toEqual(['Sistema', 'Tela', 'Notificações', 'Ambientes', 'Git'])
    expect(t['Terminal']).toEqual(['Início Rápido', 'Aparência', 'Avançado'])
    expect(t['Agentes']).toEqual(['Responsabilidades', 'Prompts', 'Skills', 'Contas', 'Uso'])
    expect(t['Dados']).toEqual(['Armazenamento', 'Backups', 'Armazenamento dos Portais'])
  })
  it('todo campo de preferência (menos atalhos e flags internas) tem uma opção; opção sem efeito traz o motivo', () => {
    const covered = new Set(OPTIONS.map(o => o.key))
    const internal = new Set(['computerUseEnabled', 'computerUseBypassPermissions', 'shortcuts', 'usesSystemHorizontalTerminalPadding', 'defaultTerminalDarkThemeId', 'portalSizeReadout', 'voiceModel', 'voiceLanguage'])  // o ditado tem bloco próprio em Geral › Sistema (VoiceSettings); o par escuro faz parte da linha Tema (cartões + modal); a leitura de tamanho se escolhe no menu do portal (Mostrar Tamanho)
    for (const k of Object.keys(defaultPreferences())) if (!internal.has(k)) expect(covered.has(k as never), k).toBe(true)
    for (const o of OPTIONS) if (!o.ready) expect(o.pending, o.key).toMatch(/\S/)
    for (const a of ACTIONS) if (!a.ready) expect(a.pending, a.label).toMatch(/\S/)
  })
  it('cada opção cai numa sub-aba que existe', () => {
    const sections = new Set(SETTINGS_TABS.flatMap(t => t.sections.map(s => `${t.id}/${s}`)))
    for (const o of [...OPTIONS, ...ACTIONS]) expect(sections.has(`${o.tab}/${o.section}`), `${o.tab}/${o.section}`).toBe(true)
  })
})
