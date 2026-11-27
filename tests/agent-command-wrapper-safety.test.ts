// Regressões das operações puras de workspace e canvas.
import { normalizeAgentCommand } from '../src/main/domain/command'
import { buildAgentCommand } from '../src/main/pty/agent-command'
import { commandError } from '../src/renderer/src/dialogs/new-terminal'

describe("hooks e role não podem ser desviados nem comentados", () => {
  it.each([
    "bash -c 'claude; printf fim'",
    'claude # comentário',
    "bash -c 'claude # comentário'",
    'fish -c "claude --model opus; echo fim"',
    "bash -c 'claude && x'",
    "bash -c 'claude | tee x'",
    "bash -c 'claude $(x)'"
  ])('recusa %s (no main e na UI)', (line) => {
    expect(() => normalizeAgentCommand('claude', line)).toThrow()
    expect(commandError(line)).not.toBeNull()
  })
  it('aceita # dentro de aspas e no meio de palavra; o wrapper legítimo continua', () => {
    expect(normalizeAgentCommand('claude', "claude --append-system-prompt '# título'")).toBe("claude --append-system-prompt '# título'")
    expect(normalizeAgentCommand('claude', 'claude --tag a#b')).toBe('claude --tag a#b')
    expect(normalizeAgentCommand('claude', 'fish -c "claude --model opus"')).toBe('fish -c "claude --model opus"')
  })
})

describe("o wrapper reconstruído preserva a linha original", () => {
  it('atribuição com espaço, $HOME e aspas ficam como foram digitados; só o script muda', () => {
    const out = buildAgentCommand('claude', `LABEL='a b' bash -c 'claude --model opus' "$HOME"`, '/bin/palco')
    expect(out.startsWith(`LABEL='a b' bash -c 'claude --model opus --settings `)).toBe(true)
    expect(out.endsWith(` "$HOME"`)).toBe(true)
  })
})
