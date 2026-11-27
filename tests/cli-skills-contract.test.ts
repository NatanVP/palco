// Contratos do CLI: exemplos das skills, ajuda, parser e rotas autenticadas.
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../src/cli/args'
import { parseRecall, parseSay } from '../src/cli/chat'
import { AskBroker } from '../src/main/ask/ask-broker'
import { AgentCatalog, PresetStore } from '../src/main/agents/presets'
import { RoleStore } from '../src/main/agents/roles'
import { ChatService } from '../src/main/chat/chat-service'
import { ChatStore } from '../src/main/chat/chat-store'
import { WorkspaceRegistry } from '../src/main/domain/workspace-registry'
import { FloorService } from '../src/main/floors/floor-service'
import { PartituraStore } from '../src/main/partituras/partitura-store'
import { PortalManager } from '../src/main/portal/portal-manager'
import { makeRoutineFire } from '../src/main/routines/fire'
import { RoutineRunner } from '../src/main/routines/routine-runner'
import { RoutineStore } from '../src/main/routines/routine-store'
import { startServer } from '../src/main/server/http-server'
import { ENV_TOKEN } from '../src/shared/auth'
import { ENV_SOCKET, type TerminalNode } from '../src/shared/model'
import { skillCommands } from './helpers/skill-commands'

const cases = skillCommands()
// `say` e `recall --help` são respondidos antes do parser deles, pela entrada do CLI.
const parse = (args: string[]) => ((args[0] === 'say' || args[0] === 'recall') && args[1] === '--help' ? { cmd: 'help' } : args[0] === 'say' ? parseSay(args.slice(1)) : args[0] === 'recall' ? parseRecall(args.slice(1)) : parseArgs(args))

let out: string, cli: string
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'palco-cli-contract-'))
  cli = join(out, 'palco.cjs')
  await build({ entryPoints: ['src/cli/palco.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: cli, logLevel: 'silent' })
})
afterAll(() => rmSync(out, { recursive: true, force: true }))

interface Run { code: number; out: string; err: string }
const run = (args: string[], extra: Record<string, string> = {}, cwd = out): Promise<Run> => new Promise((resolve) => {
  execFile(process.execPath, [cli, ...args], { cwd, env: { PATH: process.env.PATH ?? '', HOME: out, ...extra }, timeout: 15_000 }, (error, stdout, stderr) =>
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: stdout, err: stderr }))
})

describe('comandos citados nas skills', () => {
  it('as seis skills citam comandos', () => {
    expect([...new Set(cases.map((c) => c.file))]).toEqual(['palco', 'palco-chat', 'palco-manager', 'palco-portal', 'palco-routines', 'palco-workspace'])
    expect(cases.length).toBeGreaterThan(150)
  })
  it('o parser aceita todos, com os argumentos citados', () => {
    const refused = cases.flatMap((c) => { try { parse(c.args); return [] } catch (e) { return [`${c.file}: ${c.source} → ${(e as Error).message.slice(0, 120)}`] } })
    expect(refused).toEqual([])
  })
  it('`palco <cmd> [sub] --help` responde com o comando e todas as flags que as skills usam nele', async () => {
    const wanted = new Map<string, Set<string>>()
    const NESTED = ['note', 'band', 'floor', 'portal', 'routine', 'preset', 'role', 'partitura', 'workspace', 'space']
    for (const c of cases) {
      const [family, sub] = c.args
      const key = NESTED.includes(family!) && sub && !sub.startsWith('-') && /^[a-z-]+$/.test(sub) ? `${family} ${sub}` : family!
      // `Nome` é o marcador `<comando>` das frases genéricas da skill.
      if (key === 'help' || key.startsWith('Nome')) continue
      const flags = wanted.get(key) ?? new Set<string>()
      for (const a of c.args) if (/^--[a-z][a-z-]*$/.test(a) && a !== '--help') flags.add(a)
      wanted.set(key, flags)
    }
    const missing: string[] = []
    await Promise.all([...wanted].map(async ([key, flags]) => {
      const r = await run([...key.split(' '), '--help'])
      if (r.code !== 0) { missing.push(`${key} --help saiu com ${r.code}: ${r.err}`); return }
      const family = key.split(' ')[0]!
      if (!r.out.includes(`palco ${family}`)) missing.push(`${key}: a ajuda não mostra o comando`)
      for (const f of flags) if (!r.out.includes(f)) missing.push(`${key}: a ajuda não cita ${f}`)
    }))
    expect(missing.sort()).toEqual([])
  }, 60_000)
})

