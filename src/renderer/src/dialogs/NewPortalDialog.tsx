import { getPreferences, matchesShortcut } from '../settings/preferences'
import { Info } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FloorId, NewNode, Size, Vec } from '../../../shared/model'
import {
  chromeMajorOf, MAX_PORTAL_NAME, MAX_USER_AGENT, normalizePortalInput, PORTAL_STORAGE_HINT, PORTAL_STORAGE_LABEL, PORTAL_STORAGES,
  uniquePortalName, userAgentPresets, type PortalStorage
} from '../../../shared/portal-settings'
import { t, tr } from '../i18n'

export interface NewPortalForm { url: string; name: string; userAgent: string; storage: PortalStorage }

/** Nó portal a partir do formulário: endereço normalizado, nome único, UA aparado (vazio = padrão) e armazenamento. */
export function toNewPortalNode(form: NewPortalForm, frame: { pos: Vec; size: Size }, floorId: FloorId, existingNames: readonly string[]): NewNode {
  const url = normalizePortalInput(form.url)
  if (url === null) throw new Error(t('dialogs.NewPortalDialog.use_um_endereco_http_https_fil'))
  const userAgent = form.userAgent.trim()
  return {
    kind: 'portal', floorId, name: uniquePortalName(form.name, existingNames), url,
    ...(userAgent ? { userAgent } : {}), storage: form.storage, ...frame
  }
}

const CUSTOM = '__custom__'
const presetGroups = (): ReturnType<typeof userAgentPresets> =>
  userAgentPresets(chromeMajorOf(typeof navigator === 'undefined' ? '' : navigator.userAgent))

