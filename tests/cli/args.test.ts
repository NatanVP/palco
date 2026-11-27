import { parseArgs, unescapePrompt } from '../../src/cli/args'

it('decodes prompt newlines and tabs while preserving quotes, dollars and literal backslashes', () => {
  expect(parseArgs(['ask', 'Revisor', String.raw`a\nb\t"$HOME"`])).toEqual({ cmd: 'ask', to: 'Revisor', prompt: 'a\nb\t"$HOME"' })
  expect(unescapePrompt(String.raw`literal\\n and \q`)).toBe(String.raw`literal\n and \q`)
  expect(unescapePrompt('trailing\\')).toBe('trailing\\')
})
it.each([
  [[], { cmd: 'help' }],
  [['help'], { cmd: 'help' }],
  [['--help'], { cmd: 'help' }],
  [['list'], { cmd: 'list' }],
  [['check', 'Codex'], { cmd: 'check', name: 'Codex' }],
  [['note', 'read', 'X'], { cmd: 'note-read', name: 'X' }],
  [['note', 'read', 'X', '10'], { cmd: 'note-read', name: 'X', offset: 10 }],
  [['note', 'read', 'X', '10', '20'], { cmd: 'note-read', name: 'X', offset: 10, limit: 20 }],
  [['note', 'create'], { cmd: 'note-create', content: '' }],
  [['note', 'create', String.raw`a\nb`, '--name', 'Pinned'], { cmd: 'note-create', content: 'a\nb', name: 'Pinned' }],
  [['note', 'create', '--name', 'Pinned', String.raw`a\tb`], { cmd: 'note-create', content: 'a\tb', name: 'Pinned' }],
  [['note', 'write', 'X', String.raw`a\nb`], { cmd: 'note-write', name: 'X', content: 'a\nb' }],
  [['note', 'write', 'X', ''], { cmd: 'note-write', name: 'X', content: '' }],
  [['note', 'edit', 'X', String.raw`old\n`, 'new'], { cmd: 'note-edit', name: 'X', old: 'old\n', new: 'new' }],
  [['hook', 'claude-stop'], { cmd: 'hook-claude-stop' }],
  [['hook', 'claude-busy'], { cmd: 'hook-claude-busy' }],
  [['hook', 'claude-ready'], { cmd: 'hook-claude-ready' }],
  [['hook', 'codex-notify', '{"type":"agent-turn-complete"}'], { cmd: 'hook-codex-notify', payload: '{"type":"agent-turn-complete"}' }]
] as const)('parses %j', (args, expected) => {
  const input = [...args]
  expect(parseArgs(input)).toEqual(expected)
  expect(input).toEqual(args)
})
it.each([
  ['unknown'], ['ask'], ['ask', 'Revisor'], ['ask', '', 'hello'], ['ask', 'X', 'a', 'extra'],
  ['check'], ['list', 'extra'], ['note'], ['note', 'unknown'], ['note', 'read'],
  ['note', 'read', 'X', '0'], ['note', 'read', 'X', '-1'], ['note', 'read', 'X', '1.5'],
  ['note', 'read', 'X', '1e2'], ['note', 'read', 'X', '1', 'NaN'], ['note', 'read', 'X', '9007199254740992'],
  ['note', 'write', 'X'], ['note', 'edit', 'X', 'old'],
  ['note', 'create', '--name'], ['note', 'create', '--name', 'X', '--name', 'Y'],
  ['note', 'create', 'a', 'b'], ['note', 'create', '--unknown'],
  ['hook'], ['hook', 'other'], ['hook', 'codex-notify'], ['hook', 'claude-stop', 'extra'], ['hook', 'claude-busy', 'extra']
].map(args => ({ args })))('rejects invalid arguments with usage: $args', ({ args }) => {
  expect(() => parseArgs(args)).toThrow(/uso: palco/i)
})

