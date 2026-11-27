import { AgentOptions } from './AgentOptions'
import { matchesShortcut, usePreferences } from '../settings/preferences'
import { localizeMessage } from '../../../shared/i18n/messages'
import { getLocale } from '../i18n'
import { isRemote, validateEnvironment, type Environment, type EnvironmentKind } from '../../../shared/environment'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Preset, Role } from '../../../shared/model'
import type { RoleCandidate } from '../../../shared/agent-libraries'
import { FileSearch } from 'lucide-react'
import { RoleDiscovery } from './RoleDiscovery'
import { TERMINAL_ICONS, TerminalIcon } from '../nodes/terminal-icons'
import {
  agentForCommand, COLORS, SubmitGuard, commandError, DEFAULT_COLOR, emptyForm, MAX_NAME, quickStartTiles, quickTileForm,
  type NewTerminalForm, type QuickTile
} from './new-terminal'
import { t, tr } from '../i18n'

type Tab = 'details' | 'appearance' | 'agent'

/** Conta de um agente; o seletor só aparece com 2 ou mais contas do agente do comando. */
export interface DialogAccount { id: string; name: string; agent: 'claude' | 'codex' | 'antigravity' }

/** Pergunta aberta antes de criar (diretório inexistente; fora da pasta pessoal). */
type Ask = { kind: 'mkdir'; path: string } | { kind: 'outside'; path: string } | null

const RUNS_ON: ReadonlyArray<{ value: EnvironmentKind; label: string; flag?: 'localTmuxEnabled' | 'sshEnabled' | 'dockerEnabled' | 'sandboxEnabled' }> = [
  { value: 'local', get label() { return t('dialogs.NewTerminalDialog.local') } },
  { value: 'tmux', get label() { return t('dialogs.NewTerminalDialog.local_tmux') }, flag: 'localTmuxEnabled' },
  { value: 'ssh', get label() { return t('dialogs.NewTerminalDialog.ssh') }, flag: 'sshEnabled' },
  { value: 'docker', get label() { return t('dialogs.NewTerminalDialog.docker') }, flag: 'dockerEnabled' },
  { value: 'sandbox', get label() { return t('dialogs.NewTerminalDialog.sandbox') }, flag: 'sandboxEnabled' }
]
const DEFAULT_ENV: Record<EnvironmentKind, Environment> = { local: { kind: 'local' }, tmux: { kind: 'tmux' }, ssh: { kind: 'ssh', host: '', user: '', port: 22 }, docker: { kind: 'docker', context: '', container: '', user: '' }, sandbox: { kind: 'sandbox', name: '', user: '' } }

const errorText = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

