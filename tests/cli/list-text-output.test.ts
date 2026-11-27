import { parseArgs } from '../../src/cli/args'
import { formatWorkspaces, type WorkspaceSpaceRow } from '../../src/cli/text-format'

const p = (...argv: string[]) => parseArgs(argv)

describe('workspace list', () => {
  it('aceita --json e recusa outros argumentos', () => {
    expect(p('workspace', 'list')).toEqual({ cmd: 'workspace-list' })
    expect(p('workspace', 'list', '--json')).toEqual({ cmd: 'workspace-list', json: true })
    expect(() => p('workspace', 'list', 'x')).toThrow()
  })

  const ws = (name: string, extra: Partial<WorkspaceSpaceRow['workspaces'][number]> = {}) => ({ name, dir: `/p/${name}`, floors: 0, ...extra })

  it('um espaço: raiz primeiro, depois cada grupo (vazio também), com pasta, andares e o terminal marcado', () => {
    const out = formatWorkspaces([{
      space: 'Início', onScreen: true,
      workspaces: [ws('palco', { floors: 2, current: true, active: true }), ws('solto', { dir: null })],
      groups: [{ name: 'Clientes', workspaces: [ws('acme', { floors: 1 })] }, { name: 'Arquivo', workspaces: [] }]
    }])
    expect(out).toBe([
      '- "palco"  (seu terminal está aqui)',
      '  dir: "/p/palco"',
      '  andares: 2',
      '- "solto"',
      '  dir: (sem pasta)',
      '  andares: 0',
      '- grupo "Clientes":',
      '    - "acme"',
      '      dir: "/p/acme"',
      '      andares: 1',
      '- grupo "Arquivo":',
      '    (vazio)',
      ''
    ].join('\n'))
  })

  it('vários espaços: um título por espaço, marcando o que está na tela', () => {
    const out = formatWorkspaces([
      { space: 'Início', workspaces: [ws('a')], groups: [] },
      { space: 'Clientes', onScreen: true, workspaces: [], groups: [] }
    ])
    expect(out).toBe([
      'Espaço "Início":',
      '  - "a"',
      '    dir: "/p/a"',
      '    andares: 0',
      '',
      'Espaço "Clientes"  (na tela):',
      '  (vazio)',
      ''
    ].join('\n'))
  })

  it('nenhum workspace', () => {
    expect(formatWorkspaces([{ space: 'Início', workspaces: [], groups: [] }])).toBe('Nenhum workspace.\n')
  })
})
