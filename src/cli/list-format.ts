/** Resposta de `GET /list` (o CLI imprime em texto; `palco list --json` imprime isto). */
export interface ListReply {
  self: { name: string; floor?: string; address?: string; maestro?: boolean }
  agents: Array<{ name: string; agent?: string; running?: boolean; floor?: string; role?: string; account?: string; dormant?: boolean; connections?: Array<{ name: string; kind: string }> }>
  notes: Array<{ name: string; locked?: boolean; stack?: string; parent?: string }>
  stacks?: string[]
  bands: Array<{ name: string; members: string[]; you?: boolean; icon?: string; color?: string }>
  portals: Array<{ name: string }>
}

const q = (s: string): string => JSON.stringify(s)

/** Lista em texto: blocos com `- name:` e indentação para o que pende de algo. */
export function formatList(r: ListReply): string {
  const out: string[] = ['You:', `  - name: ${q(r.self.name)}`]
  if (r.self.address && r.self.address !== r.self.name) out.push(`    address: ${q(r.self.address)}`)
  if (r.self.floor) out.push(`    floor: ${q(r.self.floor)}`)
  if (r.self.maestro) out.push('    maestro: true')

  if (r.agents.length) {
    out.push('', 'Connected agents:')
    for (const a of r.agents) {
      out.push(`  - name: ${q(a.name)}`)
      if (a.agent) out.push(`    agent: ${a.agent}`)
      if (a.role) out.push(`    role: ${q(a.role)}`)
      if (a.account) out.push(`    account: ${q(a.account)}`)
      if (a.floor) out.push(`    floor: ${q(a.floor)}`)
      if (a.dormant) out.push('    status: dormindo (sobe quando você falar com ele)')
      else if (a.running === false) out.push('    status: exited')
      if (a.connections?.length) {
        out.push('    connections:')
        for (const c of a.connections) out.push(`      - ${c.kind}: ${q(c.name)}`)
      }
    }
  }

  if (r.notes.length) {
    out.push('', 'Notes:')
    const noteLine = (n: ListReply['notes'][number], indent: string): void => {
      out.push(`${indent}- name: ${q(n.name)}${n.locked ? '  (locked: true)' : ''}`)
      for (const child of r.notes.filter((c) => c.parent === n.name)) noteLine(child, `${indent}    `)
    }
    const roots = r.notes.filter((n) => !n.parent || !r.notes.some((p) => p.name === n.parent))
    for (const n of roots.filter((x) => !x.stack)) noteLine(n, '  ')
    for (const stack of [...new Set(roots.flatMap((n) => (n.stack ? [n.stack] : [])))]) {
      out.push(`  - stack: ${q(stack)}`)
      for (const n of roots.filter((x) => x.stack === stack)) noteLine(n, '      ')
    }
  }

  if (r.portals.length) {
    out.push('', 'Portals:')
    for (const p of r.portals) out.push(`  - name: ${q(p.name)}`)
  }

  if (r.bands.length) {
    out.push('', 'Bands:')
    for (const b of r.bands) {
      out.push(`  - name: ${q(b.name)}${b.you ? '  (you are in it)' : ''}`)
      if (b.icon || b.color) out.push(`    look: ${[b.icon, b.color].filter(Boolean).join(' ')}`)
      out.push('    members:')
      for (const m of b.members) out.push(`      - ${q(m)}`)
    }
  }
  return out.join('\n') + '\n'
}
