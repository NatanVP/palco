// Contratos de parser, presets e endereços compartilhados com as skills.
import { agentForCommand, splitCommand } from '../src/shared/agent-command'
import { normalizeAgentCommand } from '../src/main/domain/command'
import { buildAgentCommand } from '../src/main/pty/agent-command'

describe('linha de comando completa', () => {
  it('o agente sai do programa que a linha inicia (variáveis na frente, caminho, wrapper de shell)', () => {
    expect(agentForCommand('claude --model opus')).toBe('claude')
    expect(agentForCommand('ANTHROPIC_BASE_URL=http://localhost:4000 claude')).toBe('claude')
    expect(agentForCommand('/usr/local/bin/codex --yolo')).toBe('codex')
    expect(agentForCommand('fish -c "claude --model opus"')).toBe('claude')
    expect(agentForCommand("bash -lc 'codex --yolo'")).toBe('codex')
    expect(agentForCommand('op run -- claude')).toBe('other')
    expect(agentForCommand('cc')).toBe('other')
    expect(agentForCommand('')).toBe('shell')
  })

  it('aceita a linha inteira; recusa várias linhas, controle e programa diferente do agente', () => {
    expect(normalizeAgentCommand('claude', 'claude --model opus')).toBe('claude --model opus')
    expect(normalizeAgentCommand('claude', '  FOO=1 claude  ')).toBe('FOO=1 claude')
    expect(normalizeAgentCommand('claude', '')).toBe('claude')
    expect(() => normalizeAgentCommand('claude', 'claude\nrm -rf ~')).toThrow()
    expect(() => normalizeAgentCommand('claude', 'claude \u0007')).toThrow()
    expect(() => normalizeAgentCommand('claude', 'X=1')).toThrow(/programa/)
    expect(() => normalizeAgentCommand('codex', '-x')).toThrow()
    expect(() => normalizeAgentCommand('claude', 'fish -c "claude')).toThrow(/aspas/)
    for (const bad of ['claude; rm -rf /', 'claude | tee x', 'claude && x', 'claude > x', 'claude `x`', 'claude $(x)', 'claude "$(x)"'])
      expect(() => normalizeAgentCommand('claude', bad)).toThrow()
    // O script de dentro do wrapper segue a mesma regra para impedir o desvio dos hooks.
    expect(() => normalizeAgentCommand('claude', 'fish -c "claude --model opus; echo fim"')).toThrow()
  })

  it('separa a linha como o shell (aspas e barra), sem expandir nada', () => {
    expect(splitCommand(`A=1 fish -c "claude --model 'x y'" $HOME`)).toEqual(['A=1', 'fish', '-c', "claude --model 'x y'", '$HOME'])
  })

  it('hooks e role entram depois do comando do agente, dentro do wrapper de shell quando há um', () => {
    const direct = buildAgentCommand('claude', 'ANTHROPIC_BASE_URL=x claude --model opus', '/bin/palco')
    expect(direct.startsWith('ANTHROPIC_BASE_URL=x claude --model opus --settings ')).toBe(true)
    const wrapped = buildAgentCommand('claude', 'fish -c "claude --model opus"', '/bin/palco')
    expect(wrapped.startsWith("fish -c 'claude --model opus --settings ")).toBe(true)
    // O script de dentro, desfeito pelo shell, é o comando direto completo.
    const inner = splitCommand(wrapped)[2]!
    expect(inner).toBe(buildAgentCommand('claude', 'claude --model opus', '/bin/palco'))
    const codex = buildAgentCommand('codex', "bash -c 'codex --yolo'", '/bin/palco')
    expect(splitCommand(codex)[2]!.startsWith('codex --yolo -s danger-full-access')).toBe(true)
  })
})

import { quickStartTiles, quickTileForm } from '../src/renderer/src/dialogs/new-terminal'
import { floorTabs } from '../src/renderer/src/floors/floor-view'
import type { Workspace } from '../src/shared/model'

describe('início rápido respeita os presets', () => {
  it('embutidos ainda não gravados primeiro, depois a ordem da lista; mesmo nome é o preset gravado; quickStart off esconde', () => {
    const tiles = quickStartTiles([
      { name: 'Claude Opus', agent: 'claude', command: 'claude --model opus', maestro: true, account: 'Trabalho', role: 'revisor' },
      { name: 'Escondido', agent: 'codex', command: 'codex', quickStart: false },
      { name: 'Codex', agent: 'codex', command: 'codex --yolo' },
      { name: 'OpenCode', agent: 'other', command: 'opencode', quickStart: false }
    ])
    expect(tiles.map((t) => t.name)).toEqual(['Claude Code', 'Antigravity', 'Shell', 'Claude Opus', 'Codex'])
    expect(tiles[4]!.command).toBe('codex --yolo')
    const opus = tiles.find((t) => t.name === 'Claude Opus')!
    expect(quickTileForm(opus, [{ id: 'a1', name: 'Trabalho', agent: 'claude' }])).toMatchObject({ command: 'claude --model opus', maestro: true, role: 'revisor', accountId: 'a1', monitor: true })
    expect(quickTileForm(tiles[2]!, [])).toMatchObject({ command: '', monitor: false, role: null, accountId: null })
  })
})

describe('status do térreo na barra de andares', () => {
  it('Ground mostra a linha publicada', () => {
    const ws = { id: 'w', name: 'W', nodes: {}, connections: [], floors: {}, activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 }, groundStatus: { state: 'review', text: '2 de 3 andares em revisão' } } as unknown as Workspace
    expect(floorTabs(ws)[0]).toMatchObject({ label: 'Ground', status: { text: '2 de 3 andares em revisão' }, tooltip: 'review — 2 de 3 andares em revisão' })
  })
})

