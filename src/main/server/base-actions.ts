import { randomUUID } from 'node:crypto'
import type { CanvasNode, NoteNode, TerminalNode } from '../../shared/model'
import type { WorkspaceStore } from '../domain/workspace-store'
import { localName, reachable } from '../domain/reachability'
import { parseNodePatch } from '../validate'

export class BaseActionError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export class BaseActions {
  constructor(private readonly store: WorkspaceStore, private readonly caller: TerminalNode) {}
  visible(): CanvasNode[] {
    const ws = this.store.get(), roots = [this.caller, ...Object.values(ws.nodes).filter(n => n.kind === 'terminal' && n.recruitedBy === this.caller.id)]
    return [...new Map(roots.flatMap(n => [n, ...reachable(ws, n.id)]).map(n => [n.id, n])).values()]
  }
  /** Nome do fichário (o id quando não tem nome próprio). */
  stackName(id: string): string { return this.store.get().stackNames?.[id] ?? id }
  /** Id do fichário com esse nome entre as notas visíveis; com `create`, um fichário novo com nome próprio. */
  stackIdOf(name: string, create: boolean): string | undefined {
    name = localName(name)
    const wanted = name.trim().toLowerCase()
    const ids = [...new Set(this.visible().flatMap(n => (n.kind === 'note' && n.stackId ? [n.stackId] : [])))]
    const found = ids.find(id => this.stackName(id).toLowerCase() === wanted)
    if (found || !create) return found
    if (!name.trim() || name.length > 200) throw new BaseActionError(400, 'nome de fichário inválido')
    const id = `f-${randomUUID()}`
    this.store.setStackName(id, name)
    return id
  }
  /** `kind` (flag logo depois do nome) escolhe entre tipos que têm o mesmo nome. */
  target(raw: string, kind?: string): CanvasNode[] {
    const name = localName(raw)
    const fits = (n: CanvasNode): boolean => kind === undefined || (kind === 'agent' ? n.kind === 'terminal' : n.kind === kind)
    const all = this.visible(), named = all.filter(fits), exact = named.filter(n => n.name === name), found = exact.length ? exact : named.filter(n => n.name.toLowerCase() === name.toLowerCase())
    if (found.length === 1) return found
    if (found.length > 1) throw new BaseActionError(404, 'nome ambíguo')
    const stack = kind === undefined || kind === 'fichario' ? this.stackIdOf(name, false) : undefined
    const notes = all.filter((n): n is NoteNode => n.kind === 'note' && stack !== undefined && n.stackId === stack)
    if (notes.length) return notes
    throw new BaseActionError(404, 'alvo não encontrado')
  }
  arrange(input: Record<string, unknown>): unknown {
    const nodes = input.target === undefined ? [this.caller] : this.target(String(input.target), input.kind === undefined ? undefined : String(input.kind))
    if (nodes.length !== 1) throw new BaseActionError(400, 'use uma nota individual')
    const node = nodes[0]!
    const patch = Object.fromEntries(['name', 'color', 'icon'].filter(k => input[k] !== undefined).map(k => [k, input[k]]))
    if (!Object.keys(patch).length) return { name: node.name, ...('color' in node ? {color: node.color} : {}), ...('icon' in node ? {icon: node.icon} : {}) }
    if (node.id !== this.caller.id && node.kind !== 'note' && !this.caller.maestro) throw new BaseActionError(403, 'só o Maestro pode alterar colegas ou bandas')
    this.store.patchNode(node.id, parseNodePatch(patch, node.kind))
    return { name: this.store.get().nodes[node.id]!.name }
  }
  connect(from: string, to: string, fromKind?: string, toKind?: string): void {
    const left = this.target(from, fromKind), right = this.target(to, toKind)
    const pairs = left.flatMap(a => right.map(b => [a,b] as const))
    for (const [a,b] of pairs) {
      const agent = (n: CanvasNode) => n.kind === 'terminal' || n.kind === 'band'
      if (a.id === b.id) throw new BaseActionError(400, 'não conecte um nó a ele mesmo')
      if ((!agent(a) || !agent(b)) && a.floorId !== b.floorId) throw new BaseActionError(400, 'notas e portais exigem o mesmo andar')
      if ((a.kind === 'portal' && !agent(b)) || (b.kind === 'portal' && !agent(a))) throw new BaseActionError(400, 'portal só conecta a agente ou banda')
    }
    for (const [a,b] of pairs) this.store.connect(a.id,b.id)
  }
  stack(name: string, stack: string | null): void {
    const nodes = this.target(name)
    if (nodes.length !== 1 || nodes[0]!.kind !== 'note') throw new BaseActionError(400, 'o alvo deve ser uma nota')
    if (stack !== null && (!stack.trim() || stack.length > 200)) throw new BaseActionError(400, 'nome de fichário inválido')
    this.store.patchNode(nodes[0]!.id, { stackId: stack === null ? null : this.stackIdOf(stack, true)! })
  }
  delete(name: string, stack: boolean): void {
    const stackId = stack ? this.stackIdOf(name, false) : undefined
    const nodes = stack ? this.visible().filter(n => n.kind === 'note' && stackId !== undefined && n.stackId === stackId) : this.target(name)
    if (!nodes.length) throw new BaseActionError(404, 'alvo não encontrado')
    if (nodes.some(n => n.kind !== 'note') || (!stack && nodes.length !== 1)) throw new BaseActionError(400, 'use note delete --stack para um fichário')
    // Todos conferidos antes: um fichário com uma nota bloqueada não é apagado pela metade.
    for (const node of nodes) this.store.assertRemovable(node.id)
    for (const node of nodes) this.store.removeNode(node.id)
  }
}
