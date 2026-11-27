import { useState, type FormEvent } from 'react'
import type { PortalNode } from '../../../shared/model'
import { normalizePortalInput, type PortalStorage } from '../../../shared/portal-settings'
import { PortalStorageField, PortalUserAgentField } from './NewPortalDialog'
import { t } from '../i18n'

/** "Editar…" do menu do portal: nome, endereço, agente de usuário e armazenamento. */
export function EditPortalDialog({ node, onClose, onError }: { node: PortalNode; onClose(): void; onError(title: string, err: unknown): void }) {
  const [ua, setUa] = useState(node.userAgent ?? '')
  const [storage, setStorage] = useState<PortalStorage>(node.storage ?? 'global')
  const [busy, setBusy] = useState(false)
  const session = ua.trim() !== (node.userAgent ?? '') || storage !== (node.storage ?? 'global')
  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const name = String(data.get('portal-name') ?? '').trim(), url = normalizePortalInput(String(data.get('portal-url') ?? ''))
    if (!name || !url) { onError(t('canvas.ContextualBar.nao_foi_possivel_editar_o_port'), new Error(t('canvas.ContextualBar.use_nome_e_endereco_http_https'))); return }
    setBusy(true)
    try {
      await window.palco.node.patch(node.id, { name, url, ...(session ? { userAgent: ua.trim(), storage } : {}) })
      // Sem troca de sessão o webview continua o mesmo: é preciso navegar nele (com troca, ele nasce já no endereço novo).
      if (url !== node.url && !session) await document.querySelector<HTMLElement & { loadURL?(u: string): Promise<void> }>(`[data-node-id="${CSS.escape(node.id)}"] webview`)?.loadURL?.(url)
      onClose()
    } catch (error) { setBusy(false); onError(t('canvas.ContextualBar.nao_foi_possivel_editar_o_port'), error) }
  }
  return (
    <div className="modal-back" onPointerDown={onClose}>
      <form className="modal" role="dialog" aria-label={t('ctx.editar_portal')} onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => void save(e)} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <label>{t('canvas.ContextualBar.nome')}<input name="portal-name" defaultValue={node.name} required maxLength={120} autoFocus /></label>
        <label>{t('canvas.ContextualBar.endereco')}<input name="portal-url" defaultValue={node.url} required /></label>
        <PortalUserAgentField value={ua} onChange={setUa} />
        <PortalStorageField value={storage} onChange={setStorage} />
        {session && <p className="nt-hint warn">{t('canvas.ContextualBar.salvar_troca_a_identidade_ou_o')}</p>}
        <div className="modal-actions"><button type="button" onClick={onClose}>{t('canvas.ContextualBar.cancelar')}</button><button type="submit" disabled={busy}>{t('canvas.ContextualBar.salvar')}</button></div>
      </form>
    </div>
  )
}
