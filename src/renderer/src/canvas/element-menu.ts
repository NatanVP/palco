import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, AppWindow, BringToFront, Camera, ClipboardPaste, Copy, CopyPlus, CornerLeftUp, Database, Eraser, ExternalLink, Eye, EyeOff, FileDown, FileUp, FolderOpen, Group, LayoutGrid, Lock, LockOpen, Moon, NotebookTabs, Palette, PanelBottom, Pencil, RotateCw, Ruler, SendToBack, SlidersHorizontal, SquareDashed, SquareMousePointer, TextSelect, Trash2, Ungroup, UserPlus, Users, Volume2, VolumeX, type LucideIcon } from 'lucide-react'
import type { BandNode, CanvasNode, Drawing, TerminalNode, Workspace } from '../../../shared/model'
import { NOTE_COLOR_HEX, noteDefaults } from '../../../shared/new-item'
import { NOTE_COLORS, type Preferences } from '../../../shared/preferences'
import { PORTAL_STORAGES } from '../../../shared/portal-settings'
import { t, type MessageKey } from '../i18n'
import { tidyEntries, type MenuEntry, type MenuItem } from './ContextMenu'
import { ALIGN_IDS, type AlignId } from './commands/align'

const ALIGN_ICON: Record<AlignId, LucideIcon> = {
  left: AlignStartVertical, centerHorizontally: AlignCenterVertical, right: AlignEndVertical,
  top: AlignStartHorizontal, centerVertically: AlignCenterHorizontal, bottom: AlignEndHorizontal,
  distributeHorizontally: AlignHorizontalDistributeCenter, distributeVertically: AlignVerticalDistributeCenter
}

/** "Alinhar": os seis alinhamentos e as duas distribuições (que pedem três ou mais), em três grupos. */
export function alignMenu(count: number, run: (id: AlignId) => void): MenuItem {
  return {
    id: 'align', label: t('ctx.alinhar'), icon: AlignStartVertical,
    items: ALIGN_IDS.flatMap((id, i): MenuEntry[] => [
      ...(i === 3 || i === 6 ? ['separator' as const] : []),
      { id: `align.${id}`, label: t(`ctx.align.${id}` as MessageKey), icon: ALIGN_ICON[id], disabled: id.startsWith('distribute') && count < 3, run: () => run(id) }
    ])
  }
}

/** Limites do "usar este tamanho" do palco, por tipo. */
const SIZE_LIMITS = { terminal: { w: [200, 1600], h: [120, 1200] }, note: { w: [100, 800], h: [100, 600] }, portal: { w: [400, 2400], h: [300, 1600] } } as const
const clamp = (v: number, [min, max]: readonly [number, number]): number => Math.min(max, Math.max(min, Math.round(v)))
export const adoptedSize = (kind: keyof typeof SIZE_LIMITS, size: { w: number; h: number }): { width: number; height: number } =>
  ({ width: clamp(size.w, SIZE_LIMITS[kind].w), height: clamp(size.h, SIZE_LIMITS[kind].h) })

type Patch = Partial<Omit<Preferences, 'shortcuts'>>
/** "Padrões para Novos Elementos" (terminal, nota e portal): cada item some em cinza quando o padrão já é igual. */
function defaultsMenu(node: CanvasNode, prefs: Preferences, save: (patch: Patch) => void): MenuItem | null {
  if (node.kind !== 'terminal' && node.kind !== 'note' && node.kind !== 'portal') return null
  const item = (id: string, label: string, same: boolean, patch: Patch): MenuItem => ({ id: `defaults.${id}`, label, disabled: same, run: () => save(patch) })
  const size = adoptedSize(node.kind, node.size)
  const key = node.kind === 'terminal' ? 'defaultTerminalSize' : node.kind === 'note' ? 'defaultNoteSize' : 'defaultPortalSize'
  const items: MenuEntry[] = [item('size', t('ctx.usar_este_tamanho'), prefs[key].width === size.width && prefs[key].height === size.height, { [key]: size })]
  if (node.kind === 'terminal') {
    const family = node.fontFamily ?? prefs.terminalFontFamily, fontSize = Math.min(32, Math.round(node.fontSize ?? prefs.terminalFontSize))
    const theme = node.themeId ?? prefs.defaultTerminalTheme, dark = node.themeId === undefined ? prefs.defaultTerminalDarkThemeId : node.darkThemeId ?? null
    items.push(
      item('font', t('ctx.usar_esta_fonte'), family === prefs.terminalFontFamily && fontSize === prefs.terminalFontSize, { terminalFontFamily: family, terminalFontSize: fontSize }),
      item('theme', t('ctx.usar_este_tema'), theme === prefs.defaultTerminalTheme && dark === prefs.defaultTerminalDarkThemeId, { defaultTerminalTheme: theme, defaultTerminalDarkThemeId: dark })
    )
  } else if (node.kind === 'note') {
    // Só as cores da paleta podem virar padrão (cor personalizada fica de fora).
    const color = NOTE_COLORS.find((c) => NOTE_COLOR_HEX[c] === node.color?.toLowerCase())
    const family = node.fontFamily ?? null, fontSize = node.fontSize ?? noteDefaults(prefs).fontSize
    items.push(
      item('color', t('ctx.usar_esta_cor'), !color || color === prefs.defaultNoteColor, color ? { defaultNoteColor: color } : {}),
      item('font', t('ctx.usar_esta_fonte'), family === prefs.defaultNoteFontFamily && fontSize === prefs.defaultNoteFontSize, { defaultNoteFontFamily: family, defaultNoteFontSize: fontSize })
    )
  }
  return { id: 'defaults', label: t('ctx.padroes_para_novos'), icon: SlidersHorizontal, items }
}