/** Agente de Usuário: Padrão (Chromium), presets de Computador e Celular, ou Personalizado (campo monoespaçado). */
export function PortalUserAgentField({ value, onChange }: { value: string; onChange(ua: string): void }) {
  const groups = useMemo(presetGroups, [])
  const known = value === '' || groups.some((g) => g.items.some((i) => i.ua === value))
  const [custom, setCustom] = useState(!known)
  const [info, setInfo] = useState(false)
  const selected = custom ? CUSTOM : value
  return (
    <div className="nt-field">
      <span className="nt-label" id="np-ua-label">{t('dialogs.NewPortalDialog.agente_de_usuario')}</span>
      <div className="np-ua-row">
        <select className="nt-input np-select" aria-labelledby="np-ua-label" value={selected} onChange={(e) => {
          const v = e.target.value
          if (v === CUSTOM) { setCustom(true); return }
          setCustom(false); onChange(v)
        }}>
          <option value="">{t('dialogs.NewPortalDialog.padrao_chromium')}</option>
          {groups.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((i) => <option key={i.label} value={i.ua}>{i.label}</option>)}
            </optgroup>
          ))}
          <option value={CUSTOM}>{t('dialogs.NewPortalDialog.personalizado')}</option>
        </select>
        <span className="np-info-anchor">
          <button type="button" className="np-info" aria-label={t('dialogs.NewPortalDialog.sobre_o_agente_de_usuario')} aria-expanded={info} onClick={() => setInfo((v) => !v)}>
            <Info size={16} />
          </button>
          {info && (
            <div className="np-info-pop" role="note">
              <p>{t('dialogs.NewPortalDialog.o_agente_de_usuario_e_a_identi')}</p>
              <p className="np-warn">{t('dialogs.NewPortalDialog.o_motor_continua_sendo_o_chrom')}</p>
            </div>
          )}
        </span>
      </div>
      {custom && (
        <input className="nt-input np-mono" aria-label={t('dialogs.NewPortalDialog.agente_de_usuario_personalizad')} value={value} maxLength={MAX_USER_AGENT} spellCheck={false}
          autoCapitalize="off" autoCorrect="off" placeholder={t('dialogs.NewPortalDialog.mozilla_5_0')} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

/** Armazenamento: Isolado, Workspace ou Global, com a explicação do escolhido. */
export function PortalStorageField({ value, onChange }: { value: PortalStorage; onChange(s: PortalStorage): void }) {
  return (
    <label className="nt-field">
      <span className="nt-label">{t('dialogs.NewPortalDialog.armazenamento')}</span>
      <select className="nt-input np-select" value={value} onChange={(e) => onChange(e.target.value as PortalStorage)}>
        {PORTAL_STORAGES.map((s) => <option key={s} value={s}>{tr(PORTAL_STORAGE_LABEL[s])}</option>)}
      </select>
      <span className="nt-hint">{tr(PORTAL_STORAGE_HINT[value])}</span>
    </label>
  )
}

interface Props {
  onCancel(): void
  /** Cria o portal; devolve uma mensagem de erro para mostrar, ou `null` se deu certo. */
  onCreate(form: NewPortalForm): Promise<string | null>
}

/** Diálogo "Novo Portal": abas Navegador e Dispositivos (ainda indisponível), URL, Nome, Agente de Usuário e Armazenamento. */
export function NewPortalDialog({ onCancel, onCreate }: Props) {
  const [form, setForm] = useState<NewPortalForm>({ url: '', name: '', userAgent: '', storage: getPreferences().defaultPortalStorage })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  useEffect(() => { urlRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (matchesShortcut('cancel', e) && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])
  const set = <K extends keyof NewPortalForm>(key: K, value: NewPortalForm[K]): void => setForm((f) => ({ ...f, [key]: value }))
  const urlBad = normalizePortalInput(form.url) === null

  const submit = async (): Promise<void> => {
    if (busy) return
    if (urlBad) { setError(t('dialogs.NewPortalDialog.use_um_endereco_http_https_fil_2')); return }
    setBusy(true); setError(null)
    const problem = await onCreate(form)
    setBusy(false)
    if (problem) setError(problem)
  }

  return (
    <div className="modal-back nt-back" onPointerDown={() => { if (!busy) onCancel() }}>
      <div className="np-sheet" role="dialog" aria-modal="true" aria-label={t('dialogs.NewPortalDialog.novo_portal')} onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="np-title">{t('dialogs.NewPortalDialog.novo_portal')}</h2>
        <div className="nt-tabs np-tabs" role="tablist">
          <button type="button" role="tab" aria-selected="true" className="nt-tab active">{t('dialogs.NewPortalDialog.navegador')}</button>
          <button type="button" role="tab" aria-selected="false" disabled className="nt-tab" title={t('dialogs.NewPortalDialog.dispositivos_ainda_nao_estao_d')}>{t('dialogs.NewPortalDialog.dispositivos')}</button>
        </div>
        <form id="new-portal-form" className="np-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          {error && <div className="nt-error" role="alert">{error}</div>}
          <label className="nt-field">
            <span className="nt-label">{t('dialogs.NewPortalDialog.url')}</span>
            <input ref={urlRef} className="nt-input" value={form.url} inputMode="url" placeholder={t('dialogs.NewPortalDialog.https_example_com')} spellCheck={false}
              autoCapitalize="off" autoCorrect="off" aria-invalid={urlBad} onChange={(e) => set('url', e.target.value)} />
          </label>
          <label className="nt-field">
            <span className="nt-label">{t('dialogs.NewPortalDialog.nome')}</span>
            <input className="nt-input" value={form.name} maxLength={MAX_PORTAL_NAME} placeholder={t('dialogs.NewPortalDialog.opcional')} onChange={(e) => set('name', e.target.value)} />
          </label>
          <PortalUserAgentField value={form.userAgent} onChange={(ua) => set('userAgent', ua)} />
          <PortalStorageField value={form.storage} onChange={(s) => set('storage', s)} />
        </form>
        <footer className="np-footer">
          <button type="button" className="np-btn" onClick={onCancel} disabled={busy}>{t('dialogs.NewPortalDialog.cancelar')}</button>
          <button type="submit" form="new-portal-form" className="np-btn primary" disabled={busy || urlBad}>{t('dialogs.NewPortalDialog.criar')}</button>
        </footer>
      </div>
    </div>
  )
}
