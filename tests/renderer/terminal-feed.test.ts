import { describe, expect, it } from 'vitest'
import { TerminalFeed } from '../../src/renderer/src/nodes/terminal-feed'

function setup() {
  const log: string[] = []
  const feed = new TerminalFeed({
    write: (d) => log.push(`w:${d}`),
    reset: () => log.push('reset'),
    requestAttach: () => log.push('attach')
  })
  return { feed, log }
}

describe('TerminalFeed', () => {
  it('bufferiza até o snapshot e descarta seq já incluída', () => {
    const { feed, log } = setup()
    feed.start()
    feed.onData('a', 5, 1)
    feed.onData('b', 6, 1)
    feed.applySnapshot({ data: 'SNAP', seq: 5, gen: 1 })
    expect(log).toEqual(['attach', 'w:SNAP', 'w:b'])
    feed.onData('c', 7, 1)
    feed.onData('dup', 7, 1)
    expect(log.slice(-1)).toEqual(['w:c'])
  })

  it('nova geração: reseta, pede novo attach e descarta eventos da geração antiga', () => {
    const { feed, log } = setup()
    feed.start()
    feed.applySnapshot({ data: 'S', seq: 100, gen: 1 })
    feed.onData('x', 101, 1)
    log.length = 0
    feed.onData('novo', 1, 2)
    expect(log).toEqual(['reset', 'attach'])
    feed.onData('velho', 102, 1)
    feed.applySnapshot({ data: 'NS', seq: 0, gen: 2 })
    expect(log).toEqual(['reset', 'attach', 'w:NS', 'w:novo'])
    feed.onData('depois', 2, 2)
    expect(log.slice(-1)).toEqual(['w:depois'])
  })

  it('snapshot de geração antiga (resposta atrasada) é descartado e refaz o attach', () => {
    const { feed, log } = setup()
    feed.start()
    feed.onData('n', 1, 3) // o processo reiniciou enquanto o attach estava em voo
    feed.applySnapshot({ data: 'ANTIGO', seq: 9, gen: 2 })
    expect(log).toEqual(['attach', 'reset', 'attach'])
    feed.applySnapshot({ data: 'NOVO', seq: 0, gen: 3 })
    expect(log.slice(-2)).toEqual(['w:NOVO', 'w:n'])
  })

  it('geração 0 (terminal inexistente) não derruba a feed', () => {
    const { feed, log } = setup()
    feed.start()
    feed.applySnapshot({ data: '', seq: 0, gen: 0 })
    feed.onData('a', 1, 1)
    expect(log).toContain('reset')
  })
})