it.each([
  [['ask', '--help'], { cmd: 'help' }],
  [['note', 'create', '--help'], { cmd: 'help' }],
  [['ask', 'B', '--help'], { cmd: 'ask', to: 'B', prompt: '--help' }],
  [['ask', '--', '--help', '--help'], { cmd: 'ask', to: '--help', prompt: '--help' }],
  [['note', 'create', '--name', 'X', '--', '--- markdown'], { cmd: 'note-create', name: 'X', content: '--- markdown' }],
  [['note', 'create', '--', '--help'], { cmd: 'note-create', content: '--help' }],
  [['check', '--', '--help'], { cmd: 'check', name: '--help' }],
  [['note', 'write', 'X', '--help'], { cmd: 'note-write', name: 'X', content: '--help' }],
  [['note', 'edit', 'X', String.raw`a\nb`, String.raw`c\td`], { cmd: 'note-edit', name: 'X', old: 'a\nb', new: 'c\td' }]
])('supports literal arguments and first-position help: %j', (args, expected) => {
  expect(parseArgs(args as string[])).toEqual(expected)
})

it.each([
  [['recruit', 'Rev', '--agent', 'codex', '--floor', 'ui', '--band', 'time'], { cmd: 'recruit', name: 'Rev', agent: 'codex', floor: 'ui', band: 'time' }],
  [['recruit', 'Rev', '--command', '/bin/codex', '--dir', '/repo'], { cmd: 'recruit', name: 'Rev', command: '/bin/codex', dir: '/repo' }],
  [['dismiss', 'Rev'], { cmd: 'dismiss', name: 'Rev' }],
  [['band', 'create', 'time', 'A', 'B'], { cmd: 'band-create', name: 'time', members: ['A', 'B'] }],
  [['band', 'add', 'time', 'A'], { cmd: 'band-add', band: 'time', member: 'A' }],
  [['band', 'remove', 'time', 'A'], { cmd: 'band-remove', band: 'time', member: 'A' }],
  [['band', 'dissolve', 'time'], { cmd: 'band-dissolve', band: 'time' }],
  [['floor', 'create', 'ui', '--branch', 'palco/ui', '--from', 'main'], { cmd: 'floor-create', name: 'ui', branch: 'palco/ui', from: 'main' }],
  [['floor', 'list'], { cmd: 'floor-list' }],
  [['floor', 'land', 'ui', '--into', 'main', '--delete-branch', '--keep-floor'], { cmd: 'floor-land', name: 'ui', into: 'main', deleteBranch: true, keepFloor: true }],
  [['floor', 'delete', 'ui', '--force', '--keep-branch'], { cmd: 'floor-delete', name: 'ui', force: true, keepBranch: true }],
  [['floor', 'status'], { cmd: 'floor-status' }],
  // No status de andar, o posicional é o texto; --floor escolhe o andar.
  [['floor', 'status', 'doing work', '--floor', 'ui', '--state', 'working', '--progress', '2/5'], { cmd: 'floor-status', text: 'doing work', floor: 'ui', state: 'working', progress: '2/5' }],
  [['floor', 'status', '--clear'], { cmd: 'floor-status', clear: true }],
  [['portal', 'Web', 'click', 'e5'], { cmd: 'portal', name: 'Web', action: 'click', args: ['e5'] }],
  [['portal', 'Web', 'fill', 'e5', 'a\nb'], { cmd: 'portal', name: 'Web', action: 'fill', args: ['e5', 'a\nb'] }],
  [['portal', 'Web', 'snapshot'], { cmd: 'portal', name: 'Web', action: 'snapshot', args: [] }],
  [['recruit', '--', '--help'], { cmd: 'recruit', name: '--help' }],
  [['floor', 'land', '--help'], { cmd: 'help' }],
  [['band', 'create', '--', '--help', '--member'], { cmd: 'band-create', name: '--help', members: ['--member'] }]
])('parses coordination arguments %j', (args, want) => expect(parseArgs(args as string[])).toEqual(want))
it.each([
  ['recruit', 'X', '--agent', 'invalid'], ['recruit', 'X', '--unknown'], ['recruit', 'X', '--dir'],
  ['floor', 'land', 'ui', '--unknown'], ['floor', 'status', '--state', 'sleeping'],
  ['floor', 'status', '--clear', '--state', 'done'], ['floor', 'list', '--force'],
  ['band', 'add', 'team'], ['band', 'create', 'team', '--unknown'],
  ['portal', 'Web', 'fill', 'e1'], ['portal', 'Web', 'click', 'e1', 'extra'],
  ['portal', 'Web', 'unknown'], ['dismiss', 'X', '--force'],
  ['floor', 'create', 'ui', '--branch', 'one', '--branch', 'two']
])('rejects invalid coordination args %j', (...args) => expect(() => parseArgs(args)).toThrow(/Uso:/i))
it.each([['portal', 'Web', 'fill', 'e1', '-5'], ['recruit', '-x'], ['band', 'create', 'time', '-1'], ['recruit', 'Rev', '--dir', '--x']])('suggests -- for an option-like value: %j', (...args) => {
  expect(() => parseArgs(args)).toThrow(/use.*--/i)
})

