import { t } from '../i18n'
export const TEXT_LIMIT = 100_000
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const memory = new Map<string, string>()
export function textDraftStorage(): DraftStorage {
  try { const storage = window.localStorage; storage.getItem('palco.text-draft:probe'); return storage } catch {
    return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value) }, removeItem: key => { memory.delete(key) } }
  }
}
/** Persist the draft before accepting an edit, serialize writes, clear only the acknowledged value. */
export class TextDraft {
  value: string
  private saved: string
  private queued = 0
  private tail: Promise<void> = Promise.resolve()
  private readonly key: string
  constructor(id: string, initial: string, private readonly storage: DraftStorage) {
    this.key = `palco.text-draft:${id}`
    this.saved = initial
    try { this.value = storage.getItem(this.key) ?? initial } catch { this.value = initial }
  }
  get dirty(): boolean { return this.value !== this.saved }
  receive(value: string): void { if (!this.dirty) this.value = value; this.saved = value }
  edit(value: string): void {
    if (value.length > TEXT_LIMIT) throw new Error(t('nodes.text-draft.limite_de_text_limit_caractere', { TEXT_LIMIT }))
    try { this.storage.setItem(this.key, value) } catch { throw new Error(t('nodes.text-draft.nao_foi_possivel_preservar_o_r')) }
    this.value = value
  }
  save(write: (value: string) => Promise<void>): Promise<void> {
    if (!this.dirty && this.queued === 0) return Promise.resolve()
    const value = this.value
    if (value.length > TEXT_LIMIT) return Promise.reject(new Error(t('nodes.text-draft.limite_de_text_limit_caractere_2', { TEXT_LIMIT })))
    this.queued++
    const pending = this.tail.then(async () => {
      if (value !== this.saved) await write(value)
      this.saved = value
      if (this.value === value && this.storage.getItem(this.key) === value) this.storage.removeItem(this.key)
    }).finally(() => { this.queued-- })
    this.tail = pending.catch(() => {})
    return pending
  }
}
