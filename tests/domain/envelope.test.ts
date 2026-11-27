import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readEnvelope, writeEnvelopeAtomic } from '../../src/main/domain/envelope'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(process.cwd(), 'tests/domain/.envelope-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

it('returns an empty writable result for an absent file', () => {
  expect(readEnvelope(join(dir, 'absent'), 'workspace', 1)).toEqual({ payload: null, readOnly: false })
})

it('round trips an envelope, creates parents and sorts nested object keys without reordering arrays', () => {
  const file = join(dir, 'nested', 'workspace.json')
  writeEnvelopeAtomic(file, 'workspace', 1, { z: [{ z: 2, a: 1 }, 0], a: 'ação' })
  expect(readEnvelope(file, 'workspace', 1)).toEqual({
    payload: { a: 'ação', z: [{ a: 1, z: 2 }, 0] }, readOnly: false
  })
  const raw = readFileSync(file, 'utf8')
  expect(raw.indexOf('"payload"')).toBeLessThan(raw.indexOf('"schemaVersion"'))
  expect(raw.indexOf('"a"')).toBeLessThan(raw.indexOf('"z"'))
  expect(readdirSync(join(dir, 'nested'))).toEqual(['workspace.json'])
  writeEnvelopeAtomic(file, 'workspace', 1, { replacement: true })
  expect(readEnvelope(file, 'workspace', 1).payload).toEqual({ replacement: true })
})

it('returns a newer schema without allowing writes', () => {
  const file = join(dir, 'workspace.json')
  writeFileSync(file, JSON.stringify({ type: 'workspace', schemaVersion: 2, payload: { future: true } }))
  expect(readEnvelope(file, 'workspace', 1)).toEqual({ payload: { future: true }, readOnly: true })
})

it.each([
  '{', 'null', '[]', '{}',
  '{"type":"preferences","schemaVersion":1,"payload":{}}',
  '{"type":"workspace","schemaVersion":"1","payload":{}}',
  '{"type":"workspace","schemaVersion":0,"payload":{}}',
  '{"type":"workspace","schemaVersion":1}'
])('rejects malformed or mismatched envelopes: %s', raw => {
  const file = join(dir, 'workspace.json')
  writeFileSync(file, raw)
  expect(() => readEnvelope(file, 'workspace', 1)).toThrow('envelope malformado')
})
