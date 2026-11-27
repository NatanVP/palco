import { useEffect, useRef, useState } from 'react'
import { CalendarClock, History, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import type { RoutineView } from '../../../shared/api'
import type { RoutineExecution, RoutineRun } from '../../../shared/model'
import { SettingsConfirm, useModalKeys } from '../settings/controls/SettingsModal'
import { Toggle } from '../settings/controls/Toggle'
import { getLocale, t } from '../i18n'
import { RoutineSheet } from './RoutineSheet'
import { draftOf, newDraft, type Draft } from './routine-form'
import '../settings/settings.css'
import './routines.css'

const fmt = (iso?: string): string =>
  iso ? new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—'
const executionText = (e: RoutineExecution): string => e.status === 'running' ? t('routines.backgroundRunning')
  : e.status === 'timedOut' ? t('routines.backgroundTimeout') : e.status === 'failed' ? t('routines.backgroundFailed')
  : t('routines.executionResult', { code: e.exitCode ?? '—', duration: e.durationMs })
const resultText = (result: string): string => result === 'pulado: rotina já em execução' ? t('routines.backgroundBusy') : result
const outcome = (run: RoutineRun): string =>
  run.execution ? executionText(run.execution) : run.result !== 'ok' ? resultText(run.result) : run.terminalName === undefined ? t('routines.reminderSent') : t('routines.sentTo', { name: run.terminalName })

/** A folha de Rotinas: a lista (de todos os workspaces) e o histórico de disparos. */
export function RoutinesPanel({ onClose }: { onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  useModalKeys(root, onClose)
  const [tab, setTab] = useState<'list' | 'history'>('list')
  const [list, setList] = useState<RoutineView[]>([])
  const [history, setHistory] = useState<RoutineRun[]>([])
  const [flash, setFlash] = useState<Record<string, string>>({})
  const [sheet, setSheet] = useState<{ draft: Draft; workspaces: Array<{ id: string; name: string }> } | null>(null)
  const [removing, setRemoving] = useState<RoutineView | null>(null)

  useEffect(() => {
    void window.palco.routine.list().then(setList)
    void window.palco.routine.history().then(setHistory)
    const offs = [window.palco.routine.onChange(setList), window.palco.routine.onHistory(setHistory)]
    return () => { for (const off of offs) off() }
  }, [])

  const open = async (r?: RoutineView): Promise<void> => {
    const side = await window.palco.workspaces.sidebar()
    let draft = r ? draftOf(r, new Date()) : newDraft(side.active, new Date())
    // O workspace da rotina foi apagado: ela passa para o aberto, e o destino antigo não existe mais.
    if (!side.workspaces.some((w) => w.id === draft.workspaceId)) draft = { ...draft, workspaceId: side.active, terminalId: '' }
    setSheet({ workspaces: side.workspaces, draft })
  }
  const run = async (r: RoutineView): Promise<void> => {
    const result = await window.palco.routine.runNow(r.id)
    setFlash((f) => ({ ...f, [r.id]: r.background ? result.startsWith('continua rodando') ? t('routines.backgroundRunning') : result === 'pulado: rotina já em execução' ? t('routines.backgroundBusy') : '' : result }))
  }

  return <div className="settings-confirm-back rt-back" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
    <div ref={root} className="rt-dialog rt-panel" role="dialog" aria-modal="true" aria-label={t('routines.title')}>
      <header>
        <h2>{t('routines.title')}</h2>
        <button type="button" className="rt-icon" aria-label={t('routines.new')} title={t('routines.new')} onClick={() => void open()}><Plus size={18} aria-hidden="true" /></button>
      </header>
      <div className="rt-segments" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')}>{t('routines.title')}</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>{t('routines.history')}</button>
      </div>
      <div className="rt-body">
        {tab === 'list' && (list.length === 0
          ? <div className="rt-empty"><CalendarClock size={26} aria-hidden="true" /><strong>{t('routines.emptyTitle')}</strong><p>{t('routines.emptyText')}</p></div>
          : <ul>{list.map((r) => <li key={r.id} className={r.enabled ? '' : 'off'}>
            <Toggle label={t('routines.enable', { name: r.name })} checked={r.enabled} onChange={(on) => void window.palco.routine.setEnabled(r.id, on)} />
            <div className="rt-info">
              <strong>{r.name}</strong>
              <span>{r.scheduleText}{r.remaining !== undefined ? ` ${t('routines.remaining', { remaining: r.remaining })}` : ''}{r.until ? ` ${t('routines.until', { date: fmt(r.until) })}` : ''}</span>
              <span>{r.background ? t('routines.background') : r.reminder ? t('routines.reminder') : r.terminal} · {r.workspace}</span>
              <span>{t('routines.nextLast', { next: r.enabled ? fmt(r.nextRun) : t('routines.off'), last: r.lastRun ? `${fmt(r.lastRun.at)} (${resultText(r.lastRun.result)})` : '—' })}</span>
              {r.background && r.lastExecution && <>
                <span>{t('routines.lastExecution', { date: fmt(r.lastExecution.startedAt) })} · {executionText(r.lastExecution)}</span>
                {r.lastExecution.output && <details><summary>{t('routines.executionOutput')}</summary><pre className="rt-content">{r.lastExecution.output}</pre></details>}
              </>}
              {flash[r.id] && <span className="rt-flash">{flash[r.id]}</span>}
            </div>
            <div className="rt-actions">
              <button type="button" className="rt-icon" aria-label={t('routines.runNow', { name: r.name })} title={t('routines.runNow', { name: r.name })} onClick={() => void run(r)}><Play size={14} aria-hidden="true" /></button>
              <button type="button" className="rt-icon" aria-label={t('routines.editName', { name: r.name })} title={t('routines.editName', { name: r.name })} onClick={() => void open(r)}><Pencil size={14} aria-hidden="true" /></button>
              <button type="button" className="rt-icon" aria-label={t('routines.deleteName', { name: r.name })} title={t('routines.deleteName', { name: r.name })} onClick={() => setRemoving(r)}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          </li>)}</ul>)}
        {tab === 'history' && (history.length === 0
          ? <div className="rt-empty"><History size={26} aria-hidden="true" /><strong>{t('routines.noHistory')}</strong><p>{t('routines.noHistoryText')}</p></div>
          : <ul>{[...history].reverse().map((h) => <li key={h.id}>
            <div className="rt-info"><strong>{h.routineName}</strong><span>{fmt(h.firedAt)} · {outcome(h)}{h.result !== 'ok' && h.terminalName !== undefined ? ` · ${h.terminalName}` : ''}</span><span className="rt-content">{h.content}</span></div>
            <div className="rt-actions"><button type="button" className="rt-icon" aria-label={t('routines.removeRun', { name: h.routineName })} title={t('routines.removeRun', { name: h.routineName })} onClick={() => void window.palco.routine.historyRemove(h.id)}><X size={14} aria-hidden="true" /></button></div>
          </li>)}</ul>)}
      </div>
      <footer>
        {tab === 'history' && history.length > 0 && <button type="button" className="rt-secondary" onClick={() => void window.palco.routine.historyClear()}>{t('routines.clearHistory')}</button>}
        <button type="button" className="rt-primary" onClick={onClose}>{t('routines.done')}</button>
      </footer>
    </div>
    {sheet && <RoutineSheet initial={sheet.draft} workspaces={sheet.workspaces} onClose={() => setSheet(null)} />}
    {removing && <SettingsConfirm title={t('routines.deleteTitle', { name: removing.name })} body={t('routines.deleteBody')} confirmLabel={t('routines.delete')} danger
      onCancel={() => setRemoving(null)} onConfirm={() => { const id = removing.id; setRemoving(null); void window.palco.routine.remove(id) }} />}
  </div>
}
