import { randomUUID } from 'node:crypto'
import type { Routine, RoutineRun, Schedule } from '../../shared/model'
import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'

const TYPE = 'routines'
const VERSION = 1
const HISTORY_TYPE = 'routineHistory'
const HISTORY_MAX = 200

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const isoOk = (v: unknown): boolean => str(v) && !Number.isNaN(Date.parse(v))
const timeOk = (v: unknown): boolean => str(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

const dayOk = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6

/** Formato das agendas (`every.seconds`, `weekly.days`), aceitando e convertendo o anterior (`minutes`, `day`). */
function normalizeSchedule(s: unknown): Schedule | undefined {
  if (!obj(s)) return undefined
  switch (s.kind) {
    case 'every': {
      const seconds = s.seconds !== undefined ? s.seconds : Number.isInteger(s.minutes) ? (s.minutes as number) * 60 : NaN
      return Number.isInteger(seconds) && (seconds as number) >= 10 && (seconds as number) <= 86_400 ? { kind: 'every', seconds: seconds as number } : undefined
    }
    case 'daily': return timeOk(s.time) ? { kind: 'daily', time: s.time as string } : undefined
    case 'weekly': {
      const days = Array.isArray(s.days) ? s.days : s.day !== undefined ? [s.day] : []
      return days.length > 0 && days.every(dayOk) && timeOk(s.time) ? { kind: 'weekly', days: [...new Set(days as number[])].sort((a, b) => a - b), time: s.time as string } : undefined
    }
    case 'once': return isoOk(s.at) ? { kind: 'once', at: s.at as string } : undefined
    default: return undefined
  }
}
function validSchedule(s: unknown): s is Schedule { return normalizeSchedule(s) !== undefined }

function validRoutine(r: unknown): r is Routine {
  return obj(r) && str(r.id) && r.id !== '' && str(r.name) && r.name.trim() !== '' && validSchedule(r.schedule)
    && str(r.terminalId) && str(r.content) && typeof r.enabled === 'boolean' && str(r.createdBy)
    && (r.remaining === undefined || (Number.isInteger(r.remaining) && (r.remaining as number) >= 0))
    && (r.until === undefined || isoOk(r.until))
    && (r.startsAt === undefined || isoOk(r.startsAt))
    && (r.workspaceId === undefined || (str(r.workspaceId) && r.workspaceId !== ''))
    && (r.reminder === undefined || typeof r.reminder === 'boolean')
    && (r.preRun === undefined || str(r.preRun))
    && (r.skipIfBusy === undefined || typeof r.skipIfBusy === 'boolean')
    && (r.notify === undefined || typeof r.notify === 'boolean')
    && (r.background === undefined || typeof r.background === 'boolean')
    && (r.floorId === undefined || r.floorId === null || (str(r.floorId) && r.floorId !== ''))
    && (r.background !== true || (r.terminalId === '' && r.reminder !== true))
    && (r.reminder === true || r.background === true || r.terminalId !== '')
}

function validRun(r: unknown): r is RoutineRun {
  return obj(r) && str(r.id) && str(r.routineId) && str(r.routineName) && str(r.content) && isoOk(r.firedAt) && str(r.result)
    && (r.workspaceId === undefined || str(r.workspaceId)) && (r.terminalName === undefined || str(r.terminalName))
}

/** Rotinas persistidas em `~/.palco/routines.json`; grava a cada mudança (são poucas). */
export class RoutineStore {
  private routines: Routine[] = []
  private readonly cbs = new Set<(list: Routine[]) => void>()
  private readOnly = false
  warning?: string
  private runs: RoutineRun[] = []
  private readonly runCbs = new Set<(list: RoutineRun[]) => void>()
  private readonly historyFile: string
  private historyReadOnly = false

  constructor(private readonly file: string) {
    this.historyFile = `${file.replace(/\.json$/, '')}-history.json`
    try {
      const { payload, readOnly } = readEnvelope<unknown>(this.historyFile, HISTORY_TYPE, VERSION)
      this.historyReadOnly = readOnly
      if (Array.isArray(payload)) this.runs = payload.filter(validRun).slice(-HISTORY_MAX)
    } catch {
      // Ilegível: fica como está no disco e o histórico desta sessão não é gravado.
      this.historyReadOnly = true
    }
    try {
      const { payload, readOnly } = readEnvelope<unknown>(file, TYPE, VERSION)
      this.readOnly = readOnly
      if (readOnly) this.warning = 'Rotinas de versão futura: somente leitura'
      if (payload !== null) {
        const items = Array.isArray(payload) ? payload : []
        this.routines = items.filter(validRoutine).map((r) => ({ ...structuredClone(r), schedule: normalizeSchedule(r.schedule)! }))
        const dropped = items.length - this.routines.length
        if (dropped > 0) this.warning = `${dropped} rotina inválida descartada`
      }
    } catch {
      this.readOnly = true
      this.warning = 'Arquivo de rotinas ilegível: somente leitura'
    }
  }

  list(): Routine[] { return structuredClone(this.routines) }

  byName(name: string, scope: (r: Routine) => boolean = () => true): Routine | undefined {
    const r = this.routines.find((x) => x.name.toLowerCase() === name.trim().toLowerCase() && scope(x))
    return r && structuredClone(r)
  }

  byId(id: string): Routine | undefined {
    const r = this.routines.find((x) => x.id === id)
    return r && structuredClone(r)
  }

  add(r: Omit<Routine, 'id'>, scope?: (r: Routine) => boolean): Routine {
    this.assertWritable()
    if (this.byName(r.name, scope)) throw new Error(`já existe uma rotina chamada '${r.name}'`)
    const routine = { ...structuredClone(r), id: randomUUID() }
    if (!validRoutine(routine)) throw new Error('rotina inválida')
    this.routines.push(routine)
    this.changed()
    return structuredClone(routine)
  }

  patch(id: string, p: Partial<Omit<Routine, 'id'>>): void {
    this.assertWritable()
    const i = this.routines.findIndex((x) => x.id === id)
    if (i === -1) throw new Error('rotina inexistente')
    const next = { ...this.routines[i]!, ...structuredClone(p), id }
    for (const k of Object.keys(next) as Array<keyof Routine>) if (next[k] === undefined) delete next[k]
    if (!validRoutine(next)) throw new Error('rotina inválida')
    this.routines[i] = next
    this.changed()
  }

  remove(id: string): void {
    this.assertWritable()
    const before = this.routines.length
    this.routines = this.routines.filter((x) => x.id !== id)
    if (this.routines.length !== before) this.changed()
  }

  /** Os últimos disparos, do mais antigo ao mais novo. */
  history(): RoutineRun[] { return structuredClone(this.runs) }

  addRun(run: Omit<RoutineRun, 'id'>): string {
    const id = randomUUID()
    this.runs = [...this.runs, { ...structuredClone(run), id }].slice(-HISTORY_MAX)
    this.historyChanged()
    return id
  }

  /** Corrige o resultado do disparo mais recente daquela rotina (recusa que chega depois). */
  amendLastRun(routineId: string, result: string): void {
    const i = this.runs.map((r) => r.routineId).lastIndexOf(routineId)
    if (i === -1) return
    this.runs[i] = { ...this.runs[i]!, result }
    this.historyChanged()
  }

  removeRun(id: string): void {
    const kept = this.runs.filter((r) => r.id !== id)
    if (kept.length === this.runs.length) return
    this.runs = kept
    this.historyChanged()
  }

  clearHistory(): void {
    if (!this.runs.length) return
    this.runs = []
    this.historyChanged()
  }

  onHistory(cb: (list: RoutineRun[]) => void): () => void {
    this.runCbs.add(cb)
    return () => this.runCbs.delete(cb)
  }

  private historyChanged(): void {
    if (!this.historyReadOnly) {
      try { writeEnvelopeAtomic(this.historyFile, HISTORY_TYPE, VERSION, this.runs) }
      catch (err) { this.warning = `Falha ao gravar rotinas: ${(err as Error).message}` }
    }
    const snapshot = this.history()
    for (const cb of this.runCbs) cb(snapshot)
  }

  onChange(cb: (list: Routine[]) => void): () => void {
    this.cbs.add(cb)
    return () => this.cbs.delete(cb)
  }

  private assertWritable(): void {
    if (this.readOnly) throw new Error('rotinas em modo somente leitura')
  }

  private changed(): void {
    try {
      writeEnvelopeAtomic(this.file, TYPE, VERSION, this.routines)
    } catch (err) {
      this.warning = `Falha ao gravar rotinas: ${(err as Error).message}`
    }
    const snapshot = this.list()
    for (const cb of this.cbs) cb(snapshot)
  }
}
