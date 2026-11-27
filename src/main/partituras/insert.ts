import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { FloorId, NewNode, Partitura, Vec, Workspace } from '../../shared/model'
import type { WorkspaceStore } from '../domain/workspace-store'
import { validatePartitura } from './partitura-store'
const isDirectory = (path: string): boolean => {
  try { return statSync(path).isDirectory() } catch { return false }
}
/** `only`: só estes terminais, com as notas/portais ligados a eles e as bandas deles (skill: `create "Nome" "Agente"...`). */
export function capturePartitura(ws: Workspace, floorId: FloorId, opts: { noteText: boolean; only?: Set<string>; ids?: Set<string>; commands?: boolean }): Omit<Partitura, 'name' | 'createdAt'> {
  // `ids`: exatamente estes nós (menu do botão direito); a banda entra com os membros escolhidos.
  const only = opts.only, exact = opts.ids
  const linked = (id: string): boolean => ws.connections.some(c => (c.a === id && only!.has(c.b)) || (c.b === id && only!.has(c.a)))
  const picked = (n: Workspace['nodes'][string]): boolean => exact ? (n.kind === 'band' ? n.members.every(id => exact.has(id)) : exact.has(n.id)) : !only || (n.kind === 'terminal' ? only.has(n.id) : n.kind === 'band' ? n.members.some(id => only.has(id)) : linked(n.id))
  const chosen = Object.values(ws.nodes).filter(n => n.floorId === floorId && picked(n) && (n.kind !== 'band' || n.members.some(id => ws.nodes[id]?.kind === 'terminal' && ws.nodes[id]!.floorId === floorId && (!only || only.has(id)))))
  const keys = new Set(chosen.map(n => n.id)), minX = Math.min(...chosen.map(n => n.pos.x), Infinity), minY = Math.min(...chosen.map(n => n.pos.y), Infinity)
  const nodes = chosen.map(node => {
    const { id, ...copy } = structuredClone(node)
    copy.floorId = null; copy.pos = { x: node.pos.x - minX, y: node.pos.y - minY }
    if (copy.kind === 'terminal') { delete copy.recruitedBy; delete copy.autoStart }
    if (copy.kind === 'terminal' || copy.kind === 'portal') delete copy.unloaded
    // "Salvar comandos" desligado: o terminal é salvo como shell, sem comando nem o role do agente.
    if (copy.kind === 'terminal' && opts.commands === false) { copy.agent = 'shell'; copy.command = ''; delete copy.role }
    if (copy.kind === 'note' && !opts.noteText) copy.content = ''
    // A partitura é um molde: leva o texto, nunca o vínculo com um arquivo desta máquina.
    if (copy.kind === 'note') { delete copy.linkedFile; delete copy.fileMissing }
    if (copy.kind === 'filetree') delete copy.current
    if (copy.kind === 'band') copy.members = copy.members.filter(id => keys.has(id) && (!only || only.has(id)))
    return { ...copy, key: id }
  })
  return { nodes, connections: ws.connections.filter(c => keys.has(c.a) && keys.has(c.b)).map(({ a, b }) => ({ a, b })), bands: nodes.filter(n => n.kind === 'band').map(n => ({ name: n.name, members: n.members })) }
}
export function insertPartitura(store: WorkspaceStore, input: Partitura, floorId: FloorId, origin: Vec, opts: { commands: boolean }): string[] {
  const p = validatePartitura(input), ws = store.get()
  if (floorId !== null && !Object.hasOwn(ws.floors, floorId)) throw new Error('floor inexistente')
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || typeof opts.commands !== 'boolean') throw new Error('opções de inserção inválidas')
  const taken = new Set(Object.values(ws.nodes).filter(n => n.floorId === floorId).map(n => n.name.toLowerCase()))
  const name = (wanted: string): string => { let out = wanted; for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${wanted} ${i}`; taken.add(out.toLowerCase()); return out }
  const mapping = new Map<string, string>(), created: string[] = [], terminals: string[] = []
  try {
    for (const n of p.nodes.filter(n => n.kind !== 'band')) {
      const { key, ...copy } = structuredClone(n)
      const node: NewNode = { ...copy, name: name(copy.name), floorId, pos: { x: origin.x + copy.pos.x, y: origin.y + copy.pos.y } }
      if (node.kind === 'terminal') {
        delete node.recruitedBy; node.autoStart = opts.commands
        // No floor, a worktree dele; no Ground, a pasta salva, ou a home se ela não existe mais (ex.: worktree já integrada).
        if (floorId !== null) node.cwd = ws.floors[floorId]!.dir
        else if (!isDirectory(node.cwd)) node.cwd = homedir()
      }
      const id = store.addNode(node); mapping.set(key, id); created.push(id)
      if (node.kind === 'terminal' && opts.commands) terminals.push(id)
    }
    for (const n of p.nodes) if (n.kind === 'band') {
      const id = store.createBand(name(n.name), n.members.map(key => mapping.get(key)!), floorId)
      store.patchNode(id, { pos: { x: origin.x + n.pos.x, y: origin.y + n.pos.y }, size: n.size })
      mapping.set(n.key, id); created.push(id)
    }
    for (const band of p.bands) if (!p.nodes.some(n => n.kind === 'band' && n.name === band.name)) {
      const id = store.createBand(name(band.name), band.members.map(key => mapping.get(key)!), floorId)
      created.push(id)
    }
    for (const c of p.connections) store.connect(mapping.get(c.a)!, mapping.get(c.b)!)
    return terminals
  } catch (e) { for (const id of created.reverse()) store.removeNode(id, { force: true }); throw e }
}
