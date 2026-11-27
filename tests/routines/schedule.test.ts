import { nextRun, parseSchedule, parseUntil } from '../../src/main/routines/schedule'

// Datas em hora local, como a agenda usa.
const at = (y: number, mo: number, d: number, h: number, mi: number): Date => new Date(y, mo - 1, d, h, mi, 0, 0)
// 2026-11-23 é uma segunda-feira.
const SEG_10_07 = at(2026, 11, 23, 10, 7)

describe('parseSchedule', () => {
  it('aceita exatamente um formato', () => {
    expect(parseSchedule({ every: '30m' }, SEG_10_07)).toEqual({ kind: 'every', seconds: 1800 })
    expect(parseSchedule({ every: '2h' }, SEG_10_07)).toEqual({ kind: 'every', seconds: 7200 })
    expect(parseSchedule({ daily: '09:00' }, SEG_10_07)).toEqual({ kind: 'daily', time: '09:00' })
    expect(parseSchedule({ weekly: 'seg@09:00' }, SEG_10_07)).toEqual({ kind: 'weekly', days: [1], time: '09:00' })
    expect(parseSchedule({ weekly: 'sun@9:05' }, SEG_10_07)).toEqual({ kind: 'weekly', days: [0], time: '09:05' })
    expect(() => parseSchedule({}, SEG_10_07)).toThrow('use exatamente um de')
    expect(() => parseSchedule({ every: '5m', daily: '09:00' }, SEG_10_07)).toThrow('use exatamente um de')
  })

  it('recusa valores inválidos', () => {
    // Número sozinho agora é minutos (skill palco-routines): '30' vale.
    for (const every of ['0m', '25h', '-5m', 'xm', '1441m', '5s']) expect(() => parseSchedule({ every }, SEG_10_07)).toThrow()
    for (const daily of ['24:00', '9', '09:60', 'aa:bb']) expect(() => parseSchedule({ daily }, SEG_10_07)).toThrow()
    expect(() => parseSchedule({ weekly: 'xyz@09:00' }, SEG_10_07)).toThrow('dia inválido')
  })

  it('once: data completa, HH:MM (próxima ocorrência) e passado recusado', () => {
    expect(parseSchedule({ once: '2026-11-24T09:00' }, SEG_10_07)).toEqual({ kind: 'once', at: at(2026, 11, 24, 9, 0).toISOString() })
    expect(parseSchedule({ once: '11:00' }, SEG_10_07)).toEqual({ kind: 'once', at: at(2026, 11, 23, 11, 0).toISOString() })
    expect(parseSchedule({ once: '09:00' }, SEG_10_07)).toEqual({ kind: 'once', at: at(2026, 11, 24, 9, 0).toISOString() })
    expect(() => parseSchedule({ once: '2026-11-23T10:00' }, SEG_10_07)).toThrow('horário já passou')
  })
})

describe('nextRun', () => {
  it('every conta a partir de agora', () => {
    expect(nextRun({ kind: 'every', seconds: 1800 }, SEG_10_07)).toEqual(at(2026, 11, 23, 10, 37))
  })

  it('daily: hoje se ainda não passou; na hora exata, amanhã; depois da meia-noite', () => {
    const s = { kind: 'daily' as const, time: '09:00' }
    expect(nextRun(s, at(2026, 11, 23, 8, 59))).toEqual(at(2026, 11, 23, 9, 0))
    expect(nextRun(s, at(2026, 11, 23, 9, 0))).toEqual(at(2026, 11, 24, 9, 0))
    expect(nextRun({ kind: 'daily', time: '00:30' }, at(2026, 11, 30, 23, 0))).toEqual(at(2026, 12, 1, 0, 30))
  })

  it('weekly: mesmo dia depois da hora vai para a semana seguinte', () => {
    expect(nextRun({ kind: 'weekly', days: [1], time: '09:00' }, SEG_10_07)).toEqual(at(2026, 11, 30, 9, 0))
    expect(nextRun({ kind: 'weekly', days: [1], time: '11:00' }, SEG_10_07)).toEqual(at(2026, 11, 23, 11, 0))
    expect(nextRun({ kind: 'weekly', days: [3], time: '08:00' }, SEG_10_07)).toEqual(at(2026, 11, 25, 8, 0))
  })

  it('once: antes do horário devolve o horário; depois, null', () => {
    const s = { kind: 'once' as const, at: at(2026, 11, 24, 9, 0).toISOString() }
    expect(nextRun(s, SEG_10_07)).toEqual(at(2026, 11, 24, 9, 0))
    expect(nextRun(s, at(2026, 11, 24, 9, 0))).toBeNull()
  })
})

describe('parseUntil', () => {
  it('data sem hora vale até o fim do dia; com hora, exata', () => {
    expect(parseUntil('2026-11-30')).toBe(new Date(2026, 10, 30, 23, 59, 59, 999).toISOString())
    expect(parseUntil('2026-11-30T18:00')).toBe(at(2026, 11, 30, 18, 0).toISOString())
    expect(() => parseUntil('amanhã')).toThrow('data inválida')
  })
})
