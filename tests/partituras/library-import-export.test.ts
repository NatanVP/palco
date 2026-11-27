import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PartituraStore } from '../../src/main/partituras/partitura-store'
import type { Partitura } from '../../src/shared/model'
let dir: string, lib: PartituraStore
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-library-archive-')); lib = new PartituraStore(join(dir, 'library')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const p: Partitura = { bands: [], name: 'Equipe', createdAt: '2026-11-25', nodes: [], connections: [] }
it('renomeia preservando o conteúdo e recusa colisão sem apagar o original', () => {
 lib.save(p); lib.rename('Equipe', 'Time'); expect(lib.get('Time')).toEqual({ ...p, name: 'Time' }); expect(() => lib.get('Equipe')).toThrow()
 lib.save(p); expect(() => lib.rename('Equipe', 'Time')).toThrow(); expect(lib.get('Equipe')).toEqual(p)
})
it('exporta/importa para biblioteca nova e valida todo arquivo antes de gravar', () => {
 lib.save(p); const other = new PartituraStore(join(dir, 'other')); other.import(lib.export()); expect(other.get('Equipe')).toEqual({ ...p, imported: true })
 expect(() => other.import(lib.export())).toThrow()
 const bad = JSON.stringify({ format: 'palco-partituras', version: 1, partituras: [{ ...p, name: 'Nova' }, {}] })
 expect(() => other.import(bad)).toThrow(); expect(other.list()).toHaveLength(1)
})
