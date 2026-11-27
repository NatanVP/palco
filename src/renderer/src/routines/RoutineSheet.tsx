import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useModalKeys } from '../settings/controls/SettingsModal'
import { Toggle } from '../settings/controls/Toggle'
import { t } from '../i18n'
import { toInput, type Draft, type FormError, type Kind, type Unit } from './routine-form'

interface Named { id: string; name: string; agent?: string }

const KINDS: Array<[Kind, () => string]> = [['once', () => t('routines.kind.once')], ['every', () => t('routines.kind.every')], ['daily', () => t('routines.kind.daily')], ['weekly', () => t('routines.kind.weekly')]]
const dayName = (d: number): string => [t('routines.day.0'), t('routines.day.1'), t('routines.day.2'), t('routines.day.3'), t('routines.day.4'), t('routines.day.5'), t('routines.day.6')][d]!
const PROBLEMS: Record<FormError, () => string> = { dias: () => t('routines.error.days'), intervalo: () => t('routines.error.interval'), momento: () => t('routines.error.moment'), fim: () => t('routines.error.end') }
/** O erro do main chega embrulhado pelo Electron; só a mensagem interessa. */
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rt-field"><span aria-hidden="true">{label}</span>{children}</div>
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rt-row"><span aria-hidden="true">{label}</span>{children}</div>
}

