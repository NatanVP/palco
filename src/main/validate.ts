import { isWebUrl } from '../shared/link'
import { isNoteFilePath } from '../shared/note-file'
import { normalizeAgentCommand } from './domain/command'
import type { DockEdge, DockState } from '../shared/model'
import { DRAW_FILLS, DRAW_KINDS, isTwoPointKind, DRAW_PATTERNS, type DrawFill, type DrawingPatch, type DrawKind, type DrawPattern } from '../shared/model'
import type { AgentKind, Drawing, FloorState, NewFloor, NewNode, NodePatch, NoteNode, Vec, Workspace, CanvasNode } from '../shared/model'
import { isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import { agentForCommand, firstLine } from '../shared/agent-command'
import { expandHome } from './files'
import { invalidTerminalExtras, pickTerminalExtras, takesRole } from './domain/terminal-extras'
import { invalidNodeExtras, validExtra } from './domain/node-extras'
import { validUserAgent, type PortalStorage } from '../shared/portal-settings'
import { isPortalUrl } from './security'

// Tudo que chega por IPC é `unknown`: estes parsers devolvem só campos conhecidos, com limites.
const MAX_ID = 200
const MAX_NAME = 200
const MAX_COMMAND = 4096
const MAX_CWD = 4096
const MAX_CONTENT = 1_000_000
const MAX_DATA = 1_000_000
const MAX_COORD = 1_000_000
const MIN_SIDE = 50
const MIN_LINK_HEIGHT = 40
const MAX_SIDE = 20_000
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const MIN_DIM = 2
const MAX_DIM = 500
const MAX_URL = 2048
const MAX_PATH = 4096
const MAX_MEMBERS = 200
const MAX_PROGRESS = 200
const MAX_TEXT = 100_000
const MIN_FONT = 6
const MAX_FONT = 400
const MAX_POINTS = 20_000
const MAX_STROKE = 100
const MAX_RADIUS = 200
const AGENTS: readonly AgentKind[] = ['claude', 'codex', 'antigravity', 'shell', 'other']
const FLOOR_STATES: readonly FloorState[] = ['working', 'blocked', 'review', 'done']

function fail(what: string): never {
  throw new Error(`payload inválido: ${what}`)
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${what} deve ser objeto`)
  return v as Record<string, unknown>
}

function text(v: unknown, what: string, max: number, nonEmpty = false): string {
  if (typeof v !== 'string') fail(`${what} deve ser texto`)
  if (v.length > max) fail(`${what} passa de ${max} caracteres`)
  if (nonEmpty && v.trim() === '') fail(`${what} vazio`)
  return v
}

function num(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${what} fora de ${min}..${max}`)
  return v
}

function vec(v: unknown, what: string): Vec {
  const o = obj(v, what)
  return { x: num(o.x, `${what}.x`, -MAX_COORD, MAX_COORD), y: num(o.y, `${what}.y`, -MAX_COORD, MAX_COORD) }
}

function size(v: unknown, what: string, minH = MIN_SIDE): { w: number; h: number } {
  const o = obj(v, what)
  return { w: num(o.w, `${what}.w`, MIN_SIDE, MAX_SIDE), h: num(o.h, `${what}.h`, minH, MAX_SIDE) }
}

export function parseId(v: unknown): string {
  return text(v, 'id', MAX_ID, true)
}

export function parseData(v: unknown): string {
  return text(v, 'dados', MAX_DATA)
}

export function parseDims(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const dim = (v: unknown, what: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_DIM || v > MAX_DIM) fail(`${what} deve ser inteiro entre ${MIN_DIM} e ${MAX_DIM}`)
    return v
  }
  return { cols: dim(cols, 'cols'), rows: dim(rows, 'rows') }
}

