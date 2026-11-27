import { useCallback, useSyncExternalStore, type SetStateAction } from 'react'
import type { EditorPill } from './editor'

/**
 * Rascunho do Compositor de cada terminal, fora do componente: sobrevive a trocar de andar ou de workspace (o card desmonta).
 * Também guarda o envio em andamento, para um card que volta não reenviar o que ainda está a caminho.
 */
export interface DraftState { text: string; caret: number; files: string[]; sending: boolean }
interface Entry { state: DraftState; pastes: Map<string, string>; pills: Map<string, EditorPill>; listeners: Set<() => void> }
const entries = new Map<string, Entry>()
const EMPTY: DraftState = { text: '', caret: 0, files: [], sending: false }

export function draftEntry(id: string): Entry {
  let entry = entries.get(id)
  if (!entry) { entry = { state: EMPTY, pastes: new Map(), pills: new Map(), listeners: new Set() }; entries.set(id, entry) }
  return entry
}
export function updateDraft(id: string, patch: (state: DraftState) => Partial<DraftState>): void {
  const entry = draftEntry(id)
  entry.state = { ...entry.state, ...patch(entry.state) }
  for (const listener of entry.listeners) listener()
}
/** Esvazia o rascunho (depois de enviar). */
export function clearDraft(id: string): void {
  const entry = draftEntry(id)
  entry.pastes.clear(); entry.pills.clear()
  updateDraft(id, () => EMPTY)
}
export function useDraft(id: string): { state: DraftState; set<K extends 'text' | 'caret' | 'files'>(key: K, value: SetStateAction<DraftState[K]>): void } {
  const entry = draftEntry(id)
  const state = useSyncExternalStore(useCallback((cb: () => void) => { entry.listeners.add(cb); return () => { entry.listeners.delete(cb) } }, [entry]), () => entry.state)
  const set = useCallback(<K extends 'text' | 'caret' | 'files'>(key: K, value: SetStateAction<DraftState[K]>): void => {
    updateDraft(id, (s) => ({ [key]: typeof value === 'function' ? (value as (old: DraftState[K]) => DraftState[K])(s[key]) : value }))
  }, [id])
  return { state, set }
}
