import { connectionEnvironment } from './session-connection'
import { askBatch } from './batch'
import { formatList, type ListReply } from './list-format'
import { helpFor } from './help'
import { formatFloors, formatPresets, formatRoles, formatLook, formatRoutines, formatWorkspaces } from './text-format'
import { fstatSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { codexThread } from '../main/agents/codex-thread'
import http from 'node:http'
import { ENV_TOKEN, HEADER_TOKEN } from '../shared/auth'
import { parseEndpoint } from '../shared/endpoint'
import { ENV_SOCKET } from '../shared/model'
import { parseArgs, type CliCommand } from './args'
import { parseRecall, recallRequestPath, parseSay, RECALL_USAGE, SAY_USAGE, sayBody } from './chat'
import { lastAssistantText, codexTurn, hookSessionId } from './hooks'

interface Reply { status: number; body: string }

const HOOK_TIMEOUT_MS = 3000

/** Uma chamada ao socket. `timeoutMs` só para hooks; um ask normal espera quanto o broker mandar. */
function request(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs?: number): Promise<Reply> {
  const { socket: socketPath, token } = connectionEnvironment()
  if (!socketPath || !token) return Promise.reject(new Error('fora de um terminal do palco'))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const headers: Record<string, string> = { [HEADER_TOKEN]: token }
    if (payload !== undefined) headers['content-type'] = 'application/json'
    const target = parseEndpoint(socketPath)
    if (!target) return reject(new Error('PALCO_SOCKET inválido'))
    const req = http.request({ ...(target.kind === 'unix' ? { socketPath: target.path } : { host: target.host, port: target.port }), method, path, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => finish(() => resolve({ status: res.statusCode ?? 0, body: data })))
      // Conexão que cai com a resposta pela metade não pode escapar como exceção solta.
      res.on('error', (err) => finish(() => reject(new Error(`conexão com o palco interrompida (${err.message})`))))
      res.on('aborted', () => finish(() => reject(new Error('conexão com o palco interrompida'))))
      res.on('close', () => finish(() => reject(new Error('conexão com o palco interrompida'))))
    })
    req.on('error', (err) => finish(() => reject(new Error(`sem conexão com o palco (${err.message})`))))
    if (timeoutMs !== undefined) {
      req.setTimeout(timeoutMs, () => {
        finish(() => reject(new Error('o palco não respondeu a tempo')))
        req.destroy()
      })
    }
    req.end(payload)
  })
}

function hookTimeout(): number {
  const raw = Number(process.env.PALCO_HOOK_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : HOOK_TIMEOUT_MS
}


/** Remove as chaves não definidas: o corpo só leva o que o usuário passou. */
function body<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}