/** Estado dos painéis (elevado/encaixado): ids de nó (texto curto), borda e a memória de encaixados (até 100). */
export function parseDockState(v: unknown): DockState {
  const o = obj(v, 'dockState')
  const id = (x: unknown, name: string): string | null => (x === null || x === undefined ? null : text(x, name, MAX_NAME, true))
  if (o.edge !== 'leading' && o.edge !== 'trailing') fail('edge deve ser leading ou trailing')
  if (!Array.isArray(o.memory) || o.memory.length > 100) fail('memory deve ter até 100 ids')
  return { dockedId: id(o.dockedId, 'dockedId'), edge: o.edge as DockEdge, memory: (o.memory as unknown[]).map((m, i) => text(m, `memory[${i}]`, MAX_NAME, true)), liftedId: id(o.liftedId, 'liftedId') }
}

export function parseCamera(v: unknown): Workspace['camera'] {
  const o = obj(v, 'câmera')
  return { offset: vec(o.offset, 'offset'), zoom: num(o.zoom, 'zoom', MIN_ZOOM, MAX_ZOOM) }
}

/** URL de um nó portal: http, https, file ou a página em branco inicial. */
function portalUrl(v: unknown): string {
  const url = text(v, 'url', MAX_URL, true)
  if (url !== 'about:blank' && !isPortalUrl(url)) fail('url deve ser http, https ou file')
  return url
}

/** Marcas que uma cópia colada leva: trava, desfoque (terminal e nota) e som mudo (portal). */
function flags(o: Record<string, unknown>, keys: ReadonlyArray<'positionLocked' | 'redacted' | 'muted'>): Partial<Record<'positionLocked' | 'redacted' | 'muted', true>> {
  const out: Partial<Record<'positionLocked' | 'redacted' | 'muted', true>> = {}
  for (const key of ['positionLocked', ...keys] as const) {
    if (o[key] !== undefined && typeof o[key] !== 'boolean') fail(`${key} deve ser booleano`)
    if (o[key] === true) out[key] = true
  }
  return out
}

export function parseNewNode(v: unknown): NewNode {
  const o = obj(v, 'nó')
  const name = text(o.name, 'name', MAX_NAME, true)
  const pos = vec(o.pos, 'pos')
  const sz = size(o.size, 'size', o.kind === 'link' ? MIN_LINK_HEIGHT : MIN_SIDE)
  const floorId = o.floorId === undefined || o.floorId === null ? null : text(o.floorId, 'floorId', MAX_NAME, true)
  if (o.kind === 'terminal') {
    if (typeof o.agent !== 'string' || !AGENTS.includes(o.agent as AgentKind)) fail('agent desconhecido')
    if (o.role !== undefined && !takesRole(o.agent)) fail(`role não se aplica a ${o.agent}`)
    const bad = invalidTerminalExtras(o)
    if (bad.length) fail(`campo inválido: ${bad.join(', ')}`)
    return {
      kind: 'terminal', floorId, name, agent: o.agent as AgentKind,
      ...(o.accountId === undefined ? {} : { accountId: text(o.accountId, 'accountId', MAX_NAME, true) }),
      ...(o.role === undefined ? {} : { role: text(o.role, 'role', MAX_NAME, true) }),
      ...pickTerminalExtras(o), ...flags(o, ['redacted']),
      command: normalizeAgentCommand(o.agent as AgentKind, text(o.command, 'command', MAX_COMMAND)), cwd: text(o.cwd, 'cwd', MAX_CWD), pos, size: sz
    }
  }
  if (o.kind === 'note') {
    // Colar uma nota copiada traz a aparência dela (cor, fonte, trava) e o fichário novo da cópia (`stackId`); nome fixo não vem.
    const extras = (['color', 'fontSize', 'fontFamily', 'locked', 'stackId', 'render'] as const).filter((k) => o[k] !== undefined)
    const bad = extras.filter((k) => !validExtra(k, o[k]))
    if (bad.length) fail(`campo inválido: ${bad.join(', ')}`)
    if (o.linkedFile !== undefined && !isNoteFilePath(o.linkedFile)) fail('a nota só se liga a um arquivo .md, .markdown ou .txt')
    return { kind: 'note', floorId, name, content: text(o.content, 'content', MAX_CONTENT), pos, size: sz, ...(o.linkedFile === undefined ? {} : { linkedFile: o.linkedFile }), ...Object.fromEntries(extras.map((k) => [k, o[k]])), ...flags(o, ['redacted']) } as NewNode
  }
  if (o.kind === 'portal') {
    const bad = invalidNodeExtras('portal', o).filter((k) => k !== 'chromeHidden')
    if (bad.length) fail(`campo inválido: ${bad.join(', ')}`)
    return {
      kind: 'portal', floorId, name, url: portalUrl(o.url), pos, size: sz, ...flags(o, ['muted']),
      ...(o.userAgent === undefined ? {} : { userAgent: (o.userAgent as string).trim() }),
      ...(o.storage === undefined ? {} : { storage: o.storage as PortalStorage })
    }
  }
  if (o.kind === 'text') return { kind: 'text', floorId, name, text: text(o.text, 'text', MAX_TEXT), fontSize: num(o.fontSize, 'fontSize', MIN_FONT, MAX_FONT), pos, size: sz, ...flags(o, []) }
  if (o.kind === 'file') return { kind: 'file', floorId, name, path: absolutePath(o.path, 'path'), pos, size: sz, ...flags(o, []) }
  if (o.kind === 'filetree') return { kind: 'filetree', floorId, name, root: absolutePath(o.root, 'root'), pos, size: sz, ...flags(o, []) }
  if (o.kind === 'link') {
    if (!isWebUrl(o.url)) fail('o link precisa de um endereço http ou https')
    return { kind: 'link', floorId, name, url: o.url as string, pos, size: sz, ...flags(o, []) }
  }
  // Bandas nascem por band:create (membros validados pelo store), nunca por node:add.
  return fail('kind desconhecido')
}

