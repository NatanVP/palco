import { BookOpen, ClipboardPaste, FolderTree, Globe, Plus, RefreshCw, ScrollText, SquarePlus, SquareTerminal, Type } from 'lucide-react'
import type { QuickTile } from '../dialogs/new-terminal'
import { t } from '../i18n'
import type { MenuEntry, MenuItem } from './ContextMenu'
import type { PlaceKind } from './placement'

export type ScoreAction = 'create' | 'update' | 'open'

/** Submenu "Partituras": criar e atualizar pedem uma carga (a seleção ou o elemento clicado); atualizar pede também uma salva. */
export function scoresMenu(opts: { hasPayload: boolean; hasSaved: boolean; run(action: ScoreAction): void }): MenuItem {
  return {
    id: 'scores', label: t('ctx.partituras'), icon: BookOpen,
    items: [
      { id: 'scores.create', label: t('ctx.criar_partitura'), icon: SquarePlus, disabled: !opts.hasPayload, run: () => opts.run('create') },
      { id: 'scores.update', label: t('ctx.atualizar_partitura'), icon: RefreshCw, disabled: !opts.hasPayload || !opts.hasSaved, run: () => opts.run('update') },
      'separator',
      { id: 'scores.open', label: t('ctx.abrir_biblioteca'), icon: BookOpen, run: () => opts.run('open') }
    ]
  }
}

export interface CanvasMenuActions {
  presets: readonly QuickTile[]
  place(kind: PlaceKind): void
  preset(tile: QuickTile): void
  paste(): void
  scores: MenuItem
}

/** Menu do fundo do canvas: Adicionar, Colar e Partituras. */
export function canvasMenu(a: CanvasMenuActions): MenuEntry[] {
  const terminal: MenuItem = a.presets.length
    ? {
        id: 'add.terminal', label: t('ctx.terminal'), icon: SquareTerminal,
        items: [
          { id: 'add.terminal.new', label: t('ctx.novo_terminal'), run: () => a.place('terminal') },
          'separator',
          ...a.presets.map((p): MenuItem => ({ id: `add.terminal.preset:${p.name}`, label: p.name, run: () => a.preset(p) }))
        ]
      }
    : { id: 'add.terminal', label: t('ctx.terminal'), icon: SquareTerminal, run: () => a.place('terminal') }
  return [
    {
      id: 'add', label: t('ctx.adicionar'), icon: Plus,
      items: [
        terminal,
        { id: 'add.note', label: t('ctx.nota'), icon: ScrollText, run: () => a.place('note') },
        { id: 'add.filetree', label: t('ctx.arvore_de_arquivos'), icon: FolderTree, run: () => a.place('filetree') },
        { id: 'add.portal', label: t('ctx.portal'), icon: Globe, run: () => a.place('portal') },
        { id: 'add.text', label: t('ctx.texto'), icon: Type, run: () => a.place('text') }
      ]
    },
    'separator',
    { id: 'paste', label: t('ctx.colar'), icon: ClipboardPaste, run: a.paste },
    'separator',
    a.scores
  ]
}
