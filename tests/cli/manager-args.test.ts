import { parseArgs } from '../../src/cli/args'

const p = (...argv: string[]) => parseArgs(argv)

describe('manager: recruit', () => {
  it('flags novas: --role --workspace --account --icon --color', () => {
    expect(p('recruit', 'Lince', '--preset', 'Codex', '--role', 'Escritor de Testes', '--workspace', 'Frontend', '--account', 'Trabalho', '--icon', 'brain', '--color', 'blue'))
      .toEqual({ cmd: 'recruit', name: 'Lince', preset: 'Codex', role: 'Escritor de Testes', workspace: 'Frontend', account: 'Trabalho', icon: 'brain', color: 'blue' })
  })
  it('sem nome vira "Recruit"; cópia de você sem flags', () => {
    expect(p('recruit')).toEqual({ cmd: 'recruit', name: 'Recruit' })
  })
  it('--replace: nome posicional opcional (renomeia), --floor recusado', () => {
    expect(p('recruit', 'Codex', '--preset', 'Codex', '--replace', 'Claude')).toEqual({ cmd: 'recruit', name: 'Codex', preset: 'Codex', replace: 'Claude' })
    expect(p('recruit', '--preset', 'Shell', '--replace', 'Batedor')).toEqual({ cmd: 'recruit', preset: 'Shell', replace: 'Batedor' })
    expect(p('recruit', '--replace', 'Batedor', '--account', 'Trabalho')).toEqual({ cmd: 'recruit', replace: 'Batedor', account: 'Trabalho' })
    expect(() => p('recruit', '--replace', 'X', '--floor', 'F', '--preset', 'Codex')).toThrow(/--floor/)
    expect(() => p('recruit', '--replace', 'X')).toThrow(/--preset|--command|--account/)
  })
})

describe('manager: band, preset, role, partitura', () => {
  it('band create com --without-me --floor --workspace --icon --color', () => {
    expect(p('band', 'create', 'Revisores', 'Gavião', 'Lince', '--without-me', '--floor', 'Exp', '--workspace', 'Front', '--icon', 'eye', '--color', 'red'))
      .toEqual({ cmd: 'band-create', name: 'Revisores', members: ['Gavião', 'Lince'], withoutMe: true, floor: 'Exp', workspace: 'Front', icon: 'eye', color: 'red' })
    expect(p('band', 'create', 'Esquadrão')).toEqual({ cmd: 'band-create', name: 'Esquadrão', members: [] })
  })
  it('preset create (agente sai do comando) e set', () => {
    expect(p('preset', 'create', 'Claude Opus', '--command', 'claude --model opus', '--account', 'Trabalho'))
      .toEqual({ cmd: 'preset-create', name: 'Claude Opus', command: 'claude --model opus', account: 'Trabalho' })
    expect(p('preset', 'set', 'Claude Opus', '--maestro', 'on', '--quick-start', 'off')).toEqual({ cmd: 'preset-set', name: 'Claude Opus', maestro: true, quickStart: false })
    expect(p('preset', 'set', 'Claude Opus', '--name', 'Opus', '--command', 'claude --model opus --verbose'))
      .toEqual({ cmd: 'preset-set', name: 'Claude Opus', newName: 'Opus', command: 'claude --model opus --verbose' })
    expect(() => p('preset', 'set', 'X', '--maestro', 'talvez')).toThrow()
    expect(() => p('preset', 'set', 'X')).toThrow()
  })
  it('role create --scope, edit trecho/escopo, write', () => {
    expect(p('role', 'create', 'Revisor', 'Revise.', '--scope', 'global')).toEqual({ cmd: 'role-create', name: 'Revisor', text: 'Revise.', scope: 'global' })
    expect(p('role', 'create', 'Revisor', 'Revise.')).toEqual({ cmd: 'role-create', name: 'Revisor', text: 'Revise.' })
    expect(p('role', 'edit', 'Revisor', 'antigo', 'novo')).toEqual({ cmd: 'role-edit', name: 'Revisor', old: 'antigo', new: 'novo' })
    expect(p('role', 'edit', 'Revisor de Código', '--scope', 'global')).toEqual({ cmd: 'role-edit', name: 'Revisor de Código', scope: 'global' })
    expect(p('role', 'write', 'Revisor', 'prompt novo')).toEqual({ cmd: 'role-write', name: 'Revisor', text: 'prompt novo' })
    expect(() => p('role', 'edit', 'Revisor', 'só-um')).toThrow()
    expect(() => p('role', 'create', 'R', 'x', '--scope', 'galaxia')).toThrow()
  })
  it('partitura create/update com agentes, insert --workspace', () => {
    expect(p('partitura', 'create', 'Time', 'Gavião', 'Lince', '--without-me')).toEqual({ cmd: 'partitura-create', name: 'Time', agents: ['Gavião', 'Lince'], withoutMe: true, noteText: true })
    expect(p('partitura', 'update', 'Time', '--name', 'Time 2', '--description', 'd')).toEqual({ cmd: 'partitura-update', name: 'Time', agents: [], newName: 'Time 2', description: 'd' })
    expect(p('partitura', 'insert', 'Time', '--floor', 'F', '--workspace', 'W')).toEqual({ cmd: 'partitura-insert', name: 'Time', floor: 'F', workspace: 'W', commands: true })
  })
})