/**
 * Comando e pasta do Editar terminal. O agente é derivado do comando (mesma regra do renderer);
 * a pasta precisa existir e ser pasta, depois de resolver vazio (pasta padrão) e `~/`.
 */
export function parseTerminalConfig(v: unknown, ctx: { home: string; defaultDir: string }): { command: string; cwd: string; agent: AgentKind } {
  const o = obj(v, 'configuração')
  for (const key of Object.keys(o)) if (key !== 'command' && key !== 'cwd' && key !== 'agent') fail(`campo '${key}' não pode ser alterado`)
  const raw = text(o.command, 'command', MAX_COMMAND).trim()
  if (o.agent !== undefined && (typeof o.agent !== 'string' || !AGENTS.includes(o.agent as AgentKind))) fail('agent desconhecido')
  const agent = (o.agent as AgentKind | undefined) ?? agentForCommand(raw)
  const command = normalizeAgentCommand(agent, firstLine(raw))
  const wanted = text(o.cwd, 'cwd', MAX_CWD).trim()
  const cwd = wanted === '' ? ctx.defaultDir : expandHome(wanted, ctx.home)
  if (!isAbsolute(cwd)) fail('a pasta deve ser um caminho absoluto')
  let st: ReturnType<typeof statSync>
  try { st = statSync(cwd) } catch { return fail(`a pasta não existe: ${cwd}`) }
  if (!st.isDirectory()) fail(`não é uma pasta: ${cwd}`)
  return { command, cwd, agent }
}

