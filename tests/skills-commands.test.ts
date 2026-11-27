import { parseArgs } from '../src/cli/args'
import { parseRecall, parseSay } from '../src/cli/chat'
import { skillCommands } from './helpers/skill-commands'

// Inventário explícito de famílias de comandos ainda não cobertas pelo parser.
export const PENDING_COMMAND_FAMILIES: string[] = []

const cases = skillCommands()
// Portal parser/runtime complete; keep the explicit inventory empty. Native E2E is a separate gate.
export const PENDING_PORTAL_ACTIONS: string[] = []
const pendingPortal = cases.filter(c => c.args[0] === 'portal' && PENDING_PORTAL_ACTIONS.includes(c.args[1]!))
const pending = cases.filter(c => PENDING_COMMAND_FAMILIES.includes(c.args[0]!))
const active = cases.filter(c => !PENDING_COMMAND_FAMILIES.includes(c.args[0]!) && !pendingPortal.includes(c))
it('extrai comandos das seis skills e mantém o inventário explícito de pendências', () => {
  expect(new Set(cases.map(c => c.file)).size).toBe(6)
  expect(active.length).toBeGreaterThan(50)
})
// `say` e `recall` têm parser próprio (src/cli/chat.ts): o `palco` os atende antes do parseArgs.
// `say` e `recall --help` são respondidos antes do parser deles, pela entrada do CLI.
const parse = (args: string[]) => ((args[0] === 'say' || args[0] === 'recall') && args[1] === '--help' ? { cmd: 'help' } : args[0] === 'say' ? parseSay(args.slice(1)) : args[0] === 'recall' ? parseRecall(args.slice(1)) : parseArgs(args))
it.each(active)('$file: $source', ({ args }) => { expect(() => parse(args)).not.toThrow() })
it.skip.each(pendingPortal)('PENDING_PORTAL_ACTIONS $file: $source', ({ args }) => { expect(() => parseArgs(args)).not.toThrow() })
it.skip.each(pending)('PENDING_COMMAND_FAMILIES $file: $source', ({ args }) => { expect(() => parseArgs(args)).not.toThrow() })
it.each([...new Set(cases.map(c => c.args[0]!))].filter(f => f !== 'say' && f !== 'recall'))('%s --help', family => { expect(parseArgs([family, '--help']).cmd).toBe('help') })