describe('workspace e space', () => {
  it('workspace create --dir obrigatório, --from --group --space', () => {
    expect(p('workspace', 'create', 'Churn', '--dir', '~/t/acme', '--from', 'Modelo', '--group', 'Dados', '--space', 'Clientes'))
      .toEqual({ cmd: 'workspace-create', name: 'Churn', dir: '~/t/acme', from: 'Modelo', group: 'Dados', space: 'Clientes' })
    expect(() => p('workspace', 'create', 'Churn')).toThrow(/--dir/)
  })
  it('workspace move --group | --root | --space', () => {
    expect(p('workspace', 'move', 'A', '--group', 'Arquivo 2026')).toEqual({ cmd: 'workspace-move', name: 'A', group: 'Arquivo 2026' })
    expect(p('workspace', 'move', 'A', '--root')).toEqual({ cmd: 'workspace-move', name: 'A', root: true })
    expect(p('workspace', 'move', 'A', '--space', 'Clientes')).toEqual({ cmd: 'workspace-move', name: 'A', space: 'Clientes' })
    expect(() => p('workspace', 'move', 'A')).toThrow()
    expect(() => p('workspace', 'move', 'A', '--group', 'G', '--root')).toThrow()
  })
  it('space create/edit/move/delete/list', () => {
    expect(p('space', 'create', 'Clientes', '--icon', 'folder', '--color', 'blue')).toEqual({ cmd: 'space-create', name: 'Clientes', icon: 'folder', color: 'blue' })
    expect(p('space', 'edit', 'Clientes', '--name', 'Cli', '--color', 'none')).toEqual({ cmd: 'space-edit', name: 'Clientes', newName: 'Cli', color: 'none' })
    expect(p('space', 'move', 'Clientes', '--to', '2')).toEqual({ cmd: 'space-move', name: 'Clientes', to: 2 })
    expect(p('space', 'move', 'Clientes', '--left')).toEqual({ cmd: 'space-move', name: 'Clientes', left: true })
    expect(() => p('space', 'move', 'Clientes')).toThrow()
    expect(p('space', 'delete', 'Clientes')).toEqual({ cmd: 'space-delete', name: 'Clientes' })
    expect(p('space', 'list')).toEqual({ cmd: 'space-list' })
  })
})