/** Só o que o canvas edita: nome, posição, tamanho e, em notas, o conteúdo. Nada de command/agent/cwd. */
export function parseNodePatch(v: unknown, kind: CanvasNode['kind']): NodePatch {
  const o = obj(v, 'patch')
  const out: NodePatch = {}
  for (const key of Object.keys(o)) {
    switch (key) {
      case 'name': out.name = text(o.name, 'name', MAX_NAME, true); break
      case 'pos': out.pos = vec(o.pos, 'pos'); break
      case 'size': out.size = size(o.size, 'size', kind === 'link' ? MIN_LINK_HEIGHT : MIN_SIDE); break
      case 'url':
        if (kind !== 'portal') fail('url só vale para portal')
        out.url = portalUrl(o.url)
        break
      case 'text':
        if (kind !== 'text') fail('text só vale para nó de texto')
        out.text = text(o.text, 'text', MAX_TEXT)
        break
      case 'fontSize':
        if (kind === 'note') {
          if (!validExtra('fontSize', o.fontSize)) fail('fontSize da nota deve ser inteiro entre 10 e 32')
          out.fontSize = o.fontSize as number
          break
        }
        if (kind === 'terminal') {
          if (invalidTerminalExtras({ fontSize: o.fontSize }).length > 0) fail('fontSize do terminal deve ficar entre 8 e 40')
          out.fontSize = o.fontSize as number
          break
        }
        if (kind !== 'text') fail('fontSize só vale para nó de texto ou terminal')
        out.fontSize = num(o.fontSize, 'fontSize', MIN_FONT, MAX_FONT)
        break
      case 'chatMode':
      case 'chatShowsShell':
        if (kind !== 'terminal') fail(`${key} só vale para terminal`)
        if (typeof o[key] !== 'boolean') fail(`${key} deve ser booleano`)
        out[key] = o[key]
        break
      case 'monitor':
        if (kind !== 'terminal') fail('monitor só vale para terminal')
        if (typeof o.monitor !== 'boolean') fail('monitor deve ser booleano')
        out.monitor = o.monitor
        break
      case 'color':
        if (kind === 'note') {
          if (o.color !== null && !validExtra('color', o.color)) fail('cor da nota deve ser #RRGGBB ou null')
          out.color = o.color as string | null
          break
        }
        if (kind !== 'terminal' && kind !== 'band') fail('color só vale para terminal, banda e nota')
        if (invalidTerminalExtras({ color: o.color }).length > 0) fail('color inválido')
        out.color = o.color as string
        break
      case 'render':
      case 'fontFamily':
      case 'locked':
        if (kind !== 'note') fail(`${key} só vale para nota`)
        if (!validExtra(key, o[key])) fail(`${key} inválido`)
        if (key === 'locked') out.locked = o.locked as boolean
        else if (key === 'render') out.render = o.render as 'markdown' | 'raw'
        else out.fontFamily = o.fontFamily as NoteNode['fontFamily']
        break
      case 'positionLocked':
      case 'redacted':
      case 'muted':
        if (key === 'redacted' && kind !== 'terminal' && kind !== 'note') fail('redacted só vale para terminal e nota')
        if (key === 'muted' && kind !== 'portal') fail('muted só vale para portal')
        if (typeof o[key] !== 'boolean') fail(`${key} deve ser booleano`)
        out[key] = o[key] as boolean
        break
      case 'stackId':
        if (kind !== 'note') fail('stackId só vale para nota')
        if (o.stackId !== null && !validExtra('stackId', o.stackId)) fail('stackId inválido')
        out.stackId = o.stackId as string | null
        break
      case 'current':
        if (kind !== 'filetree') fail('current só vale para a árvore de arquivos')
        out.current = absolutePath(o.current, 'current')
        break
      case 'chromeHidden':
        if (kind !== 'portal') fail('chromeHidden só vale para portal')
        if (!validExtra('chromeHidden', o.chromeHidden)) fail('chromeHidden deve ser booleano')
        out.chromeHidden = o.chromeHidden as boolean
        break
      case 'userAgent':
        if (kind !== 'portal') fail('userAgent só vale para portal')
        if (!validUserAgent(o.userAgent)) fail('userAgent deve ser uma linha de até 512 caracteres')
        out.userAgent = o.userAgent.trim()
        break
      case 'storage':
        if (kind !== 'portal') fail('storage só vale para portal')
        if (!validExtra('storage', o.storage)) fail('storage deve ser isolated, workspace ou global')
        out.storage = o.storage as PortalStorage
        break
      case 'icon':
        if (kind !== 'terminal' && kind !== 'band') fail(`${key} só vale para terminal e banda`)
        if (invalidTerminalExtras({ [key]: o[key] }).length > 0) fail(`${key} inválido`)
        out[key] = o[key] as string
        break
      case 'content':
        if (kind !== 'note') fail('content só vale para nota')
        out.content = text(o.content, 'content', MAX_CONTENT)
        break
      default: fail(`campo '${key}' não pode ser alterado`)
    }
  }
  return out
}

/** Caminho absoluto (arquivo ou pasta mostrados no canvas, só leitura). */
function absolutePath(v: unknown, what: string): string {
  const path = text(v, what, MAX_PATH, true)
  if (!isAbsolute(path)) fail(`${what} deve ser um caminho absoluto`)
  return path
}

