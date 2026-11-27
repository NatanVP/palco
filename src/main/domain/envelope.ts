import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function readEnvelope<T>(path: string, type: string, supported: number): { payload: T | null; readOnly: boolean } {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { payload: null, readOnly: false }
    throw error
  }
  let envelope: unknown
  try { envelope = JSON.parse(raw) } catch { throw new Error('envelope malformado') }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) throw new Error('envelope malformado')
  const value = envelope as Record<string, unknown>
  if (value.type !== type || typeof value.schemaVersion !== 'number' || !Number.isInteger(value.schemaVersion)
      || value.schemaVersion < 1 || !Object.hasOwn(value, 'payload')) throw new Error('envelope malformado')
  return { payload: value.payload as T, readOnly: value.schemaVersion > supported }
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, sorted(item)]))
  }
  return value
}

function syncDirectory(path: string): void {
  const directory = openSync(dirname(path), 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

function replaceDurably(path: string, data: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, data); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, path)
    syncDirectory(path)
  } finally { rmSync(temporary, { force: true }) }
}

export function writeEnvelopeAtomic(path: string, type: string, version: number, payload: unknown): void {
  const data = JSON.stringify(sorted({ type, schemaVersion: version, payload }), null, 2) + '\n'
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    // Only a valid envelope may replace the last known good backup.
    readEnvelope(path, type, version)
    const previous = readFileSync(path, 'utf8')
    if (previous === data) {
      // A previous rename may have succeeded before directory fsync failed.
      // Complete durability without rotating away the previous-good backup.
      const fd = openSync(path, 'r')
      try { fsyncSync(fd) } finally { closeSync(fd) }
      syncDirectory(path)
      return
    }
    replaceDurably(`${path}.bak`, previous)
  }
  replaceDurably(path, data)
}