// ---------- servidor de verdade ----------
let dir: string, socket: string, server: { close(): Promise<void> }, registry: WorkspaceRegistry, chat: ChatService
let running: Set<string>, sessions: Set<string>, disposed: string[], spawned: TerminalNode[], routines: RoutineStore, presets: PresetStore, roles: RoleStore, partituras: PartituraStore
let ids: { boss: string; beta: string; note: string; second: string; secondTerm: string }
const TOKEN = 'tok-boss'
const palco = (...args: string[]) => run(args, { [ENV_SOCKET]: socket, [ENV_TOKEN]: TOKEN }, dir)

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'palco-cli-server-'))
  socket = join(dir, 's.sock')
  registry = new WorkspaceRegistry(join(dir, 'workspaces'))
  const first = registry.activeId(); registry.rename(first, 'Primeiro')
  const second = registry.create('Segundo')
  const store = registry.get(first)
  const term = (ws: string, name: string, extra: Partial<TerminalNode> = {}) =>
    registry.get(ws).addNode({ kind: 'terminal', floorId: null, name, agent: 'shell', command: '', cwd: dir, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }, ...extra } as TerminalNode)
  const boss = term(first, 'Chefe', { maestro: true }), beta = term(first, 'Beta')
  const note = store.addNode({ kind: 'note', floorId: null, name: 'Plano', content: 'um', pos: { x: 0, y: 400 }, size: { w: 300, h: 200 } })
  store.connect(boss, beta); store.connect(boss, note)
  ids = { boss, beta, note, second, secondTerm: term(second, 'Outro') }
  running = new Set([boss, beta, ids.secondTerm]); sessions = new Set(running); disposed = []; spawned = []
  roles = new RoleStore(join(dir, 'roles')); presets = new PresetStore(join(dir, 'presets.json'), roles); partituras = new PartituraStore(join(dir, 'partituras'))
  routines = new RoutineStore(join(dir, 'routines.json'))
  chat = new ChatService({ store: new ChatStore(join(dir, 'chats')), home: dir, deliver: () => {}, write: () => {}, isRunning: () => true, isAgent: () => true, onTerminalData: () => () => {}, now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (t) => clearTimeout(t as NodeJS.Timeout), settleMs: 90_000 })
  const terminals = {
    spawn: (n: TerminalNode) => { spawned.push(n); running.add(n.id); sessions.add(n.id) },
    dispose: (id: string) => { disposed.push(id); running.delete(id); sessions.delete(id) },
    hasSession: (id: string) => sessions.has(id), isRunning: (id: string) => running.has(id), agentState: () => 'ready' as const,
    markReady: () => {}, notePromptHook: () => {}, screenText: () => 'tela', write: () => {},
    identify: (t: string) => (t === TOKEN ? { id: ids.boss, gen: 1 } : undefined)
  }
  const broker = new AskBroker({ deliver: () => {}, screenText: () => 'tela', agentOf: () => 'shell', setTimeout, clearTimeout }, { shellIdleMs: 200, settleMs: 0 })
  const runner = new RoutineRunner({ store: routines, now: () => new Date(), setTimeout, clearTimeout, fire: makeRoutineFire({ workspace: () => store.get(), terminals: { ...terminals, deliverPrompt: () => {}, dialogOpen: () => null }, wake: async () => 'running' }) })
  const floors = new Map<string, FloorService>()
  server = await startServer(socket, {
    registry, broker, terminals, chat, partituras, agents: new AgentCatalog(presets, roles), routines: { store: routines, runner },
    floors: (s) => { const key = s.get().id; return floors.get(key) ?? floors.set(key, new FloorService({ store: s, terminals })).get(key)! }
  })
})
afterEach(async () => {
  await server.close(); chat.dispose(); registry.flushAll()
  rmSync(dir, { recursive: true, force: true })
})