function route(cmd: CliCommand): Promise<Reply> | undefined {
  switch (cmd.cmd) {
    case 'notify': return request('POST', '/notify', { message: cmd.message })
    case 'arrange': { const { json: _j, ...rest } = cmd; return request('POST', '/arrange', body(rest)) }
    case 'connect': { const { cmd: _c, ...rest } = cmd; return request('POST', '/connect', body(rest)) }
    case 'floor-unload': return request('POST', '/floor/unload', { name: cmd.name })
    case 'floor-set-dir': return request('POST', '/floor/set-dir', { name: cmd.name, dir: cmd.dir })
    case 'workspace-unload': return request('POST', '/workspace/unload', { name: cmd.name })
    case 'workspace-delete': return request('POST', '/workspace/delete', { name: cmd.name, ...(cmd.force ? { force: true } : {}) })
    case 'note-import': { const note = noteFromFile(cmd.file, cmd.copy === true); return request('POST', '/note/create', { content: note.content, name: note.name }) }
    case 'ask-raw': return request('POST', '/ask/raw', { to: cmd.to, data: cmd.data })
    case 'note-stack': return request('POST', '/note/stack', { name: cmd.name, stack: cmd.stack ?? 'Fichário' })
    case 'note-unstack': return request('POST', '/note/stack', { name: cmd.name, stack: null })
    case 'note-delete': return request('POST', '/note/delete', { name: cmd.name, stack: cmd.stack === true })
    case 'partitura-list': return request('GET', '/partitura/list')
    case 'partitura-create': return request('POST', '/partitura/create', cmd)
    case 'partitura-update': return request('POST', '/partitura/update', cmd)
    case 'partitura-insert': return request('POST', '/partitura/insert', cmd)
    case 'partitura-delete': return request('POST', '/partitura/delete', { name: cmd.name })
    case 'preset-list': return request('GET', '/preset/list')
    case 'preset-show': return request('GET', `/preset/show?name=${encodeURIComponent(cmd.name)}`)
    case 'preset-create': return request('POST', '/preset/create', cmd)
    case 'preset-set': return request('POST', '/preset/set', cmd)
    case 'preset-delete': return request('POST', '/preset/delete', { name: cmd.name })
    case 'role-list': return request('GET', '/role/list')
    case 'role-show': return request('GET', `/role/show?name=${encodeURIComponent(cmd.name)}`)
    case 'role-create': return request('POST', '/role/create', cmd)
    case 'role-edit': return request('POST', '/role/edit', cmd)
    case 'role-write': return request('POST', '/role/write', cmd)
    case 'role-delete': return request('POST', '/role/delete', body({ name: cmd.name, force: cmd.force }))
    case 'role-assign': return request('POST', '/role/assign', cmd)
    case 'recruit': { const { cmd: _c, ...rest } = cmd; return request('POST', '/recruit', body(rest)) }
    case 'dismiss': return request('POST', '/dismiss', { name: cmd.name })
    case 'band-create': { const { cmd: _c, ...rest } = cmd; return request('POST', '/band/create', body(rest)) }
    case 'band-add': return request('POST', '/band/add', { band: cmd.band, member: cmd.member })
    case 'band-remove': return request('POST', '/band/remove', { band: cmd.band, member: cmd.member })
    case 'band-dissolve': return request('POST', '/band/dissolve', { band: cmd.band })
    case 'floor-create': { const { cmd: _c, ...rest } = cmd; return request('POST', '/floor/create', body(rest)) }
    case 'floor-list': return request('GET', '/floor/list')
    case 'floor-land': return request('POST', '/floor/land', body({ name: cmd.name, into: cmd.into, deleteBranch: cmd.deleteBranch, keepFloor: cmd.keepFloor }))
    case 'floor-delete': return request('POST', '/floor/delete', body({ name: cmd.name, force: cmd.force, keepBranch: cmd.keepBranch, keepFolder: cmd.keepFolder }))
    case 'floor-status': return request('POST', '/floor/status', body({ text: cmd.text, floor: cmd.floor, state: cmd.state, progress: cmd.progress, clear: cmd.clear }))
    case 'portal': return request('POST', '/portal', { name: cmd.name, action: cmd.action, args: cmd.args })
    case 'routine-create': { const { cmd: _c, ...rest } = cmd; return request('POST', '/routine/create', body(rest)) }
    case 'routine-edit': { const { cmd: _c, ...rest } = cmd; return request('POST', '/routine/edit', body(rest)) }
    case 'routine-list': return request('GET', '/routine/list')
    case 'routine-show': return request('GET', `/routine/show?${new URLSearchParams(body({ name: cmd.name, id: cmd.id }) as Record<string, string>)}`)
    case 'routine-enable': return request('POST', '/routine/enable', body({ name: cmd.name, id: cmd.id }))
    case 'routine-disable': return request('POST', '/routine/disable', body({ name: cmd.name, id: cmd.id }))
    case 'routine-run': return request('POST', '/routine/run', body({ name: cmd.name, id: cmd.id }))
    case 'routine-delete': return request('POST', '/routine/delete', body({ name: cmd.name, id: cmd.id }))
    case 'account-list': return request('GET', '/account/list')
    case 'account-add': return request('POST', '/account/add', { name: cmd.name, agent: cmd.agent, dir: cmd.dir })
    case 'account-remove': return request('POST', '/account/remove', { name: cmd.name })
    case 'workspace-list': return request('GET', '/workspace/list')
    case 'workspace-create': { const { cmd: _c, ...rest } = cmd; return request('POST', '/workspace/create', body(rest)) }
    case 'workspace-rename': return request('POST', '/workspace/rename', { old: cmd.old, new: cmd.new })
    case 'workspace-move': { const { cmd: _c, ...rest } = cmd; return request('POST', '/workspace/move', body(rest)) }
    case 'space-list': return request('GET', '/space/list')
    case 'space-create': { const { cmd: _c, ...rest } = cmd; return request('POST', '/space/create', body(rest)) }
    case 'space-edit': { const { cmd: _c, ...rest } = cmd; return request('POST', '/space/edit', body(rest)) }
    case 'space-move': { const { cmd: _c, ...rest } = cmd; return request('POST', '/space/move', body(rest)) }
    case 'space-delete': return request('POST', '/space/delete', { name: cmd.name })
    case 'list': return request('GET', '/list')
    case 'ask': return request('POST', '/ask', { to: cmd.to, prompt: cmd.prompt })
    case 'check': return request('GET', `/check?name=${encodeURIComponent(cmd.name)}`)
    case 'note-create': return request('POST', '/note/create', body({ content: cmd.content, name: cmd.name, stack: cmd.stack, color: cmd.color }))
    case 'note-read': {
      const q = new URLSearchParams({ name: cmd.name })
      if (cmd.offset !== undefined) q.set('offset', String(cmd.offset))
      if (cmd.limit !== undefined) q.set('limit', String(cmd.limit))
      return request('GET', `/note/read?${q}`)
    }
    case 'note-write': return request('POST', '/note/write', { name: cmd.name, content: cmd.content })
    case 'note-edit': return request('POST', '/note/edit', { name: cmd.name, old: cmd.old, new: cmd.new })
    default: return undefined
  }
}