interface Props {
  /** Texto do tamanho escolhido (área desenhada), só informativo. */
  sizeLabel: string | null
  accounts?: DialogAccount[]
  /** Espaço de trabalho do terminal: é nele que "Descobrir Responsabilidades" procura. */
  workspaceId?: string
  onCancel(): void
  /** Cria o nó; devolve uma mensagem de erro para mostrar, ou `null` se deu certo. */
  onCreate(form: NewTerminalForm): Promise<string | null>
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="nt-toggle">
      <span className="nt-toggle-text">
        <span className="nt-label">{label}</span>
        <span className="nt-hint">{hint}</span>
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`nt-switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="nt-field">
      <span className="nt-label">{label}</span>
      {children}
    </label>
  )
}

/** O diálogo "Novo Terminal": início rápido, abas Detalhes, Aparência e Agente. */
export function NewTerminalDialog({ sizeLabel, accounts = [], workspaceId, onCancel, onCreate }: Props) {
  const [form, setForm] = useState<NewTerminalForm>(emptyForm)
  const [picked, setPicked] = useState<string | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const tiles = useMemo(() => quickStartTiles(presets), [presets])
  const [tab, setTab] = useState<Tab>('details')
  const [roles, setRoles] = useState<Role[]>([])
  const [ask, setAsk] = useState<Ask>(null)
  const [found, setFound] = useState<RoleCandidate[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const prefs = usePreferences()
  const set = <K extends keyof NewTerminalForm>(key: K, value: NewTerminalForm[K]): void => setForm((f) => ({ ...f, [key]: value }))
  // Uma operação de criação por vez; fechar o diálogo invalida a que estiver pendente.
  const guard = useRef(new SubmitGuard())
  const cancel = useCallback((): void => {
    guard.current.cancel()
    onCancel()
  }, [onCancel])
  useEffect(() => () => guard.current.cancel(), [])

  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.focus())
    void window.palco.presets.roles().then(setRoles).catch(() => setRoles([]))
    void window.palco.presets.list().then(setPresets).catch(() => setPresets([]))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Com a folha de descoberta aberta, o Escape é dela.
      if (found || !matchesShortcut('cancel', e)) return
      e.stopPropagation()
      if (ask) setAsk(null)
      else cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ask, cancel, found])

  const scan = async (): Promise<void> => {
    if (!workspaceId) return
    setScanning(true); setDiscoveryError(null); setError(null)
    try { setFound(await window.palco.roles.discover(workspaceId)) } catch (err) { setError(errorText(err)) } finally { setScanning(false) }
  }
  const importRoles = async (chosen: RoleCandidate[]): Promise<void> => {
    if (!workspaceId) return
    setScanning(true); setDiscoveryError(null)
    try {
      await window.palco.roles.import(chosen, workspaceId)
      setRoles(await window.palco.presets.roles())
      setFound(null)
    } catch (err) { setDiscoveryError(errorText(err)) } finally { setScanning(false) }
  }

  const agent = form.agent === 'auto' ? agentForCommand(form.command) : form.agent
  const cmdError = commandError(form.command)
  const agentAccounts = useMemo(() => accounts.filter((a) => a.agent === agent), [accounts, agent])
  const takesRole = agent === 'claude' || agent === 'codex'

  const pick = (tile: QuickTile): void => {
    setPicked(tile.id)
    setForm((f) => ({ ...f, ...quickTileForm(tile, accounts) }))
  }

  /** Cria de fato (o diretório já existe ou foi criado), se a operação ainda vale. */
  const finish = async (op: { alive(): boolean }): Promise<void> => {
    if (!op.alive()) return
    setError(null)
    const resolved = form.agent === 'auto' ? await window.palco.terminal.resolveAgent(form.command) : { agent: form.agent }
    if (!op.alive()) return
    const failure = await onCreate({ ...form, agent: resolved.agent, agentWarning: resolved.warning })
    if (failure && op.alive()) setError(failure)
  }

  /** Roda um passo do Criar com a trava: ignorado se já há outro em andamento. */
  const guarded = async (step: (op: { alive(): boolean }) => Promise<void>): Promise<void> => {
    const op = guard.current.begin()
    if (!op) return
    setBusy(true)
    try {
      await step(op)
    } finally {
      if (op.alive()) setBusy(false)
      op.end()
    }
  }

  const submit = (): Promise<void> => {
    if (cmdError) return Promise.resolve()
    return guarded(async (op) => {
      const dir = form.cwd.trim()
      if (form.environment && form.environment.kind !== 'local') {
        try { validateEnvironment(form.environment) } catch (err) { setTab('details'); return setError(localizeMessage(errorText(err), getLocale())) }
      }
      // Em SSH, contêiner ou sandbox a pasta é do outro lado: não há o que conferir no disco local.
      if (dir !== '' && !isRemote(form.environment)) {
        let exists: boolean
        try {
          exists = await window.palco.files.exists(dir)
        } catch (err) {
          if (!op.alive()) return
          setTab('details')
          return setError(t('dialogs.NewTerminalDialog.diretorio_invalido_v1', { v1: errorText(err) }))
        }
        if (!op.alive()) return
        if (!exists) return setAsk({ kind: 'mkdir', path: dir })
      }
      await finish(op)
    })
  }

  const makeDir = (outsideHome: boolean): Promise<void> => {
    if (!ask) return Promise.resolve()
    const path = ask.path
    setAsk(null)
    return guarded(async (op) => {
      try {
        await window.palco.files.mkdir(path, outsideHome ? { outsideHome: true } : undefined)
      } catch (err) {
        if (!op.alive()) return
        const text = errorText(err)
        // Fora da pasta pessoal (inclusive por symlink): só com uma segunda confirmação explícita.
        if (!outsideHome && /fora da pasta pessoal/.test(text)) return setAsk({ kind: 'outside', path })
        setTab('details')
        return setError(t('dialogs.NewTerminalDialog.nao_foi_possivel_criar_o_diret', { text }))
      }
      await finish(op)
    })
  }

  const browse = (): void => {
    void window.palco.files.pick('dir').then((dir) => { if (dir) set('cwd', dir) }).catch(() => {})
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'details', label: t('dialogs.NewTerminalDialog.detalhes') },
    { id: 'appearance', label: t('dialogs.NewTerminalDialog.aparencia') },
    { id: 'agent', label: t('dialogs.NewTerminalDialog.agente') }
  ]
  const customColor = !COLORS.some((c) => c.hex.toLowerCase() === form.color.toLowerCase())

  return (
    <div className="modal-back nt-back" onPointerDown={cancel}>
      <div className="nt-sheet" role="dialog" aria-modal="true" aria-label={t('dialogs.NewTerminalDialog.novo_terminal')} onPointerDown={(e) => e.stopPropagation()}>
        <header className="nt-titlebar">
          <button type="button" className="nt-textbtn" onClick={cancel}>{t('dialogs.NewTerminalDialog.cancelar')}</button>
          <div className="nt-title">
            <strong>{t('dialogs.NewTerminalDialog.novo_terminal')}</strong>
            {sizeLabel && <span className="nt-size">{sizeLabel}</span>}
          </div>
          <button type="submit" form="new-terminal-form" className="nt-textbtn strong" disabled={busy || !!cmdError || ask !== null}>
            {busy ? t('dialogs.NewTerminalDialog.salvando') : t('dialogs.NewTerminalDialog.criar')}
          </button>
        </header>

        <div className="nt-quick">
          <span className="nt-caps">{t('dialogs.NewTerminalDialog.inicio_rapido')}</span>
          <div className="nt-quick-grid" role="group" aria-label={t('dialogs.NewTerminalDialog.inicio_rapido')}>
            {tiles.map((q) => (
              <button key={q.id} type="button" aria-pressed={picked === q.id} className={`nt-tile${picked === q.id ? ' active' : ''}`} onClick={() => pick(q)}>
                <TerminalIcon icon={q.icon} size={24} />
                <span>{q.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="nt-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`nt-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="nt-scroll">
          {ask && (
            <div className="nt-ask" role="alertdialog" aria-label={ask.kind === 'mkdir' ? t('dialogs.NewTerminalDialog.criar_diretorio') : t('dialogs.NewTerminalDialog.fora_da_pasta_pessoal')}>
              <strong>{ask.kind === 'mkdir' ? t('dialogs.NewTerminalDialog.criar_diretorio') : t('dialogs.NewTerminalDialog.criar_fora_da_pasta_pessoal')}</strong>
              <p>
                {ask.kind === 'mkdir'
                  ? t('dialogs.NewTerminalDialog.o_diretorio_path_nao_existe_de', { path: ask.path })
                  : t('dialogs.NewTerminalDialog.path_fica_fora_da_sua_pasta_pe', { path: ask.path })}
              </p>
              <div className="nt-ask-actions">
                <button type="button" onClick={() => setAsk(null)}>{t('dialogs.NewTerminalDialog.cancelar')}</button>
                <button type="button" className={ask.kind === 'outside' ? 'danger' : 'primary'} onClick={() => void makeDir(ask.kind === 'outside')}>{t('dialogs.NewTerminalDialog.criar')}</button>
              </div>
            </div>
          )}

