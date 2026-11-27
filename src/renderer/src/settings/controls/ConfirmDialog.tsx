import { useEffect, useRef } from 'react'
import { t } from '../../i18n'

/** Confirmação modal (apagar dados, restaurar padrão…): Esc e Cancelar fecham sem fazer nada; o foco abre no Cancelar. */
export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm(): void; onCancel(): void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancel.current?.focus()
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onCancel])
  return <div className="settings-confirm-back" onPointerDown={e => e.stopPropagation()}>
    <div className="settings-confirm" role="alertdialog" aria-modal="true" aria-label={title}>
      <h3>{title}</h3><p>{body}</p>
      <div className="settings-confirm-actions"><button ref={cancel} type="button" onClick={onCancel}>{t('settings.controls.ConfirmDialog.cancelar')}</button>
        <button type="button" className={danger ? 'danger' : ''} onClick={onConfirm}>{confirmLabel}</button></div>
    </div>
  </div>
}