describe('floor', () => {
  it('create: --from CAMINHO --existing-branch --no-git --copy-ground --partitura', () => {
    expect(p('floor', 'create', 'Corrigir API', '--from', 'back', '--branch', 'fix', '--existing-branch', '--copy-ground', '--partitura', 'Time'))
      .toEqual({ cmd: 'floor-create', name: 'Corrigir API', from: 'back', branch: 'fix', existingBranch: true, copyGround: true, partitura: 'Time' })
    expect(p('floor', 'create', 'Rascunho', '--no-git')).toEqual({ cmd: 'floor-create', name: 'Rascunho', noGit: true })
  })
  it('create --dir não combina com --from/--branch/--existing-branch/--no-git', () => {
    expect(p('floor', 'create', 'Checkout', '--dir', 'worktrees/checkout')).toEqual({ cmd: 'floor-create', name: 'Checkout', dir: 'worktrees/checkout' })
    expect(() => p('floor', 'create', 'X', '--dir', 'd', '--branch', 'b')).toThrow(/--dir/)
  })
  it('delete --keep-folder; status com texto e --floor', () => {
    expect(p('floor', 'delete', 'R', '--keep-folder', '--keep-branch')).toEqual({ cmd: 'floor-delete', name: 'R', keepFolder: true, keepBranch: true })
    expect(p('floor', 'status', 'Testes verdes', '--progress', '3/5')).toEqual({ cmd: 'floor-status', text: 'Testes verdes', progress: '3/5' })
    expect(p('floor', 'status', '2 de 3 em revisão', '--floor', 'Ground')).toEqual({ cmd: 'floor-status', text: '2 de 3 em revisão', floor: 'Ground' })
    expect(p('floor', 'status')).toEqual({ cmd: 'floor-status' })
    expect(p('floor', 'status', '--clear')).toEqual({ cmd: 'floor-status', clear: true })
    expect(() => p('floor', 'status', 'x', '--clear')).toThrow()
  })
})

describe('routine', () => {
  it('create com --command e as agendas da skill', () => {
    expect(p('routine', 'create', 'Daily', '--command', 'Hora da daily', '--weekly', 'mon,tue,wed,thu,fri@09:00', '--reminder'))
      .toEqual({ cmd: 'routine-create', name: 'Daily', command: 'Hora da daily', weekly: 'mon,tue,wed,thu,fri@09:00', reminder: true })
    expect(p('routine', 'create', 'R', '--command', 'x', '--once', '2026-06-20 15:00')).toMatchObject({ once: '2026-06-20 15:00' })
    expect(p('routine', 'create', 'R', '--command', 'x', '--every', '1h30m')).toMatchObject({ every: '1h30m' })
    expect(() => p('routine', 'create', 'R', '--command', 'x')).toThrow(/exatamente um/)
    expect(() => p('routine', 'create', 'R', '--every', '1h')).toThrow(/--command/)
    expect(() => p('routine', 'create', 'R', '--command', 'x', '--every', '1h', '--reminder', '--terminal', 'T')).toThrow(/--reminder/)
  })
  it('opções: --pre-run (com \\n no comando), --no-skip-if-busy, --no-notify, --disabled, --count, --until', () => {
    expect(p('routine', 'create', 'Resumo', '--command', 'Resuma:\\n\\n{{output}}', '--daily', '18:00', '--pre-run', 'git log --oneline', '--no-skip-if-busy', '--no-notify', '--disabled', '--count', '3', '--until', '2026-07-01'))
      .toEqual({ cmd: 'routine-create', name: 'Resumo', command: 'Resuma:\n\n{{output}}', daily: '18:00', preRun: 'git log --oneline', noSkipIfBusy: true, noNotify: true, disabled: true, count: 3, until: '2026-07-01' })
  })
  it('edit muda só o que veio; --id em edit/show/enable/disable/run/delete', () => {
    expect(p('routine', 'edit', 'Auditoria', '--id', 'a1b2c3', '--daily', '03:00')).toEqual({ cmd: 'routine-edit', name: 'Auditoria', id: 'a1b2c3', daily: '03:00' })
    expect(p('routine', 'edit', 'A', '--name', 'B', '--command', 'y', '--terminal', 'T')).toEqual({ cmd: 'routine-edit', name: 'A', newName: 'B', command: 'y', terminal: 'T' })
    expect(() => p('routine', 'edit', 'A', '--daily', '1:00', '--every', '1h')).toThrow(/exatamente um/)
    expect(p('routine', 'delete', 'A', '--id', 'ab12')).toEqual({ cmd: 'routine-delete', name: 'A', id: 'ab12' })
    expect(p('routine', 'show', 'A')).toEqual({ cmd: 'routine-show', name: 'A' })
  })
})
