/** Listas do CLI em texto agrupado (`--json` imprime a resposta crua). */

const q = (s: string): string => JSON.stringify(s)
interface Status { state: string; progress?: string; text?: string }
const status = (s: Status): string => `${s.state}${s.text ? ` — ${s.text}` : ''}${s.progress ? ` (${s.progress})` : ''}`

/** `palco preset list`: uma linha por preset, com as contas do CLI e a conta fixada (como a skill descreve). */
export function formatPresets(rows: Array<{ name: string; agent: string; command: string; role?: string; account?: string; maestro?: boolean; quickStart?: boolean; accounts?: string[] }>): string {
  if (rows.length === 0) return 'Nenhum preset.\n'
  return rows.map((p) => {
    const extras = [
      p.command ? `command: ${q(p.command)}` : 'shell',
      ...(p.role ? [`role: ${q(p.role)}`] : []),
      ...(p.maestro ? ['maestro'] : []),
      ...(p.quickStart === false ? ['fora do início rápido'] : [])
    ]
    const accounts = p.accounts?.length ? `; accounts: ${p.accounts.map(q).join(', ')}` : ''
    const starts = p.account ? `; starts on ${q(p.account)}` : ''
    return `- ${q(p.name)} (${p.agent}) ${extras.join(', ')}${accounts}${starts}`
  }).join('\n') + '\n'
}

/** `palco role list`: "Workspace atual" e "Globais", com a prévia de cada role. */
export function formatRoles(r: { current: Array<{ name: string; preview: string }>; global: Array<{ name: string; preview: string }> }): string {
  const block = (title: string, items: Array<{ name: string; preview: string }>): string[] =>
    [`${title}:`, ...(items.length ? items.flatMap((i) => [`  - name: ${q(i.name)}`, `    preview: ${q(i.preview)}`]) : ['  (nenhum)'])]
  return [...block('Workspace atual', r.current), '', ...block('Globais', r.global)].join('\n') + '\n'
}

export interface FloorRow { unloaded?: boolean; name: string; dir?: string | null; branch?: string | null; baseRef?: string | null; baseDir?: string; git?: boolean; nodes?: number; status?: Status; active?: boolean }

/** `palco floor list`: o térreo e os andares, com branch, pasta, base, nós e status. */
export function formatFloors(rows: FloorRow[]): string {
  const out: string[] = []
  for (const f of rows) {
    out.push(`- name: ${q(f.name)}${f.active ? '  (na tela)' : ''}${f.unloaded ? '  (unloaded)' : ''}`)
    if (f.branch) out.push(`  branch: ${q(f.branch)}${f.baseRef ? ` (de ${f.baseRef})` : ''}`)
    if (f.git === false) out.push('  git: não (andar simples)')
    if (f.dir) out.push(`  dir: ${q(f.dir)}`)
    if (f.baseDir) out.push(`  base: ${q(f.baseDir)}`)
    if (f.nodes !== undefined) out.push(`  nós: ${f.nodes}`)
    if (f.status) out.push(`  status: ${status(f.status)}`)
  }
  return out.join('\n') + '\n'
}

export interface RoutineRow { name: string; shortId?: string; schedule: string; terminal: string; enabled: boolean; nextRun?: string; lastRun?: { at: string; result: string }; remaining?: number }

/** `palco routine list`: uma linha por rotina (id curto, nome, agenda, destino, status, próximo disparo). */
export function formatRoutines(rows: RoutineRow[]): string {
  if (rows.length === 0) return 'Nenhuma rotina neste workspace.\n'
  const when = (iso: string): string => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  return rows.map((r) => {
    const lines = [`- ${r.shortId ?? ''}  ${q(r.name)}`.replace('-   ', '- '), `  agenda: ${r.schedule}`, `  destino: ${r.terminal}`, `  status: ${r.enabled ? 'ativa' : 'pausada'}${r.remaining !== undefined ? ` (${r.remaining} disparo(s) restantes)` : ''}`]
    if (r.enabled && r.nextRun) lines.push(`  próximo: ${when(r.nextRun)}`)
    if (r.lastRun) lines.push(`  último: ${when(r.lastRun.at)} — ${r.lastRun.result}`)
    return lines.join('\n')
  }).join('\n') + '\n'
}

export interface WorkspaceRow { unloaded?: boolean; name: string; dir: string | null; floors: number; current?: boolean; active?: boolean }
export interface WorkspaceSpaceRow { space: string; onScreen?: boolean; workspaces: WorkspaceRow[]; groups: Array<{ name: string; workspaces: WorkspaceRow[] }> }

/** `palco workspace list`: a barra lateral como o usuário vê (raiz, depois cada grupo), um título por espaço quando há mais de um. */
export function formatWorkspaces(spaces: WorkspaceSpaceRow[]): string {
  if (spaces.every((s) => s.workspaces.length === 0 && s.groups.length === 0)) return 'Nenhum workspace.\n'
  const many = spaces.length > 1
  const out: string[] = []
  const item = (w: WorkspaceRow, indent: string): void => {
    out.push(`${indent}- ${q(w.name)}${w.current ? '  (seu terminal está aqui)' : ''}${w.unloaded ? '  (unloaded)' : ''}`)
    out.push(`${indent}  dir: ${w.dir ? q(w.dir) : '(sem pasta)'}`)
    out.push(`${indent}  andares: ${w.floors}`)
  }
  spaces.forEach((s, i) => {
    const base = many ? '  ' : ''
    if (many) {
      if (i > 0) out.push('')
      out.push(`Espaço ${q(s.space)}${s.onScreen ? '  (na tela)' : ''}:`)
      if (s.workspaces.length === 0 && s.groups.length === 0) out.push(`${base}(vazio)`)
    }
    for (const w of s.workspaces) item(w, base)
    for (const g of s.groups) {
      out.push(`${base}- grupo ${q(g.name)}:`)
      if (g.workspaces.length === 0) out.push(`${base}    (vazio)`)
      for (const w of g.workspaces) item(w, `${base}    `)
    }
  })
  return out.join('\n') + '\n'
}

/** `palco arrange` sem opções: o visual atual (nome, ícone e cor). */
export function formatLook(look: { name: string; icon?: string | null; color?: string | null }): string {
  return [`name: ${q(look.name)}`, `icon: ${look.icon || '(padrão)'}`, `color: ${look.color || '(padrão)'}`].join('\n') + '\n'
}