describe('o app tem uma rota para cada comando citado', () => {
  it('nenhum comando citado cai em rota ou ação inexistente, nem em erro interno', async () => {
    const seen = new Set<string>(), bad: string[] = []
    for (const c of cases) {
      const key = JSON.stringify(c.args)
      if (seen.has(key) || c.args.includes('--help') || c.args[0] === 'help') continue
      seen.add(key)
      const r = await palco(...c.args)
      if (/sem rota|ação desconhecida|erro interno|^palco: erro: Uso:/m.test(r.err)) bad.push(`${c.source} → ${r.err.trim().slice(0, 160)}`)
    }
    expect(bad).toEqual([])
  }, 180_000)
})

/** Exemplos dos comandos e flags suportados: o parser deve aceitar cada combinação. */
const COMMANDS: Array<[string, string[]]> = [
  ['list', ['list']], ['notify', ['notify', 'm']], ['ask', ['ask', 'A', 'p']], ['ask --batch', ['ask', '--batch', '{"A":"p"}']], ['ask --raw', ['ask', 'A', '--raw', '2\\n']], ['check', ['check', 'A']],
  ['say', ['say', 't']], ['say --progress', ['say', '--progress', 't']], ['say --attach', ['say', '--attach', '/tmp/a', 't']], ['say --question', ['say', '--question', 'q', '--option', 'a', '--detail', 'd', '--recommended', '--option', 'b']],

  ['recall', ['recall', 'blue', '--turns', '3', '--json']], ['recall --last', ['recall', '--last', 'week']], ['recall --from --to', ['recall', '--from', '2026-01-01', '--to', '2026-01-02']], ['recall --all', ['recall', '--all']], ['recall list', ['recall', 'list']], ['recall attachment', ['recall', 'attachment', 'X']],
  ['note create', ['note', 'create', 't', '--name', 'N', '--stack', 'F', '--color', 'blue']], ['note import --copy', ['note', 'import', 'a.md', '--copy']],
  ['note read', ['note', 'read', 'N', '1', '2']], ['note write', ['note', 'write', 'N', 't']], ['note edit', ['note', 'edit', 'N', 'a', 'b']], ['note stack', ['note', 'stack', 'N', 'F']], ['note unstack', ['note', 'unstack', 'N']], ['note delete', ['note', 'delete', 'N']], ['note delete --stack', ['note', 'delete', '--stack', 'F']],
  ['portal create', ['portal', 'create', 'https://example.com', 'P', '--size', '390x844']], ['portal edit', ['portal', 'edit', 'P', '--url', 'https://example.com']], ['portal close', ['portal', 'close', 'P']],
  ['portal snapshot', ['portal', 'snapshot', 'P']], ['portal a11y', ['portal', 'a11y', 'P']], ['portal click', ['portal', 'click', 'P', '@e3']], ['portal fill', ['portal', 'fill', 'P', '@e2', 't']], ['portal type', ['portal', 'type', 'P', 't']], ['portal key', ['portal', 'key', 'P', 'ctrl+a']],
  ['portal focus', ['portal', 'focus', 'P', '@e2']], ['portal select', ['portal', 'select', 'P', '@e5', 'o']], ['portal check (espiar)', ['portal', 'check', 'P']], ['portal check', ['portal', 'check', 'P', '@e6']], ['portal uncheck', ['portal', 'uncheck', 'P', '@e6']], ['portal selectall', ['portal', 'selectall', 'P']], ['portal clear', ['portal', 'clear', 'P']],
  ['portal navigate', ['portal', 'navigate', 'P', 'https://example.com']], ['portal back', ['portal', 'back', 'P']], ['portal forward', ['portal', 'forward', 'P']], ['portal reload', ['portal', 'reload', 'P']], ['portal screenshot', ['portal', 'screenshot', 'P']], ['portal scroll', ['portal', 'scroll', 'P', 'down', '300', '@e5']], ['portal scrollintoview', ['portal', 'scrollintoview', 'P', '@e1']],
  ['portal hover', ['portal', 'hover', 'P', '@e3']], ['portal drag', ['portal', 'drag', 'P', '@e3', '@e7']], ['portal upload', ['portal', 'upload', 'P', '@e4', 'a']], ['portal text', ['portal', 'text', 'P', '@e1']], ['portal wait', ['portal', 'wait', 'P', '@e3', '1000']], ['portal evaluate', ['portal', 'evaluate', 'P', '1']], ['portal html', ['portal', 'html', 'P']], ['portal logs-start', ['portal', 'logs-start', 'P']], ['portal logs', ['portal', 'logs', 'P']], ['portal info', ['portal', 'info', 'P']], ['portal resize', ['portal', 'resize', 'P', '390', '844']], ['portal ua', ['portal', 'ua', 'P', 'edge-android']],

  ['recruit', ['recruit', 'A', '--preset', 'P', '--role', 'R', '--floor', 'F', '--workspace', 'W', '--band', 'B', '--command', 'C', '--dir', '/tmp', '--account', 'A', '--icon', 'bot', '--color', 'blue']], ['recruit --replace', ['recruit', 'N', '--preset', 'P', '--replace', 'O']], ['recruit --replace --account', ['recruit', '--replace', 'O', '--account', 'A']], ['recruit --space', ['recruit', 'A', '--space', 'S', '--workspace', 'W']],
  ['dismiss', ['dismiss', 'A']], ['band create', ['band', 'create', 'B', 'A', '--without-me', '--floor', 'F', '--workspace', 'W', '--icon', 'bot', '--color', 'blue']], ['band add', ['band', 'add', 'B', 'A']], ['band remove', ['band', 'remove', 'B', 'A']], ['band dissolve', ['band', 'dissolve', 'B']],
  ['partitura list', ['partitura', 'list']], ['partitura insert', ['partitura', 'insert', 'P', '--floor', 'F', '--workspace', 'W']], ['partitura create', ['partitura', 'create', 'P', 'A', '--without-me', '--commands', 'off', '--note-text', 'off', '--description', 'd']], ['partitura update', ['partitura', 'update', 'P', '--name', 'N', '--commands', 'on']], ['partitura delete', ['partitura', 'delete', 'P']],

  ['preset list', ['preset', 'list']], ['preset show', ['preset', 'show', 'P']], ['preset create', ['preset', 'create', 'P', '--command', 'c', '--account', 'Default', '--maestro', 'on', '--chat', 'on', '--quick-start', 'off']], ['preset set', ['preset', 'set', 'P', '--chat', 'off']], ['preset delete', ['preset', 'delete', 'P']],
  ['role list', ['role', 'list']], ['role show', ['role', 'show', 'R']], ['role create', ['role', 'create', 'R', 'p', '--scope', 'global']], ['role write', ['role', 'write', 'R', 'p']], ['role edit', ['role', 'edit', 'R', 'a', 'b', '--scope', 'current']], ['role assign', ['role', 'assign', 'A', '--none']], ['role delete --force', ['role', 'delete', 'R', '--force']],
  ['routine list', ['routine', 'list']], ['routine show', ['routine', 'show', 'R']], ['routine create', ['routine', 'create', 'R', '--command', 'c', '--weekly', 'mon,fri@09:00', '--terminal', 'T', '--count', '2', '--until', '2026-12-01', '--pre-run', 'true', '--no-skip-if-busy', '--no-notify', '--disabled']], ['routine edit', ['routine', 'edit', 'R', '--every', '30m']], ['routine enable', ['routine', 'enable', 'R']], ['routine disable', ['routine', 'disable', 'R']], ['routine run', ['routine', 'run', 'R']], ['routine delete', ['routine', 'delete', 'R']],
  ['workspace create', ['workspace', 'create', 'W', '--dir', '/tmp', '--from', 'S', '--group', 'G']], ['workspace rename', ['workspace', 'rename', 'a', 'b']], ['workspace move', ['workspace', 'move', 'W', '--space', 'S']], ['workspace list', ['workspace', 'list']], ['workspace unload', ['workspace', 'unload', 'W']],
  ['space list', ['space', 'list']], ['space create', ['space', 'create', 'S', '--icon', 'folder', '--color', 'blue']], ['space edit', ['space', 'edit', 'S', '--name', 'N', '--color', 'none']], ['space move', ['space', 'move', 'S', '--to', '2']], ['space delete', ['space', 'delete', 'S']],
  ['floor create', ['floor', 'create', 'F', '--branch', 'b', '--copy-ground', '--partitura', 'P', '--from', 'back']], ['floor create --dir', ['floor', 'create', 'F', '--dir', 'd']], ['floor create --copy', ['floor', 'create', 'F', '--copy']], ['floor create --pull-request', ['floor', 'create', '--pull-request', '42', '--copy', '--copy-ground']],
  ['floor list', ['floor', 'list']], ['floor land', ['floor', 'land', 'F', '--into', 'main', '--delete-branch', '--keep-floor']], ['floor delete', ['floor', 'delete', 'F', '--keep-branch', '--keep-folder', '--force']], ['floor set-dir', ['floor', 'set-dir', 'F', 'p']], ['floor status', ['floor', 'status', 't', '--state', 'review', '--progress', '2/5']], ['floor status --floor', ['floor', 'status', '--floor', 'F']], ['floor status --clear', ['floor', 'status', '--clear']], ['floor unload', ['floor', 'unload', 'F']],
  ['arrange', ['arrange']], ['arrange --kind', ['arrange', 'N', '--note', '--color', 'blue']], ['connect', ['connect', 'A', 'B']], ['connect --kind', ['connect', 'A', '--agent', 'B', '--note']], ['debug', ['debug']],

]