/** Maior arquivo que vira nota. */
const MAX_IMPORT_BYTES = 256 * 1024
/** `palco note import arquivo.md --copy`: o arquivo é lido aqui (no terminal do agente, inclusive remoto) e vira uma nota comum. */
function noteFromFile(file: string, copy: boolean): { name: string; content: string } {
  if (!copy) throw new Error('o palco não tem nota ligada a arquivo: use --copy para criar uma nota com uma cópia do texto')
  if (!/\.(md|markdown|txt)$/i.test(file)) throw new Error('só arquivos .md ou .txt viram nota')
  const path = resolve(process.cwd(), file), info = statSync(path)
  if (!info.isFile() || info.size > MAX_IMPORT_BYTES) throw new Error('o arquivo precisa ser um texto de até 256 KB')
  const bytes = readFileSync(path)
  if (bytes.subarray(0, 8192).includes(0)) throw new Error('o arquivo não é um texto')
  return { name: basename(path).replace(/\.(md|markdown|txt)$/i, ''), content: bytes.toString('utf8') }
}

function readStdin(): string {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

/** Os hooks rodam dentro do agente: qualquer falha vira exit 0 silencioso para não atrapalhar o turno. */
async function runHook(cmd: CliCommand): Promise<void> {
  try {
    const t = hookTimeout()
    if (cmd.cmd === 'hook-claude-stop') {
      const input = readStdin(), last = lastAssistantText(input, (p) => readFileSync(p, 'utf8')), sessionId = hookSessionId(input)
      await request('POST', '/turn-ended', { ...(last === undefined ? {} : { lastMessage: last }), ...(sessionId ? { sessionId } : {}) }, t)
    } else if (cmd.cmd === 'hook-claude-busy') {
      await request('POST', '/busy', { sessionId: hookSessionId(readStdin()) }, t)
    } else if (cmd.cmd === 'hook-claude-ready') {
      await request('POST', '/ready', { sessionId: hookSessionId(readStdin()) }, t)
    } else if (cmd.cmd === 'hook-codex-notify') {
      const turn = codexTurn(cmd.payload)
      if (turn === null) return
      // Fim de turno de subagente não é o fim do turno do terminal, e o id dele não pode ser retomado.
      if (turn.sessionId && codexThread(turn.sessionId, process.env.CODEX_HOME || join(homedir(), '.codex')).subagent) return
      await request('POST', '/turn-ended', turn, t)
    }
  } catch { /* ignorado de propósito */ }
}

/** `palco say` e `palco recall`: o chat do usuário com este agente. */
async function chatCommand(argv: string[]): Promise<number> {
  try {
    if (argv[1] === '--help' || argv[1] === '-h') { process.stdout.write(`Uso: palco ${argv[0] === 'say' ? SAY_USAGE : RECALL_USAGE}\n`); return 0 }
    if (argv[0] === 'say') {
      const reply = await request('POST', '/say', sayBody(parseSay(argv.slice(1)), () => { try { const st = fstatSync(0); return st.isFile() || st.isFIFO() ? readFileSync(0, 'utf8') : '' } catch { return '' } }))
      if (reply.status !== 200) { process.stderr.write(`palco: erro: ${reply.body.trim()}\n`); return 1 }
      process.stdout.write('OK\n'); return 0
    }
    const c = parseRecall(argv.slice(1))
    const reply = await request('GET', recallRequestPath(c))
    if (reply.status !== 200) { process.stderr.write(`palco: erro: ${reply.body.trim()}\n`); return 1 }
    process.stdout.write(reply.body.endsWith('\n') ? reply.body : `${reply.body}\n`); return 0
  } catch (err) { process.stderr.write(`palco: erro: ${err instanceof Error ? err.message : String(err)}\n`); return 1 }
}

async function main(): Promise<number> {
  if (process.argv[2] === 'say' || process.argv[2] === 'recall') return chatCommand(process.argv.slice(2))
  let cmd: CliCommand
  try {
    cmd = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`palco: erro: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  if (cmd.cmd === 'help') {
    process.stdout.write(helpFor(process.argv.slice(2)))
    return 0
  }
  if (cmd.cmd === 'hook-claude-stop' || cmd.cmd === 'hook-claude-busy' || cmd.cmd === 'hook-claude-ready' || cmd.cmd === 'hook-codex-notify') {
    await runHook(cmd)
    return 0
  }
  if (cmd.cmd === 'debug') {
    const socket = process.env[ENV_SOCKET]
    const lines = [`PALCO_SOCKET: ${socket ?? '(ausente)'}`, `PALCO_TOKEN: ${process.env[ENV_TOKEN] ? 'presente (oculto)' : 'ausente'}`, `PALCO_CLI: ${process.env.PALCO_CLI ?? '(ausente)'}`]
    try { if (socket) { const st = statSync(socket); lines.push(`socket: ${st.isSocket() ? 'sim' : 'não'}; modo ${(st.mode & 0o777).toString(8)}; uid ${st.uid}`) } }
    catch { lines.push('socket: inexistente ou inacessível') }
    try { const reply = await request('GET', '/list', undefined, 3000); lines.push(`conexão/autorização: HTTP ${reply.status}`) }
    catch (err) { lines.push(`conexão: ${err instanceof Error ? err.message : String(err)}`) }
    process.stdout.write(lines.join('\n') + '\n'); return 0
  }
  if (cmd.cmd === 'ask-batch') {
    const results = await askBatch(cmd.prompts, (to, prompt) => request('POST', '/ask', { to, prompt }))
    process.stdout.write(JSON.stringify(results) + '\n'); return 0
  }
  try {
    const reply = await route(cmd)!
    if (reply.status === 200 && cmd.cmd === 'list' && !cmd.json) {
      process.stdout.write(formatList(JSON.parse(reply.body) as ListReply))
      return 0
    }
    // `arrange` sem opções consulta o visual: texto, ou o JSON cru com `--json`.
    if (reply.status === 200 && cmd.cmd === 'arrange' && !cmd.json && cmd.name === undefined && cmd.icon === undefined && cmd.color === undefined) {
      process.stdout.write(formatLook(JSON.parse(reply.body)))
      return 0
    }
    // Listas em texto agrupado; `--json` mantém a resposta crua.
    if (reply.status === 200 && (cmd.cmd === 'role-list' || cmd.cmd === 'floor-list' || cmd.cmd === 'routine-list' || cmd.cmd === 'preset-list' || cmd.cmd === 'workspace-list') && !cmd.json) {
      const data = JSON.parse(reply.body)
      process.stdout.write(cmd.cmd === 'role-list' ? formatRoles(data) : cmd.cmd === 'floor-list' ? formatFloors(data) : cmd.cmd === 'preset-list' ? formatPresets(data) : cmd.cmd === 'workspace-list' ? formatWorkspaces(data) : formatRoutines(data))
      return 0
    }
    if (reply.status === 200) {
      process.stdout.write(reply.body.endsWith('\n') ? reply.body : `${reply.body}\n`)
      return 0
    }
    process.stderr.write(`palco: erro: ${reply.body.trim()}\n`)
    return 1
  } catch (err) {
    process.stderr.write(`palco: erro: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

void main().then((code) => process.exit(code))