export function parsePath(v: unknown): string {
  return absolutePath(v, 'caminho')
}

const MAX_DRAWING_TEXT = 5000
function drawingText(v: unknown): string {
  if (typeof v !== 'string') fail('text deve ser texto')
  if ((v as string).length > MAX_DRAWING_TEXT) fail(`text passa de ${MAX_DRAWING_TEXT} caracteres`)
  return v as string
}

/** Traço do lápis: pontos finitos, cor CSS simples (#hex ou nome) e largura positiva. */
export function parseDrawing(v: unknown): Omit<Drawing, 'id'> {
  const o = obj(v, 'desenho')
  const floorId = o.floorId === undefined || o.floorId === null ? null : text(o.floorId, 'floorId', MAX_NAME, true)
  if (!Array.isArray(o.points) || o.points.length < 1 || o.points.length > MAX_POINTS) fail(`points deve ter de 1 a ${MAX_POINTS} pontos`)
  const points = o.points.map((p, i) => vec(p, `points[${i}]`))
  const color = text(o.color, 'color', 32, true)
  if (!/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/.test(color)) fail('color deve ser #hex ou nome de cor')
  if (o.tool !== undefined && !(DRAW_KINDS as readonly unknown[]).includes(o.tool)) fail('tool de desenho desconhecida')
  if (isTwoPointKind(o.tool as DrawKind | undefined) && points.length !== 2) fail(`a forma ${String(o.tool)} é definida por 2 pontos`)
  if (o.pattern !== undefined && !(DRAW_PATTERNS as readonly unknown[]).includes(o.pattern)) fail('pattern deve ser solid, dashed ou dotted')
  if (o.fill !== undefined && !(DRAW_FILLS as readonly unknown[]).includes(o.fill)) fail('fill deve ser none, hatch, cross, tint ou solid')
  return {
    floorId, points, color, width: num(o.width, 'width', 0.5, MAX_STROKE),
    ...(o.tool === undefined ? {} : { tool: o.tool as DrawKind }), ...(o.pattern === undefined ? {} : { pattern: o.pattern as DrawPattern }),
    ...(o.fill === undefined ? {} : { fill: o.fill as DrawFill }), ...(o.radius === undefined ? {} : { radius: num(o.radius, 'radius', 0, MAX_RADIUS) }),
    ...(o.control === undefined ? {} : { control: vec(o.control, 'control') }),
    ...(o.text === undefined ? {} : { text: drawingText(o.text) }), ...(o.textSize === undefined ? {} : { textSize: num(o.textSize, 'textSize', 8, 200) }),
    ...(o.rotation === undefined ? {} : { rotation: num(o.rotation, 'rotation', -1000, 1000) })
  }
}

/** Estilo em lote de desenhos já gravados: só cor, largura, padrão, preenchimento e raio (nunca pontos, ferramenta ou andar). */
export function parseDrawingPatch(v: unknown): DrawingPatch {
  const o = obj(v, 'patch de desenho')
  const patch: DrawingPatch = {}
  for (const key of Object.keys(o)) if (!['color', 'width', 'pattern', 'fill', 'radius', 'control', 'text', 'textSize', 'points', 'rotation', 'locked', 'order'].includes(key)) fail(`campo "${key}" não pode ser alterado`)
  if (o.color !== undefined) { const c = text(o.color, 'color', 32, true); if (!/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/.test(c)) fail('color deve ser #hex ou nome de cor'); patch.color = c }
  if (o.width !== undefined) patch.width = num(o.width, 'width', 0.5, MAX_STROKE)
  if (o.pattern !== undefined) { if (!(DRAW_PATTERNS as readonly unknown[]).includes(o.pattern)) fail('pattern deve ser solid, dashed ou dotted'); patch.pattern = o.pattern as DrawPattern }
  if (o.fill !== undefined) { if (!(DRAW_FILLS as readonly unknown[]).includes(o.fill)) fail('fill deve ser none, hatch, cross, tint ou solid'); patch.fill = o.fill as DrawFill }
  if (o.radius !== undefined) patch.radius = num(o.radius, 'radius', 0, MAX_RADIUS)
  if (o.text !== undefined) patch.text = o.text === null ? null : drawingText(o.text)
  if (o.textSize !== undefined) patch.textSize = num(o.textSize, 'textSize', 8, 200)
  if (o.points !== undefined) { if (!Array.isArray(o.points) || o.points.length < 1 || o.points.length > MAX_POINTS) fail(`points deve ter de 1 a ${MAX_POINTS} pontos`); patch.points = o.points.map((p, i) => vec(p, `points[${i}]`)) }
  if (o.rotation !== undefined) patch.rotation = num(o.rotation, 'rotation', -1000, 1000)
  if (o.control !== undefined) patch.control = o.control === null ? null : vec(o.control, 'control')
  if (o.locked !== undefined) { if (typeof o.locked !== 'boolean') fail('locked deve ser booleano'); patch.locked = o.locked as boolean }
  if (o.order !== undefined) { if (o.order !== 'front' && o.order !== 'back') fail('order deve ser front ou back'); patch.order = o.order as 'front' | 'back' }
  if (!Object.keys(patch).length) fail('patch vazio')
  return patch
}