export interface ElementMenuActions {
  rename(): void
  copyElement(): void
  duplicate(): void
  scores: MenuItem
  toggleLock(): void
  /** Falso quando a trava impede apagar o clicado (`shared/lock.ts`). */
  canRemove: boolean
  remove(): void
  /** Patch pelo histórico (desfazível). */
  patch(change: Record<string, unknown>): void
  savePreferences(patch: Patch): void
  reload(): void
  unload(): void
  toggleRedaction(): void
  terminal: { selection: string; copy(): void; paste(): void; selectAll(): void; edit(): void; joinBand(bandId: string): void; clearChat(): void }
  copyContents(): void
  unstack(): void
  unfile(): void
  portal: { edit(): void; reload(): void; setStorage(s: string): void; clearStorage(): void; screenshot(): void; openExternal(): void }
  reveal(): void
  link: { open(): void; openInPortal(): void; copyUrl(): void }
  /** Árvore: sair das pastas em que se entrou. */
  resetToRoot(): void
  renameStack(): void
  /** Nota: gravar num arquivo escolhido, ou soltar o arquivo ligado. */
  moveNoteOut(): void
  unlinkNote(): void
  openFile(): void
  copyFile(): void
  band: { loadAll(): void; allUnloaded: boolean; dissolve(): void; remove(): void }
  /** Presente só quando o elemento clicado faz parte de uma seleção de dois ou mais. */
  multi?: { count: number; tidy?(): void; align(id: AlignId): void; createBand?(): void; file?(): void }
  /** Presente quando há o que agrupar (dois ou mais escolhidos). */
  group?(): void
  /** Presente quando algum dos alvos está num grupo. */
  ungroup?(): void
}