describe('routine', () => {
  it('create com cada formato de agenda e opções (sintaxe da skill: --command)', () => {
    expect(parseArgs(['routine', 'create', 'Bom', '--command', 'bom\\ndia', '--daily', '09:00', '--terminal', 'Rev'])).toEqual({ cmd: 'routine-create', name: 'Bom', command: 'bom\ndia', daily: '09:00', terminal: 'Rev' })
    expect(parseArgs(['routine', 'create', 'P', '--command', 'oi', '--every', '1m', '--count', '2', '--until', '2026-12-01', '--disabled'])).toEqual({ cmd: 'routine-create', name: 'P', command: 'oi', every: '1m', count: 2, until: '2026-12-01', disabled: true })
    expect(parseArgs(['routine', 'create', 'W', '--command', 'oi', '--weekly', 'mon@09:00'])).toEqual({ cmd: 'routine-create', name: 'W', command: 'oi', weekly: 'mon@09:00' })
    expect(parseArgs(['routine', 'create', 'O', '--command', 'oi', '--once', '2026-11-24 09:00'])).toEqual({ cmd: 'routine-create', name: 'O', command: 'oi', once: '2026-11-24 09:00' })
  })

  it('create recusa agenda ausente, dupla, count inválido e o formato antigo (conteúdo posicional)', () => {
    expect(() => parseArgs(['routine', 'create', 'X', '--command', 'oi'])).toThrow()
    expect(() => parseArgs(['routine', 'create', 'X', '--command', 'oi', '--every', '1m', '--daily', '09:00'])).toThrow()
    expect(() => parseArgs(['routine', 'create', 'X', '--command', 'oi', '--every', '1m', '--count', '0'])).toThrow()
    expect(() => parseArgs(['routine', 'create', 'X', 'oi', '--every', '1m'])).toThrow()
  })

  it('list, show, enable, disable, run e delete', () => {
    expect(parseArgs(['routine', 'list'])).toEqual({ cmd: 'routine-list' })
    for (const sub of ['show', 'enable', 'disable', 'run', 'delete'] as const) {
      expect(parseArgs(['routine', sub, 'P'])).toEqual({ cmd: `routine-${sub}`, name: 'P' })
      expect(() => parseArgs(['routine', sub])).toThrow()
    }
  })
})
it.each([
  [['recruit', 'Rev', '--preset', 'reviewer'], { cmd: 'recruit', name: 'Rev', preset: 'reviewer' }],
  [['preset', 'create', 'reviewer', '--agent', 'codex', '--role', 'review'], { cmd: 'preset-create', name: 'reviewer', agent: 'codex', role: 'review' }],
  [['preset', 'show', 'reviewer'], { cmd: 'preset-show', name: 'reviewer' }],
  [['role', 'create', 'review', String.raw`a\nb`], { cmd: 'role-create', name: 'review', text: 'a\nb' }],
  [['role', 'assign', 'A', '--none'], { cmd: 'role-assign', name: 'A', none: true }],
  [['role', 'assign', 'A', 'review'], { cmd: 'role-assign', name: 'A', role: 'review' }]
])('parses agents configuration %j', (args, want) => expect(parseArgs(args as string[])).toEqual(want))
it.each([
  [['partitura', 'create', 'Team', '--note-text', 'off', '--description', 'Review'], { cmd: 'partitura-create', name: 'Team', agents: [], noteText: false, description: 'Review' }],
  [['partitura', 'insert', 'Team', '--commands', 'off', '--floor', 'ui'], { cmd: 'partitura-insert', name: 'Team', commands: false, floor: 'ui' }],
  [['partitura', 'list'], { cmd: 'partitura-list' }]
])('parses partitura options %j', (args, want) => expect(parseArgs(args as string[])).toEqual(want))
it('rejects ambiguous command switches for partitura', () => expect(() => parseArgs(['partitura', 'insert', 'X', '--commands', 'maybe'])).toThrow())
