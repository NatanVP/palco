import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CrossLinkStore } from '../src/main/domain/cross-links'

describe('CrossLinkStore.remove', () => {
  it('tira a corda pelo id, persiste e devolve true; id desconhecido devolve false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'palco-links-'))
    try {
      const file = join(dir, 'links.json')
      const store = new CrossLinkStore(file)
      store.connect('a', 'b')
      store.connect('a', 'c')
      const [ab] = store.list()
      expect(store.remove(ab!.id)).toBe(true)
      expect(store.peers('a')).toEqual(['c'])
      expect(new CrossLinkStore(file).peers('a')).toEqual(['c'])
      expect(readFileSync(file, 'utf8')).not.toContain(ab!.id)
      expect(store.remove(ab!.id)).toBe(false)
      expect(store.remove('nada')).toBe(false)
      expect(store.list()).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('sem arquivo (memória) também remove', () => {
    const store = new CrossLinkStore()
    store.connect('x', 'y')
    expect(store.remove(store.list()[0]!.id)).toBe(true)
    expect(store.list()).toEqual([])
  })
})