/** Menu do botão direito de um elemento, com os itens e a ordem do palco para cada tipo. */
export function elementMenu(node: CanvasNode, ws: Workspace, prefs: Preferences, a: ElementMenuActions, stacked: boolean): MenuEntry[] {
  const copyPair: MenuItem[] = [
    { id: 'copyElement', label: t('ctx.copiar_elemento'), icon: Copy, run: a.copyElement },
    { id: 'duplicate', label: t('ctx.duplicar'), icon: CopyPlus, run: a.duplicate }
  ]
  const multi: MenuEntry[] = tidyEntries([
    a.multi?.tidy ? { id: 'tidy', label: t('ctx.organizar'), icon: LayoutGrid, run: a.multi.tidy } : null,
    a.multi ? alignMenu(a.multi.count, a.multi.align) : null,
    a.group ? { id: 'group', label: t('ctx.agrupar'), icon: Group, run: a.group } : null,
    a.multi?.createBand ? { id: 'band.create', label: t('ctx.criar_banda'), icon: Users, run: a.multi.createBand } : null,
    a.multi?.file ? { id: 'fichario', label: t('ctx.colocar_no_fichario'), icon: NotebookTabs, run: a.multi.file } : null,
    a.ungroup ? { id: 'ungroup', label: t('ctx.desagrupar'), icon: Ungroup, run: a.ungroup } : null
  ])
  const locked = node.positionLocked === true
  const remove: MenuItem = { id: 'delete', label: node.kind === 'band' ? t('ctx.apagar_banda') : t('ctx.apagar'), icon: Trash2, danger: true, disabled: !a.canRemove, run: a.remove }
  /** A "cauda" comum: Partituras, o bloco da seleção múltipla, Bloquear e Apagar. */
  const tail: MenuEntry[] = [a.scores, 'separator', ...multi, ...(multi.length ? ['separator' as const] : []), { id: 'lock', label: t(locked ? 'ctx.desbloquear' : 'ctx.bloquear'), icon: locked ? LockOpen : SquareDashed, run: a.toggleLock }, 'separator', remove]
  const rename: MenuItem = { id: 'rename', label: t('ctx.renomear'), icon: Pencil, run: a.rename }
  const redact = (on: boolean): MenuItem => ({ id: 'redact', label: t(on ? 'ctx.remover_desfoque' : 'ctx.desfocar'), icon: on ? Eye : EyeOff, run: a.toggleRedaction })
  const reload = (run: () => void): MenuItem => ({ id: 'reload', label: t('ctx.recarregar'), icon: RotateCw, run })
  const unload = (done: boolean): MenuItem => ({ id: 'unload', label: t('ctx.descarregar'), icon: Moon, disabled: done, run: a.unload })
  const defaults = defaultsMenu(node, prefs, a.savePreferences)

  switch (node.kind) {
    case 'terminal': {
      const bands = Object.values(ws.nodes).filter((n): n is BandNode => n.kind === 'band' && n.floorId === node.floorId)
      const member = bands.some((b) => b.members.includes(node.id))
      const monitor = node.monitor ?? node.agent !== 'shell'
      return tidyEntries([
        { id: 'copy', label: t('ctx.copiar'), icon: Copy, disabled: a.terminal.selection === '', run: a.terminal.copy },
        { id: 'paste', label: t('ctx.colar'), icon: ClipboardPaste, disabled: node.unloaded === true, run: a.terminal.paste },
        { id: 'selectAll', label: t('ctx.selecionar_tudo'), icon: TextSelect, disabled: node.unloaded === true, run: a.terminal.selectAll },
        'separator',
        rename,
        { id: 'edit', label: t('ctx.editar'), icon: SlidersHorizontal, run: a.terminal.edit },
        { id: 'monitor', label: t('ctx.monitorar_atividade'), checked: monitor, run: () => a.patch({ monitor: !monitor }) },
        bands.length && !member ? { id: 'joinBand', label: t('ctx.adicionar_a_banda'), icon: UserPlus, items: bands.map((b): MenuItem => ({ id: `joinBand:${b.id}`, label: b.name, run: () => a.terminal.joinBand(b.id) })) } : null,
        'separator',
        redact(node.redacted === true),
        node.chatMode ? { id: 'clearChat', label: t('ctx.limpar_historico_do_chat'), icon: Eraser, danger: true, run: a.terminal.clearChat } : null,
        reload(a.reload),
        unload(node.unloaded === true),
        defaults,
        'separator',
        ...copyPair,
        ...tail
      ])
    }
    case 'note': {
      const locked = node.locked === true
      return tidyEntries([
        node.linkedFile ? null : rename,
        stacked ? { id: 'renameStack', label: t('ctx.renomear_fichario'), icon: NotebookTabs, run: a.renameStack } : null,
        { id: 'lockContents', label: t(locked ? 'ctx.destravar_conteudo' : 'ctx.travar_conteudo'), icon: locked ? LockOpen : Lock, run: () => a.patch({ locked: !locked }) },
        redact(node.redacted === true),
        'separator',
        { id: 'copyContents', label: t('ctx.copiar_conteudo'), icon: Copy, disabled: node.content.trim() === '', run: a.copyContents },
        node.linkedFile ? { id: 'reveal', label: t('ctx.mostrar_na_pasta'), icon: FolderOpen, run: a.reveal } : null,
        node.linkedFile ? { id: 'unlinkNote', label: t('ctx.salvar_no_palco'), icon: FileDown, run: a.unlinkNote } : { id: 'moveNoteOut', label: t('ctx.mover_para_fora'), icon: FileUp, run: a.moveNoteOut },
        ...copyPair,
        { id: 'color', label: t('ctx.cor'), icon: Palette, items: NOTE_COLORS.map((c): MenuItem => ({ id: `color.${c}`, label: t(`ctx.cor.${c}` as MessageKey), radio: true, checked: node.color?.toLowerCase() === NOTE_COLOR_HEX[c], run: () => a.patch({ color: NOTE_COLOR_HEX[c] }) })) },
        defaults,
        'separator',
        stacked ? { id: 'unfile', label: t('ctx.tirar_do_fichario'), icon: NotebookTabs, run: a.unfile } : null,
        stacked ? { id: 'unstack', label: t('ctx.desempilhar_tudo'), icon: Ungroup, run: a.unstack } : null,
        'separator',
        ...tail
      ])
    }
    case 'portal': {
      const hidden = node.chromeHidden === true, muted = node.muted === true, storage = node.storage ?? 'global'
      return tidyEntries([
        rename,
        { id: 'edit', label: t('ctx.editar'), icon: SlidersHorizontal, run: a.portal.edit },
        { id: 'chrome', label: t(hidden ? 'ctx.mostrar_moldura' : 'ctx.ocultar_moldura'), icon: hidden ? PanelBottom : AppWindow, run: () => a.patch({ chromeHidden: !hidden }) },
        { id: 'mute', label: t(muted ? 'ctx.ativar_som' : 'ctx.silenciar'), icon: muted ? Volume2 : VolumeX, run: () => a.patch({ muted: !muted }) },
        { id: 'sizeReadout', label: t('ctx.mostrar_tamanho'), icon: Ruler, items: (['onResize', 'always', 'never'] as const).map((v): MenuItem => ({ id: `sizeReadout.${v}`, label: t(`ctx.tamanho.${v}` as MessageKey), radio: true, checked: prefs.portalSizeReadout === v, run: () => a.savePreferences({ portalSizeReadout: v }) })) },
        {
          id: 'storage', label: t('ctx.escopo_de_armazenamento'), icon: Database, items: [
            ...PORTAL_STORAGES.map((s): MenuItem => ({ id: `storage.${s}`, label: t(`ctx.escopo.${s}` as MessageKey), radio: true, checked: storage === s, run: () => a.portal.setStorage(s) })),
            'separator',
            { id: 'storage.clear', label: t('ctx.limpar_armazenamento'), icon: Trash2, danger: true, run: a.portal.clearStorage }
          ]
        },
        'separator',
        { id: 'screenshot', label: t('ctx.copiar_captura'), icon: Camera, disabled: node.unloaded === true, run: a.portal.screenshot },
        reload(a.portal.reload),
        unload(node.unloaded === true),
        /^https?:\/\//i.test(node.url) ? { id: 'openExternal', label: t('ctx.abrir_no_navegador'), icon: ExternalLink, run: a.portal.openExternal } : null,
        defaults,
        'separator',
        ...copyPair,
        ...tail
      ])
    }
    case 'text': return [...copyPair, ...tail]
    case 'link': return [{ id: 'openLink', label: t('ctx.abrir'), icon: ExternalLink, run: a.link.open }, { id: 'openLinkPortal', label: t('ctx.abrir_em_portal'), icon: AppWindow, run: a.link.openInPortal }, { id: 'copyUrl', label: t('ctx.copiar_url'), icon: Copy, run: a.link.copyUrl }, 'separator', ...copyPair, ...tail]
    case 'filetree': return tidyEntries([{ id: 'reveal', label: t('ctx.mostrar_na_pasta'), icon: FolderOpen, run: a.reveal }, node.current !== undefined ? { id: 'resetToRoot', label: t('ctx.voltar_a_raiz'), icon: CornerLeftUp, run: a.resetToRoot } : null, 'separator', ...copyPair, ...tail])
    case 'file': return [
      { id: 'open', label: t('ctx.abrir'), icon: SquareMousePointer, run: a.openFile },
      { id: 'reveal', label: t('ctx.mostrar_na_pasta'), icon: FolderOpen, run: a.reveal },
      { id: 'copyFile', label: t('ctx.copiar'), icon: Copy, run: a.copyFile },
      'separator', ...copyPair, ...tail
    ]
    case 'band': return tidyEntries([
      rename,
      { id: 'bandLoad', label: t(a.band.allUnloaded ? 'ctx.recarregar_banda' : 'ctx.descarregar_banda'), icon: a.band.allUnloaded ? RotateCw : Moon, run: a.band.loadAll },
      'separator',
      ...copyPair,
      a.scores,
      'separator',
      { id: 'dissolve', label: t('ctx.desagrupar'), icon: Ungroup, disabled: locked, run: a.band.dissolve },
      'separator',
      { ...remove, run: a.band.remove }
    ])
  }
}

export interface DrawingMenuActions { count: number; align(id: AlignId): void; front(): void; back(): void; toggleLock(): void; duplicate(): void; remove(): void }
/** Menu de um desenho (e da seleção de que ele faz parte). */
export function drawingMenu(targets: readonly Drawing[], a: DrawingMenuActions): MenuEntry[] {
  const locked = targets.some((d) => d.locked)
  return tidyEntries([
    a.count >= 2 ? alignMenu(a.count, a.align) : null,
    'separator',
    { id: 'front', label: t('ctx.trazer_para_frente'), icon: BringToFront, run: a.front },
    { id: 'back', label: t('ctx.enviar_para_tras'), icon: SendToBack, run: a.back },
    'separator',
    { id: 'lock', label: t(locked ? 'ctx.desbloquear' : 'ctx.bloquear'), icon: locked ? LockOpen : Lock, run: a.toggleLock },
    'separator',
    { id: 'duplicate', label: t('ctx.duplicar'), icon: CopyPlus, run: a.duplicate },
    { id: 'delete', label: t('ctx.apagar'), icon: Trash2, danger: true, disabled: targets.every((d) => d.locked), run: a.remove }
  ])
}
