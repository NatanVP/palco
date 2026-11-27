import { matchesShortcut } from '../settings/preferences'
import { useEffect, useRef, useState } from 'react'
import { ImageUp, X } from 'lucide-react'
import type { WorkspaceMeta } from '../../../shared/model'
import { ColorRow, IconGrid } from '../dialogs/AppearanceFields'
import { fitIconImage } from './icon-fit'
import { DEFAULT_WORKSPACE_ICON, WORKSPACE_ICONS, useWorkspaceImage } from './workspace-icons'
import { t } from '../i18n'

interface Props {
  meta: WorkspaceMeta
  onClose(): void
  onError(title: string, err: unknown): void
}

/** O que fazer com a imagem própria ao salvar. */
type Image = { kind: 'keep' } | { kind: 'picked'; dataUrl: string; png: Uint8Array } | { kind: 'cleared' }

/** Folha "Editar workspace": nome, ícone (imagem própria, emoji ou lucide) e cor (ou sem cor). */
export function WorkspaceStyleSheet({ meta, onClose, onError }: Props) {
  const saved = useWorkspaceImage(meta.id)
  const [name, setName] = useState(meta.name)
  const [icon, setIcon] = useState(meta.icon ?? DEFAULT_WORKSPACE_ICON)
  const [color, setColor] = useState<string | null>(meta.color ?? null)
  const [image, setImage] = useState<Image>({ kind: 'keep' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (matchesShortcut('cancel', e)) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = image.kind === 'picked' ? image.dataUrl : image.kind === 'cleared' ? null : saved
  const pick = async (f: File): Promise<void> => {
    setProblem(null)
    const fitted = await fitIconImage(f)
    if (!fitted) { setProblem(t('sidebar.WorkspaceStyleSheet.nao_deu_para_ler_essa_imagem')); return }
    setImage({ kind: 'picked', ...fitted })
  }
  // Escolher um ícone (ou emoji) troca a imagem própria por ele.
  const chooseIcon = (next: string): void => {
    setIcon(next)
    if (shown) setImage({ kind: 'cleared' })
  }

  const save = async (): Promise<void> => {
    const clean = name.trim()
    if (clean === '' || busy) return
    setBusy(true)
    try {
      if (clean !== meta.name) await window.palco.workspaces.rename(meta.id, clean)
      await window.palco.workspaces.setStyle(meta.id, { icon: icon === DEFAULT_WORKSPACE_ICON ? null : icon, color })
      if (image.kind === 'picked') await window.palco.workspaces.saveIcon(meta.id, image.png)
      else if (image.kind === 'cleared' && saved) await window.palco.workspaces.deleteIcon(meta.id)
      onClose()
    } catch (err) {
      setBusy(false)
      onError(t('sidebar.WorkspaceStyleSheet.nao_foi_possivel_salvar_o_work'), err)
    }
  }

  const leading = (
    <button
      type="button"
      className={`nt-icon ws-image-cell${shown ? ' active' : ''}`}
      aria-pressed={!!shown}
      aria-label={t('sidebar.WorkspaceStyleSheet.imagem_propria')}
      title={t('sidebar.WorkspaceStyleSheet.imagem_propria_quadrada_128_12')}
      onClick={() => file.current?.click()}
    >
      {shown ? <img src={shown} alt="" /> : <ImageUp size={14} aria-hidden="true" />}
    </button>
  )

  return (
    <div className="modal-back nt-back" onPointerDown={onClose}>
      <div className="nt-sheet ws-sheet" role="dialog" aria-modal="true" aria-label={t('sidebar.WorkspaceStyleSheet.editar_workspace')} onPointerDown={(e) => e.stopPropagation()}>
        <header className="nt-titlebar">
          <button type="button" className="nt-textbtn" onClick={onClose}>{t('sidebar.WorkspaceStyleSheet.cancelar')}</button>
          <div className="nt-title"><strong>{t('sidebar.WorkspaceStyleSheet.editar_workspace')}</strong></div>
          <button type="submit" form="ws-style-form" className="nt-textbtn strong" disabled={busy || name.trim() === ''}>{busy ? t('sidebar.WorkspaceStyleSheet.salvando') : t('sidebar.WorkspaceStyleSheet.salvar')}</button>
        </header>
        <div className="nt-scroll">
          <form id="ws-style-form" className="nt-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
            <label className="nt-field">
              <span className="nt-label">{t('sidebar.WorkspaceStyleSheet.nome')}</span>
              <input className="nt-input" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </label>
            <IconGrid icon={icon} icons={WORKSPACE_ICONS} onIcon={chooseIcon} fallback={DEFAULT_WORKSPACE_ICON} leading={leading} leadingActive={!!shown} />
            <div className="ws-upload">
              <span className="nt-hint">{t('sidebar.WorkspaceStyleSheet.tamanho_ideal_imagem_quadrada_')}</span>
              {shown && (
                <button type="button" className="ws-upload-clear" onClick={() => setImage({ kind: 'cleared' })}>
                  <X size={12} aria-hidden="true" /> {t('sidebar.WorkspaceStyleSheet.remover_imagem')}
                </button>
              )}
              {problem && <span className="nt-hint warn">{problem}</span>}
            </div>
            <input
              ref={file} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }}
            />
            <ColorRow color={color} onColor={setColor} allowNone />
          </form>
        </div>
      </div>
    </div>
  )
}
