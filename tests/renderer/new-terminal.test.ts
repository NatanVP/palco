import { describe, expect, it } from 'vitest'
import { agentForCommand, emptyForm, firstLine, QUICK_START, quickStart, toNewNode, uniqueTerminalName } from '../../src/renderer/src/dialogs/new-terminal'

const frame = { pos: { x: 100, y: 40 }, size: { w: 560, h: 360 } }

describe('início rápido', () => {
  it('cinco atalhos na ordem do palco', () => {
    expect(QUICK_START.map((q) => q.id)).toEqual(['claude', 'codex', 'agy', 'opencode', 'shell'])
  })

  it.each([
    ['claude', 'Claude Code', 'claude'],
    ['codex', 'Codex', 'codex'],
    ['agy', 'Antigravity', 'agy'],
    ['opencode', 'OpenCode', 'opencode'],
    ['shell', 'Shell', '']
  ] as const)('%s preenche nome e comando', (id, name, command) => {
    expect(quickStart(id)).toMatchObject({ name, command })
  })

  it('monitorar atividade liga com comando e desliga no shell', () => {
    expect(quickStart('codex').monitor).toBe(true)
    expect(quickStart('shell').monitor).toBe(false)
  })
})

describe('agente pelo comando', () => {
  it.each([
    ['claude', 'claude'], ['codex', 'codex'], ['', 'shell'], ['   ', 'shell'],
    ['agy', 'antigravity'], ['opencode', 'other'], ['/usr/local/bin/claude', 'claude']
  ] as const)('%j => %s', (command, agent) => {
    expect(agentForCommand(command)).toBe(agent)
  })

  it('só a primeira linha não vazia do comando vale', () => {
    expect(firstLine('\n  claude  \nrm -rf /\n')).toBe('claude')
    expect(firstLine('')).toBe('')
  })
})

describe('nome do terminal', () => {
  it('vazio vira Terminal; repetido ganha o próximo número', () => {
    expect(uniqueTerminalName('', [])).toBe('Terminal')
    expect(uniqueTerminalName('  ', ['Terminal'])).toBe('Terminal 2')
    expect(uniqueTerminalName('Rev', ['rev', 'Rev 2'])).toBe('Rev 3')
    expect(uniqueTerminalName('Novo', ['Rev'])).toBe('Novo')
  })

  it('corta em 120 caracteres', () => {
    expect(uniqueTerminalName('x'.repeat(200), [])).toHaveLength(120)
  })
})

describe('toNewNode', () => {
  it('monta o nó com o frame, o agente do comando e os padrões', () => {
    const node = toNewNode({ ...emptyForm(), ...quickStart('codex'), cwd: '/tmp/proj' }, frame, 'f1', ['Codex'])
    expect(node).toEqual({
      kind: 'terminal', floorId: 'f1', name: 'Codex 2', agent: 'codex', command: 'codex', cwd: '/tmp/proj',
      color: '#007AFF', icon: 'terminal', monitor: true, maestro: false, pos: frame.pos, size: frame.size
    })
  })

  it('agy usa Antigravity e opencode usa agente other; o comando é a primeira linha', () => {
    const node = toNewNode({ ...emptyForm(), command: 'opencode\nexit' }, frame, null, [])
    expect(node).toMatchObject({ agent: 'other', command: 'opencode', name: 'Terminal' })
  })

  it('a escolha explícita vence o tipo inferido pelo comando', () => {
    expect(toNewNode({ ...emptyForm(), command: 'clauded', agent: 'claude' }, frame, null, [])).toMatchObject({ agent: 'claude' })
    expect(toNewNode({ ...emptyForm(), command: 'claude', agent: 'other' }, frame, null, [])).toMatchObject({ agent: 'other' })
  })

  it('role só vale para claude e codex; maestro e conta passam adiante', () => {
    expect(toNewNode({ ...emptyForm(), command: 'claude', role: 'revisor', maestro: true, accountId: 'acc-2' }, frame, null, []))
      .toMatchObject({ agent: 'claude', role: 'revisor', maestro: true, accountId: 'acc-2' })
    expect(toNewNode({ ...emptyForm(), command: '', role: 'revisor' }, frame, null, [])).not.toHaveProperty('role')
    expect(toNewNode({ ...emptyForm(), command: 'agy', role: 'revisor' }, frame, null, [])).not.toHaveProperty('role')
  })

  it('cor e ícone personalizados (emoji) e fonte passam adiante', () => {
    expect(toNewNode({ ...emptyForm(), color: '#FF3B30', icon: '🦊', fontSize: 15 }, frame, null, []))
      .toMatchObject({ color: '#FF3B30', icon: '🦊', fontSize: 15 })
  })
})

import { commandError } from '../../src/renderer/src/dialogs/new-terminal'

describe('commandError', () => {
  it('uma linha que inicia um programa só, como o main exige (flags e variáveis valem)', () => {
    expect(commandError('')).toBeNull()
    expect(commandError('claude')).toBeNull()
    expect(commandError('/opt/bin/opencode')).toBeNull()
    expect(commandError('claude --model x')).toBeNull()
    expect(commandError('FOO=1 fish -c "claude --model x"')).toBeNull()
    expect(commandError('codex; rm -rf ~')).toMatch(/fora de aspas/)
    expect(commandError('-x')).toMatch(/começar com -/)
    expect(commandError('claude "x')).toMatch(/aspas/i)
  })
})

import { SubmitGuard } from '../../src/renderer/src/dialogs/new-terminal'

describe('SubmitGuard (Criar não é reentrante e cancela ao fechar)', () => {
  it('uma operação por vez: o segundo clique é ignorado até a primeira terminar', () => {
    const g = new SubmitGuard()
    const a = g.begin()
    expect(a).not.toBeNull()
    expect(g.begin()).toBeNull()
    expect(g.running).toBe(true)
    a!.end()
    expect(g.running).toBe(false)
    expect(g.begin()).not.toBeNull()
  })

  it('cancelar invalida a operação em andamento e libera a trava', () => {
    const g = new SubmitGuard()
    const a = g.begin()!
    expect(a.alive()).toBe(true)
    g.cancel()
    expect(a.alive()).toBe(false)
    expect(g.running).toBe(false)
    a.end() // terminar uma operação já cancelada não mexe na próxima
    const b = g.begin()!
    a.end()
    expect(g.running).toBe(true)
    expect(b.alive()).toBe(true)
  })
})