import { HELP, helpFor } from '../src/cli/help'
import { parseArgs } from '../src/cli/args'

describe('ajuda por comando', () => {
  it('palco <comando> [sub] --help mostra só as linhas dele; nada batendo, a ajuda inteira', () => {
    expect(parseArgs(['note', 'stack', '--help'])).toEqual({ cmd: 'help' })
    expect(helpFor(['recruit', '--help']).split('\n').filter((l) => l.startsWith('palco ')).every((l) => l.startsWith('palco recruit'))).toBe(true)
    expect(helpFor(['note', 'stack', '--help'])).toContain('palco note stack')
    expect(helpFor(['note', 'stack', '--help'])).not.toContain('palco recruit')
    expect(helpFor(['nada', '--help'])).toBe(HELP)
    expect(helpFor(['--help'])).toBe(HELP)
  })
  it('--raw "\\n" é Enter (CR)', () => {
    expect(parseArgs(['ask', 'A', '--raw', String.raw`1\n`])).toMatchObject({ data: '1\r' })
  })
})

import { FLAG_HELP } from '../src/cli/help'

describe("ajuda detalhada", () => {
  it('cada flag que o uso do comando cita tem uma linha de explicação', () => {
    for (const [cmd, sub] of [['recruit'], ['floor', 'create'], ['floor', 'status'], ['routine', 'create'], ['band', 'create'], ['preset', 'set'], ['role', 'create'], ['workspace', 'create'], ['space', 'edit'], ['partitura', 'insert'], ['note', 'create'], ['arrange'], ['list']] as string[][]) {
      const out = helpFor([cmd!, ...(sub ? [sub] : []), '--help'])
      const usage = out.split('\n').filter((l) => l.startsWith('palco ')).join(' ')
      const flags = [...new Set(usage.match(/--[a-z][a-z-]*/g) ?? [])]
      expect(flags.length, `${cmd} ${sub ?? ''}`).toBeGreaterThan(0)
      for (const f of flags) expect(out, `${cmd} ${sub ?? ''}: ${f}`).toMatch(new RegExp(`^  ${f}\\b.{3,}`, 'm'))
    }
    expect(Object.keys(FLAG_HELP).length).toBeGreaterThan(10)
  })
})

import { formatFloors, formatRoles, formatRoutines } from '../src/cli/text-format'

describe("listas em texto agrupado", () => {
  it('role list: Workspace atual e Globais', () => {
    expect(formatRoles({ current: [{ name: 'api', preview: 'Cuide da API' }], global: [] })).toBe('Workspace atual:\n  - name: "api"\n    preview: "Cuide da API"\n\nGlobais:\n  (nenhum)\n')
  })
  it('floor list: térreo e andares com branch, pasta, nós e status', () => {
    const out = formatFloors([{ name: 'Ground', dir: '/p', nodes: 3, active: true, status: { state: 'review', text: '2 de 3' } }, { name: 'UI', branch: 'palco/ui', baseRef: 'main', dir: '/p.floors/ui', git: true, nodes: 0, status: { state: 'working', progress: '6/8', text: 'testes' } }])
    expect(out).toContain('- name: "Ground"  (na tela)\n  dir: "/p"\n  nós: 3\n  status: review — 2 de 3')
    expect(out).toContain('- name: "UI"\n  branch: "palco/ui" (de main)\n  dir: "/p.floors/ui"\n  nós: 0\n  status: working — testes (6/8)')
  })
  it('routine list: id curto, agenda, destino e status', () => {
    expect(formatRoutines([])).toBe('Nenhuma rotina neste workspace.\n')
    const out = formatRoutines([{ name: 'Daily', shortId: 'a1b2c3d4', schedule: 'seg, qua às 09:00', terminal: '(lembrete)', enabled: false }])
    expect(out).toBe('- a1b2c3d4  "Daily"\n  agenda: seg, qua às 09:00\n  destino: (lembrete)\n  status: pausada\n')
  })
})

import { crossWorkspacePeers } from '../src/renderer/src/floors/floor-view'
import { crossLinkViews } from '../src/main/domain/cross-link-view'

describe("cordas entre workspaces na UI", () => {
  it('o main resolve as pontas; o card mostra a outra ponta como Nome @ Workspace', () => {
    const nodes: Record<string, { id: string; name: string; floorId: string | null }> = { a: { id: 'a', name: 'Eu', floorId: null }, b: { id: 'b', name: 'Lince', floorId: 'f1' }, c: { id: 'c', name: 'Mesmo', floorId: null } }
    const owner: Record<string, string> = { a: 'w1', b: 'w2', c: 'w1' }
    const views = crossLinkViews([{ id: 'l1', a: 'a', b: 'b' }, { id: 'l2', a: 'a', b: 'sumiu' }, { id: 'l3', a: 'a', b: 'c' }], {
      node: (id) => nodes[id] as never, workspaceOf: (id) => owner[id], list: () => [{ id: 'w1', name: 'Projeto', spaceId: null }, { id: 'w2', name: 'Frontend', spaceId: null }]
    })
    expect(views).toEqual([{ id: 'l1', a: { id: 'a', name: 'Eu', workspaceId: 'w1', workspace: 'Projeto', floorId: null }, b: { id: 'b', name: 'Lince', workspaceId: 'w2', workspace: 'Frontend', floorId: 'f1' } }])
    expect(crossWorkspacePeers(views, 'a')).toEqual([{ linkId: 'l1', peerId: 'b', label: 'Lince @ Frontend' }])
    expect(crossWorkspacePeers(views, 'b')).toEqual([{ linkId: 'l1', peerId: 'a', label: 'Eu @ Projeto' }])
    expect(crossWorkspacePeers(views, 'c')).toEqual([])
  })
})