describe('contrato dos comandos', () => {
  it.each(COMMANDS)('%s aceita os argumentos suportados', (_name, args) => {
    expect(() => parse(args)).not.toThrow()
  })
  it.each([
    ['say', '--file'],
    ['partitura', 'create', 'P', '--chat-history', 'on'],
    ['partitura', 'create', 'P', '--scope', 'global'],
    ['workspace', 'create', 'W', '--folder', 'G'],
    ['portal', 'tap', 'P', '10', '20']
  ])('recusa sintaxe indisponível: %j', (...args) => {
    expect(() => parse(args)).toThrow()
  })
})

describe('operações integradas do CLI', () => {
  it('recall por período: --last e --from/--to filtram as voltas pela data da mensagem', async () => {
    const file = join(dir, 'chats', ids.boss, 'blue', 'transcript.jsonl')
    mkdirSync(join(file, '..'), { recursive: true })
    const now = Date.now() / 1000
    const rows: Array<[string, number]> = [['antiga', new Date('2026-01-10T12:00:00').getTime() / 1000], ['de tres dias atras', now - 3 * 86400], ['de agora', now - 60]]
    writeFileSync(file, rows.map(([text, ts], i) => JSON.stringify({ id: `E${i}`, ts, role: 'user', kind: 'message', text })).join('\n') + '\n')
    const day = await palco('recall', '--last', 'day'); expect(day.out).toContain('de agora'); expect(day.out).not.toContain('de tres dias')
    const week = await palco('recall', '--last', 'week'); expect(week.out).toContain('de tres dias'); expect(week.out).not.toContain('antiga')
    const jan = await palco('recall', '--from', '2026-01-10', '--to', '2026-01-10'); expect(jan.out).toContain('antiga'); expect(jan.out).not.toContain('de agora')
    expect(() => parse(['recall', '--to', '2026-01-01'])).toThrow(); expect(() => parse(['recall', '--last', 'year'])).toThrow(); expect(() => parse(['recall', '--last', 'day', '--turns', '2'])).toThrow(); expect(() => parse(['recall', '--from', '2026-13-40'])).toThrow()
  })
  it('ask --raw devolve a tela resultante, para o agente navegar menus', async () => {
    const r = await palco('ask', 'Beta', '--raw', '2\\n')
    expect(r.code).toBe(0); expect(r.out).toBe('tela\n')
  })
  it('preset --chat liga e desliga o início no modo de chat', async () => {
    expect((await palco('preset', 'create', 'Revisor', '--command', 'claude', '--chat', 'on')).code).toBe(0)
    expect(presets.get('Revisor').startInChat).toBe(true)
    expect((await palco('preset', 'set', 'Revisor', '--chat', 'off')).code).toBe(0); expect(presets.get('Revisor').startInChat).toBe(false)
  })
  it('role delete: em uso é recusado; --force tira dos terminais, de todos os workspaces, e apaga', async () => {
    expect((await palco('role', 'create', 'Fiscal', 'revise tudo', '--scope', 'global')).code).toBe(0)
    registry.get(ids.second).addNode({ kind: 'terminal', floorId: null, name: 'Com role', agent: 'claude', command: 'claude', cwd: dir, role: 'Fiscal', pos: { x: 900, y: 0 }, size: { w: 400, h: 300 } })
    const refused = await palco('role', 'delete', 'Fiscal'); expect(refused.code).toBe(1); expect(refused.err).toContain('role em uso')
    expect((await palco('role', 'delete', 'Fiscal', '--force')).code).toBe(0)
    expect(Object.values(registry.get(ids.second).get().nodes).some((n) => n.kind === 'terminal' && n.role)).toBe(false)
    expect(roles.list().some((r) => r.name === 'Fiscal')).toBe(false)
  })
  it('partitura --commands off salva o time sem os comandos', async () => {
    registry.get(registry.activeId()).reconfigureTerminal(ids.beta, { agent: 'claude', command: 'claude --model opus', cwd: dir })
    expect((await palco('partitura', 'create', 'sem-comando', 'Beta', '--commands', 'off')).code).toBe(0)
    const saved = partituras.get('sem-comando').nodes.filter((n) => n.kind === 'terminal')
    expect(saved.length).toBe(2)
    expect(saved.every((n) => n.kind === 'terminal' && n.command === '' && n.agent === 'shell')).toBe(true)
  })
  it('a flag de tipo desempata nomes iguais no connect e no arrange', async () => {
    const store = registry.get(registry.activeId())
    const twin = store.addNode({ kind: 'note', floorId: null, name: 'Beta', content: '', pos: { x: 900, y: 400 }, size: { w: 200, h: 100 } }); store.connect(ids.boss, twin)
    const ambiguous = await palco('arrange', 'Beta', '--name', 'X'); expect(ambiguous.err).toContain('ambíguo')
    expect((await palco('arrange', 'Beta', '--note', '--name', 'Nota Beta')).code).toBe(0)
    expect(store.get().nodes[twin]!.name).toBe('Nota Beta'); expect(store.get().nodes[ids.beta]!.name).toBe('Beta')
    expect((await palco('connect', 'Nota Beta', '--note', 'Beta', '--agent')).code).toBe(0)
    expect(store.get().connections.some((c) => [c.a, c.b].includes(twin) && [c.a, c.b].includes(ids.beta))).toBe(true)
  })
  it('floor unload e workspace unload encerram o que roda lá, recusam o seu e o que já está parado', async () => {
    const store = registry.get(registry.activeId())
    expect((await palco('floor', 'create', 'Exp', '--no-git')).code).toBe(0)
    const floorId = Object.keys(store.get().floors)[0]!
    const there = store.addNode({ kind: 'terminal', floorId, name: 'La', agent: 'shell', command: '', cwd: dir, pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })
    running.add(there); sessions.add(there)
    expect((await palco('floor', 'unload', 'Ground')).err).toContain('seu')
    expect((await palco('floor', 'unload', 'Exp')).code).toBe(0); expect(disposed).toContain(there)
    expect((await palco('floor', 'list')).out).toContain('unloaded')
    expect((await palco('floor', 'unload', 'Exp')).err).toContain('nada rodando')
    expect((await palco('workspace', 'unload', 'Primeiro')).err).toContain('seu')
    expect((await palco('workspace', 'unload', 'Segundo')).code).toBe(0); expect(disposed).toContain(ids.secondTerm)
    expect((await palco('workspace', 'list')).out).toContain('unloaded')
    // Quem falar com um terminal do andar descarregado o acorda.
    store.connect(ids.boss, there)
    expect((await palco('check', 'La')).code).toBe(0); expect(spawned.map((n) => n.id)).toContain(there)
  })
  it('floor set-dir muda a pasta de um andar sem checkout; andar com worktree é recusado', async () => {
    const store = registry.get(registry.activeId())
    await palco('floor', 'create', 'Solto', '--no-git')
    mkdirSync(join(dir, 'nova'))
    expect((await palco('floor', 'set-dir', 'Solto', 'nova')).code).toBe(0)
    expect(Object.values(store.get().floors)[0]!.dir).toBe(join(dir, 'nova'))
    expect((await palco('floor', 'set-dir', 'Solto', 'nao-existe')).err).toContain('não existe')
    store.addFloor({ name: 'ComGit', repoRoot: dir, dir: join(dir, 'wt'), branch: 'palco/x', baseRef: 'main' })
    expect((await palco('floor', 'set-dir', 'ComGit', 'nova')).code).toBe(1)
  })
  it('note import --copy cria a nota com o texto do arquivo; sem --copy explica a limitação', async () => {
    writeFileSync(join(dir, 'plano-b.md'), '# Plano B\n\ncorpo')
    const r = await palco('note', 'import', 'plano-b.md', '--copy'); expect(r.code).toBe(0); expect(r.out).toContain('plano-b')
    const store = registry.get(registry.activeId())
    expect(Object.values(store.get().nodes).find((n) => n.name === 'plano-b')).toMatchObject({ kind: 'note', content: '# Plano B\n\ncorpo' })
    const linked = await palco('note', 'import', 'plano-b.md'); expect(linked.code).toBe(1); expect(linked.err).toContain('--copy')
    writeFileSync(join(dir, 'foto.png'), 'x'); expect((await palco('note', 'import', 'foto.png', '--copy')).code).toBe(1)
  })
  it('rotina não acorda um terminal que o usuário descarregou', async () => {
    const store = registry.get(registry.activeId())
    store.setUnloaded(ids.beta, true); running.delete(ids.beta); sessions.delete(ids.beta)
    expect((await palco('routine', 'create', 'R', '--command', 'echo', '--every', '30m', '--terminal', 'Beta')).code).toBe(0)
    expect((await palco('routine', 'run', 'R')).out).toContain('descarregado')
    expect(spawned).toHaveLength(0)
  })
})