export function parseNewFloor(v: unknown): NewFloor {
  const o = obj(v, 'floor')
  const optional = (key: string): string | undefined => (o[key] === undefined || o[key] === null ? undefined : text(o[key], key, MAX_NAME, true))
  const branch = optional('branch')
  const from = optional('from')
  return {
    name: text(o.name, 'name', MAX_NAME, true),
    fromDir: text(o.fromDir, 'fromDir', MAX_PATH, true),
    ...(branch === undefined ? {} : { branch }),
    ...(from === undefined ? {} : { from })
  }
}

/** `null` limpa o status. */
export function parseFloorStatus(v: unknown): { state: FloorState; progress?: string } | null {
  if (v === null) return null
  const o = obj(v, 'status')
  if (typeof o.state !== 'string' || !FLOOR_STATES.includes(o.state as FloorState)) fail('state desconhecido')
  const progress = o.progress === undefined || o.progress === null ? undefined : text(o.progress, 'progress', MAX_PROGRESS)
  return { state: o.state as FloorState, ...(progress === undefined ? {} : { progress }) }
}

function optionalBoolean(o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') fail(`${key} deve ser verdadeiro ou falso`)
  return v
}

export function parseLandOptions(v: unknown): { into?: string; deleteBranch?: boolean; keepFloor?: boolean } {
  if (v === undefined || v === null) return {}
  const o = obj(v, 'opções')
  const into = o.into === undefined || o.into === null ? undefined : text(o.into, 'into', MAX_NAME, true)
  const deleteBranch = optionalBoolean(o, 'deleteBranch')
  const keepFloor = optionalBoolean(o, 'keepFloor')
  return { ...(into === undefined ? {} : { into }), ...(deleteBranch === undefined ? {} : { deleteBranch }), ...(keepFloor === undefined ? {} : { keepFloor }) }
}

export function parseRemoveOptions(v: unknown): { force?: boolean; keepBranch?: boolean } {
  if (v === undefined || v === null) return {}
  const o = obj(v, 'opções')
  const force = optionalBoolean(o, 'force')
  const keepBranch = optionalBoolean(o, 'keepBranch')
  return { ...(force === undefined ? {} : { force }), ...(keepBranch === undefined ? {} : { keepBranch }) }
}

/** Id de floor ou `null` (Ground). */
export function parseFloorId(v: unknown): string | null {
  return v === null ? null : parseId(v)
}

export function parseBandName(v: unknown): string {
  return text(v, 'name', MAX_NAME, true)
}

export function parseMemberIds(v: unknown): string[] {
  if (!Array.isArray(v)) return fail('members deve ser uma lista')
  if (v.length > MAX_MEMBERS) fail(`members passa de ${MAX_MEMBERS} itens`)
  return v.map(parseId)
}

/** O id do webContents é um inteiro não negativo. */
export function parseWebContentsId(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 2_147_483_647) fail('webContentsId inválido')
  return v
}
