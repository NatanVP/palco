import { resetText } from '../../src/renderer/src/usage/reset-text'

const now = new Date(2026, 10, 24, 10, 0)
const at = (d: number, h: number, m = 0): string => new Date(2026, 10, d, h, m).toISOString()

describe('resetText', () => {
  it('minutos, horas, amanhã, depois de amanhã e dias', () => {
    expect(resetText(at(24, 10, 35), now)).toBe('Redefine em 35 min')
    expect(resetText(at(24, 12, 10), now)).toBe('Redefine em 2 horas')
    expect(resetText(at(24, 11, 0), now)).toBe('Redefine em 1 hora')
    expect(resetText(at(25, 9), now)).toBe('Redefine amanhã')
    expect(resetText(at(26, 9), now)).toBe('Redefine depois de amanhã')
    expect(resetText(at(29, 9), now)).toBe('Redefine em 5 dias')
  })

  it('passado ou desconhecido', () => {
    expect(resetText(at(24, 9), now)).toBe('Redefine agora')
    expect(resetText(null, now)).toBe('')
  })
})