/** A folha "Nova Rotina" / "Editar Rotina". */
export function RoutineSheet({ initial, workspaces, onClose }: { initial: Draft; workspaces: Named[]; onClose(): void }) {
  const root = useRef<HTMLDivElement>(null)
  useModalKeys(root, onClose)
  // O foco começa no nome (o editor modal focaria o Cancelar, que vem antes).
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const [draft, setDraft] = useState(initial)
  /** `null` enquanto a lista do workspace não chegou. */
  const [terminals, setTerminals] = useState<Named[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Draft>): void => { setError(''); setDraft((d) => ({ ...d, ...patch })) }
  useEffect(() => {
    let on = true
    setTerminals(null)
    void window.palco.rail.terminals(draft.workspaceId).then((list) => { if (on) setTerminals(list) }).catch(() => {})
    return () => { on = false }
  }, [draft.workspaceId])

  const editing = initial.id !== undefined, background = draft.terminalId === '@background', reminder = draft.terminalId === ''
  const chosen = terminals?.find((x) => x.id === draft.terminalId)
  // O terminal alvo foi apagado: aparece como tal, e não dá para salvar assim.
  const missing = !reminder && !background && terminals !== null && chosen === undefined
  const contentLabel = reminder ? t('routines.notes') : background || chosen?.agent === 'shell' ? t('routines.command') : t('routines.prompt')
  const ready = draft.name.trim() !== '' && (reminder || (draft.content.trim() !== '' && !missing)) && !busy
  const title = editing ? t('routines.edit') : t('routines.new')
  const submit = async (): Promise<void> => {
    if (!ready) return
    const result = toInput(draft)
    if ('error' in result) { setError(PROBLEMS[result.error]()); return }
    setBusy(true)
    try { await window.palco.routine.save(result.input); onClose() }
    catch (e) { setError(reason(e)); setBusy(false) }
  }

  return <div className="settings-confirm-back rt-back rt-sheet-back" onPointerDown={(e) => e.stopPropagation()}>
    <div ref={root} className="rt-dialog rt-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <header>
        <button type="button" className="rt-link" onClick={onClose}>{t('routines.cancel')}</button>
        <h2>{title}</h2>
        <button type="button" className="rt-link rt-confirm" disabled={!ready} onClick={() => void submit()}>{editing ? t('routines.save') : t('routines.create')}</button>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <Field label={t('routines.name')}><input ref={first} aria-label={t('routines.name')} value={draft.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label={t('routines.workspace')}>
          <select aria-label={t('routines.workspace')} value={draft.workspaceId} onChange={(e) => set({ workspaceId: e.target.value, terminalId: '', floorId: undefined })}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label={t('routines.target')}>
          <select aria-label={t('routines.target')} value={draft.terminalId} onChange={(e) => set({ terminalId: e.target.value })}>
            <option value="">{t('routines.noTarget')}</option>
            <option value="@background">{t('routines.background')}</option>
            {terminals?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            {missing && <option value={draft.terminalId} disabled>{t('routines.removed')}</option>}
          </select>
        </Field>
        <Field label={contentLabel}><textarea aria-label={contentLabel} rows={3} value={draft.content} onChange={(e) => set({ content: e.target.value })} /></Field>
        {!reminder && <>
          <Row label={t('routines.skipIfBusy')}><Toggle label={t('routines.skipIfBusy')} checked={draft.skipIfBusy} onChange={(skipIfBusy) => set({ skipIfBusy })} /></Row>
          <Field label={t('routines.preRun')}><textarea aria-label={t('routines.preRun')} rows={2} spellCheck={false} placeholder={t('routines.preRunHint', { mark: '{{output}}' })} value={draft.preRun} onChange={(e) => set({ preRun: e.target.value })} /></Field>
        </>}

        <h3>{t('routines.schedule')}</h3>
        <div className="rt-segments" role="tablist" aria-label={t('routines.schedule')}>
          {KINDS.map(([kind, label]) => <button key={kind} type="button" role="tab" aria-selected={draft.kind === kind} onClick={() => set({ kind })}>{label()}</button>)}
        </div>
        {draft.kind === 'once' && <Row label={t('routines.moment')}><input type="datetime-local" aria-label={t('routines.moment')} value={draft.at} onChange={(e) => set({ at: e.target.value })} /></Row>}
        {draft.kind === 'every' && <Row label={t('routines.every')}>
          <span className="rt-inline">
            <input type="number" min={1} aria-label={t('routines.every')} value={draft.amount} onChange={(e) => set({ amount: e.target.value })} />
            <select aria-label={t('routines.unit')} value={draft.unit} onChange={(e) => set({ unit: e.target.value as Unit })}>
              <option value="s">{t('routines.seconds')}</option><option value="m">{t('routines.minutes')}</option><option value="h">{t('routines.hours')}</option>
            </select>
          </span>
        </Row>}
        {draft.kind === 'weekly' && <div className="rt-days" role="group" aria-label={t('routines.days')}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => <button key={d} type="button" aria-label={dayName(d)} aria-pressed={draft.days.includes(d)}
            onClick={() => set({ days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d] })}>{dayName(d).slice(0, 3)}</button>)}
        </div>}
        {(draft.kind === 'daily' || draft.kind === 'weekly') && <Row label={t('routines.time')}><input type="time" aria-label={t('routines.time')} value={draft.time} onChange={(e) => set({ time: e.target.value })} /></Row>}
        {draft.kind !== 'once' && <>
          <Row label={t('routines.start')}><input type="datetime-local" aria-label={t('routines.start')} value={draft.start} onChange={(e) => set({ start: e.target.value })} /></Row>
          <Row label={t('routines.repeatEnd')}>
            <select aria-label={t('routines.repeatEnd')} value={draft.end} onChange={(e) => set({ end: e.target.value as Draft['end'] })}>
              <option value="never">{t('routines.never')}</option><option value="count">{t('routines.afterCount')}</option><option value="date">{t('routines.onDate')}</option>
            </select>
          </Row>
          {draft.end === 'count' && <Row label={t('routines.count')}><input type="number" min={1} aria-label={t('routines.count')} value={draft.count} onChange={(e) => set({ count: e.target.value })} /></Row>}
          {draft.end === 'date' && <Row label={t('routines.endsAt')}><input type="date" aria-label={t('routines.endsAt')} value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Row>}
        </>}

        <Row label={t('routines.notify')}><Toggle label={t('routines.notify')} checked={reminder || draft.notify} disabled={reminder} onChange={(notify) => set({ notify })} /></Row>
        <Row label={t('routines.enabled')}><Toggle label={t('routines.enabled')} checked={draft.enabled} onChange={(enabled) => set({ enabled })} /></Row>
        {error && <p className="rt-error" role="alert">{error}</p>}
      </form>
    </div>
  </div>
}