          <form id="new-terminal-form" className="nt-form" hidden={ask !== null} onSubmit={(e) => { e.preventDefault(); void submit() }}>
            {error && <div className="nt-error" role="alert">{t('dialogs.NewTerminalDialog.nao_foi_possivel_criar_o_termi', { error })}</div>}

            {tab === 'details' && (
              <>
                <Field label={t('dialogs.NewTerminalDialog.nome_do_terminal')}>
                  <input ref={nameRef} className="nt-input" value={form.name} maxLength={MAX_NAME} placeholder={t('dialogs.NewTerminalDialog.nome_do_terminal_2')} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label={t('dialogs.NewTerminalDialog.comando')}>
                  <input
                    className="nt-input" value={form.command} placeholder={t('dialogs.NewTerminalDialog.ex_claude_codex_ou_deixe_vazio')}
                    autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={!!cmdError}
                    onChange={(e) => { set('command', e.target.value); set('monitor', e.target.value.trim() !== '') }}
                  />
                  {cmdError && <span className="nt-hint warn">{cmdError}</span>}
                </Field>
                <Field label={t('dialogs.NewTerminalDialog.tipo_de_agente')}>
                  <select className="nt-select" aria-label={t('dialogs.NewTerminalDialog.tipo_de_agente')} value={form.agent} onChange={(e) => {
                    const agent = e.target.value as typeof form.agent
                    setForm((f) => ({ ...f, agent, accountId: null, ...((agent === 'shell' || agent === 'other') ? { role: null } : {}) }))
                  }}>
                    <option value="auto">{t('dialogs.NewTerminalDialog.automatico')}</option>
                    <option value="claude">{t('dialogs.NewTerminalDialog.claude')}</option>
                    <option value="codex">{t('dialogs.NewTerminalDialog.codex')}</option>
                    <option value="antigravity">{t('dialogs.NewTerminalDialog.antigravity')}</option>
                    <option value="other">{t('dialogs.NewTerminalDialog.outro')}</option>
                  </select>
                </Field>
                <AgentOptions agent={agent} command={form.command} onChange={value => set('command', value)} />
                <div className="nt-row">
                  <span className="nt-label">{t('dialogs.NewTerminalDialog.executa_em')}</span>
                  <select className="nt-select" value={form.environment?.kind ?? 'local'} onChange={(e) => set('environment', DEFAULT_ENV[e.target.value as EnvironmentKind])} aria-label={t('dialogs.NewTerminalDialog.executa_em')}>
                    {RUNS_ON.map((r) => { const off = r.flag !== undefined && !prefs[r.flag]; return <option key={r.value} value={r.value} disabled={off} title={off ? t('dialogs.NewTerminalDialog.ligue_em_configuracoes_geral_a') : undefined}>{off ? t('dialogs.NewTerminalDialog.label_desligado', { label: r.label }) : r.label}</option> })}
                  </select>
                </div>
                {form.environment?.kind === 'ssh' && (
                  <div className="nt-row nt-env" role="group" aria-label={t('dialogs.NewTerminalDialog.servidor_ssh')}>
                    <input className="nt-input" aria-label={t('dialogs.NewTerminalDialog.host')} placeholder={t('dialogs.NewTerminalDialog.host_2')} value={form.environment.host} spellCheck={false} onChange={(e) => set('environment', { ...form.environment as Extract<Environment, { kind: 'ssh' }>, host: e.target.value.trim() })} />
                    <input className="nt-input" aria-label={t('dialogs.NewTerminalDialog.usuario')} placeholder={t('dialogs.NewTerminalDialog.usuario_2')} value={form.environment.user} spellCheck={false} onChange={(e) => set('environment', { ...form.environment as Extract<Environment, { kind: 'ssh' }>, user: e.target.value.trim() })} />
                    <input className="nt-input" aria-label={t('dialogs.NewTerminalDialog.porta')} type="number" min={1} max={65535} value={form.environment.port} onChange={(e) => set('environment', { ...form.environment as Extract<Environment, { kind: 'ssh' }>, port: Number(e.target.value) })} />
                    <span className="nt-hint">{t('dialogs.NewTerminalDialog.autentica_pela_sua_chave_ou_pe')}</span>
                  </div>
                )}
                {form.environment?.kind === 'docker' && (
                  <div className="nt-row nt-env" role="group" aria-label={t('dialogs.NewTerminalDialog.conteiner_docker')}>
                    <input className="nt-input" aria-label={t('dialogs.NewTerminalDialog.conteiner')} placeholder={t('dialogs.NewTerminalDialog.nome_do_conteiner_ja_em_execuc')} value={form.environment.container} spellCheck={false} onChange={(e) => set('environment', { ...form.environment as Extract<Environment, { kind: 'docker' }>, container: e.target.value.trim() })} />
                    <input className="nt-input" aria-label={t('dialogs.NewTerminalDialog.contexto')} placeholder={t('dialogs.NewTerminalDialog.contexto_opcional')} value={form.environment.context} spellCheck={false} onChange={(e) => set('environment', { ...form.environment as Extract<Environment, { kind: 'docker' }>, context: e.target.value.trim() })} />
                    <input className="nt-input" aria-label={t('dialogs.NewTerminalDialog.usuario')} placeholder={t('dialogs.NewTerminalDialog.usuario_opcional')} value={form.environment.user} spellCheck={false} onChange={(e) => set('environment', { ...form.environment as Extract<Environment, { kind: 'docker' }>, user: e.target.value.trim() })} />
                  </div>
                )}
                {form.environment?.kind === 'sandbox' && (
                  <div className="nt-row nt-env" role="group" aria-label={t('dialogs.NewTerminalDialog.docker_sandbox')}>
                    <input className="nt-input" aria-label={t('dialogs.NewTerminalDialog.nome_da_sandbox')} placeholder={t('dialogs.NewTerminalDialog.nome_da_sandbox_2')} value={form.environment.name} spellCheck={false} onChange={(e) => set('environment', { ...form.environment as Extract<Environment, { kind: 'sandbox' }>, name: e.target.value.trim() })} />
                    <input className="nt-input" aria-label={t('dialogs.NewTerminalDialog.usuario')} placeholder={t('dialogs.NewTerminalDialog.usuario_opcional')} value={form.environment.user} spellCheck={false} onChange={(e) => set('environment', { ...form.environment as Extract<Environment, { kind: 'sandbox' }>, user: e.target.value.trim() })} />
                  </div>
                )}
                {agentAccounts.length >= 1 && (
                  <div className="nt-row">
                    <span className="nt-label">{t('dialogs.NewTerminalDialog.conta')}</span>
                    <select className="nt-select" aria-label={t('dialogs.NewTerminalDialog.conta')} value={form.accountId ?? ''} onChange={(e) => set('accountId', e.target.value || null)}>
                      <option value="">{t('dialogs.NewTerminalDialog.padrao')}</option>
                      {agentAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
                <Field label={t('dialogs.NewTerminalDialog.diretorio_de_trabalho')}>
                  <span className="nt-dir">
                    <input className="nt-input" value={form.cwd} placeholder={t('dialogs.NewTerminalDialog.ex_projeto_ou_home_usuario_pro')} spellCheck={false} onChange={(e) => set('cwd', e.target.value)} />
                    <button type="button" className="nt-browse" onClick={browse} disabled={isRemote(form.environment)}>{t('dialogs.NewTerminalDialog.procurar')}</button>
                  </span>
                </Field>
                <Toggle label={t('dialogs.NewTerminalDialog.monitorar_atividade')} hint={t('dialogs.NewTerminalDialog.detecta_a_saida_do_terminal_e_')} checked={form.monitor} onChange={(v) => set('monitor', v)} />
                <Toggle label={t('dialogs.NewTerminalDialog.maestro')} hint={t('dialogs.NewTerminalDialog.promove_este_terminal_a_regent')} checked={form.maestro} onChange={(v) => set('maestro', v)} />
              </>
            )}

            {tab === 'appearance' && (
              <>
                <fieldset className="nt-fieldset">
                  <legend className="nt-label">{t('dialogs.NewTerminalDialog.icone')}</legend>
                  <div className="nt-icons" role="group" aria-label={t('dialogs.NewTerminalDialog.icone')}>
                    <input
                      className={`nt-emoji${!TERMINAL_ICONS[form.icon] ? ' active' : ''}`} aria-label={t('dialogs.NewTerminalDialog.emoji')} placeholder="😀" maxLength={8}
                      value={TERMINAL_ICONS[form.icon] ? '' : form.icon} onChange={(e) => set('icon', e.target.value.trim() || 'terminal')}
                    />
                    {Object.keys(TERMINAL_ICONS).map((name) => (
                      <button key={name} type="button" title={name} aria-label={name} aria-pressed={form.icon === name} className={`nt-icon${form.icon === name ? ' active' : ''}`} onClick={() => set('icon', name)}>
                        <TerminalIcon icon={name} size={16} />
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="nt-fieldset">
                  <legend className="nt-label">{t('dialogs.NewTerminalDialog.cor')}</legend>
                  <div className="nt-colors">
                    {COLORS.map((c) => (
                      <button key={c.hex} type="button" title={tr(c.name)} aria-label={tr(c.name)} aria-pressed={form.color === c.hex} className={`nt-dot${form.color === c.hex ? ' active' : ''}`} style={{ background: c.hex }} onClick={() => set('color', c.hex)} />
                    ))}
                    <label className={`nt-dot nt-custom${customColor ? ' active' : ''}`} title={t('dialogs.NewTerminalDialog.cor_personalizada')}>
                      <input type="color" aria-label={t('dialogs.NewTerminalDialog.cor_personalizada')} value={customColor ? form.color : DEFAULT_COLOR} onChange={(e) => set('color', e.target.value.toUpperCase())} />
                    </label>
                  </div>
                </fieldset>
                <div className="nt-row">
                  <span className="nt-label">{t('dialogs.NewTerminalDialog.tamanho_da_fonte')}</span>
                  <span className="nt-stepper">
                    <button type="button" aria-label={t('dialogs.NewTerminalDialog.diminuir_fonte')} onClick={() => setForm((f) => ({ ...f, fontSize: Math.max(8, f.fontSize - 1) }))}>−</button>
                    <span aria-live="polite">{form.fontSize}</span>
                    <button type="button" aria-label={t('dialogs.NewTerminalDialog.aumentar_fonte')} onClick={() => setForm((f) => ({ ...f, fontSize: Math.min(40, f.fontSize + 1) }))}>+</button>
                  </span>
                </div>
              </>
            )}

            {tab === 'agent' && (
              <>
                <p className="nt-hint">{t('dialogs.NewTerminalDialog.atribua_uma_responsabilidade_p')}</p>
                {!takesRole && <p className="nt-hint warn">{t('dialogs.NewTerminalDialog.o_role_so_vale_para_claude_e_c')}</p>}
                <div className="nt-roles" role="radiogroup" aria-label={t('dialogs.NewTerminalDialog.role')}>
                  {roles.length === 0 && <span className="nt-hint">{t('dialogs.NewTerminalDialog.nenhum_role_ainda_crie_com_pal')}</span>}
                  {roles.map((r) => (
                    <button key={r.name} type="button" role="radio" aria-checked={form.role === r.name} disabled={!takesRole} className={`nt-role${form.role === r.name ? ' active' : ''}`} onClick={() => set('role', r.name)}>
                      <strong>{r.name}</strong>
                      <span>{r.text.split('\n')[0]}</span>
                    </button>
                  ))}
                </div>
                <div className="nt-row end">
                  {workspaceId && <button type="button" className="nt-textbtn nt-discover" disabled={scanning} onClick={() => { void scan() }}><FileSearch size={14} aria-hidden="true" />{t('settings.tabs.agent-libraries.descobrir_responsabilidades')}</button>}
                  <button type="button" className="nt-textbtn" disabled={form.role === null} onClick={() => set('role', null)}>{t('dialogs.NewTerminalDialog.remover_responsabilidade')}</button>
                </div>
              </>
            )}
          </form>
        </div>
      </div>
      {found && <RoleDiscovery candidates={found} busy={scanning} error={discoveryError} onClose={() => setFound(null)} onImport={chosen => { void importRoles(chosen) }} />}
    </div>
  )
}
