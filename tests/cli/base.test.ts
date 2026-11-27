import { parseArgs } from '../../src/cli/args'
it('batch JSON validation and raw bytes', () => {
  expect(parseArgs(['ask', '--batch', '{"A":"x","B":"y"}'])).toEqual({ cmd: 'ask-batch', prompts: { A: 'x', B: 'y' } })
  for (const json of ['null', '[]', '{}', '{"A":2}', '{']) expect(() => parseArgs(['ask', '--batch', json])).toThrow()
  expect(parseArgs(['ask', 'A', '--raw', String.raw`a\n\t\e\x03\\n`])).toEqual({ cmd: 'ask-raw', to: 'A', data: 'a\r\t\x1b\x03\\n' })
})
it('note options and arrange do not consume flags after terminator', () => {
  expect(parseArgs(['note', 'create', '--stack', '--color', '#88aaff', '--', '--name'])).toEqual({ cmd: 'note-create', content: '--name', stack: 'Fichário', color: '#88aaff' })
  expect(parseArgs(['arrange', '--', '--name'])).toEqual({ cmd: 'arrange', target: '--name' })
})
