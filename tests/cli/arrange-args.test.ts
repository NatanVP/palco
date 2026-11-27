import { parseArgs } from '../../src/cli/args'
import { formatLook } from '../../src/cli/text-format'

const p = (...argv: string[]) => parseArgs(argv)

describe('arrange', () => {
  it('aceita --json só sem opções de mudança', () => {
    expect(p('arrange')).toEqual({ cmd: 'arrange' })
    expect(p('arrange', '--json')).toEqual({ cmd: 'arrange', json: true })
    expect(p('arrange', 'Nota', '--json')).toEqual({ cmd: 'arrange', target: 'Nota', json: true })
    expect(() => p('arrange', '--name', 'X', '--json')).toThrow()
    expect(() => p('arrange', '--json', '--json')).toThrow()
    expect(p('arrange', '--', '--json')).toEqual({ cmd: 'arrange', target: '--json' })
  })

  it('formatLook mostra nome, ícone e cor', () => {
    expect(formatLook({ name: 'Maestro' })).toBe('name: "Maestro"\nicon: (padrão)\ncolor: (padrão)\n')
    expect(formatLook({ name: 'N', icon: 'bot', color: '#88aaff' })).toBe('name: "N"\nicon: bot\ncolor: #88aaff\n')
  })
})