describe('portal: verbos que faltavam', () => {
  const manager = () => {
    const events: Array<Record<string, unknown>> = []
    let polls = 0
    const wc = {
      isDestroyed: () => false, getURL: () => 'https://x', getUserAgent: () => 'Mozilla/5.0 Chrome/140.0.0.0', setUserAgent: () => {}, reload: () => {},
      capturePage: async () => ({ toPNG: () => Buffer.from('png') }), sendInputEvent: (e: Record<string, unknown>) => { events.push(e) },
      executeJavaScript: async (code: string) => {
        // Só os argumentos da chamada (o código-fonte da função injetada cita as mesmas palavras).
        const args = code.slice(code.lastIndexOf(')(document, ...'))
        if (args.includes('"exists"')) return { ok: true, value: ++polls > 1 ? 'yes' : 'no' }
        return { ok: true, value: args.includes('"@e7"') ? '{"x":200,"y":120}' : '{"x":20,"y":30}' }
      }
    }
    const m = new PortalManager({ fromId: () => wc as never, writeFile: () => {} })
    m.register('p', 1)
    return { m, events }
  }
  it('drag aperta na origem, move e solta no destino', async () => {
    const { m, events } = manager()
    await m.action('p', 'drag', ['@e3', '@e7'])
    expect(events.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseMove', 'mouseMove', 'mouseMove', 'mouseMove', 'mouseUp'])
    expect(events[0]).toMatchObject({ x: 20, y: 30 }); expect(events.at(-1)).toMatchObject({ x: 200, y: 120, button: 'left' })
  })
  it('wait espera o elemento aparecer e falha no prazo', async () => {
    const { m } = manager()
    expect(await m.action('p', 'wait', ['@e3', '2000'])).toContain('ok')
    const never = new PortalManager({ fromId: () => ({ isDestroyed: () => false, executeJavaScript: async () => ({ ok: true, value: 'no' }) }) as never, writeFile: () => {} })
    never.register('p', 1)
    await expect(never.action('p', 'wait', ['#nada', '200'])).rejects.toThrow(/prazo/)
  })
  it('portal ua oferece os presets de navegador', async () => {
    const { m } = manager()
    const listed = JSON.parse(await m.action('p', 'ua', [])) as { presets: string[] }
    expect(listed.presets).toEqual(['ios', 'android', 'firefox-android', 'edge-android', 'chrome', 'firefox', 'edge', 'desktop'])
  })
})
