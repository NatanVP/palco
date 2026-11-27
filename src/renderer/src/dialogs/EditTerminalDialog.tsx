import { AgentOptions } from './AgentOptions'
import { agentForCommand } from '../../../shared/agent-command'
import { TerminalAccountPicker } from './TerminalAccountPicker'
import { matchesShortcut, getPreferences } from '../settings/preferences'
import { useEffect, useState } from 'react'
import type { AgentKind, TerminalNode } from '../../../shared/model'
import { TERMINAL_ICONS } from '../nodes/terminal-icons'
import { ColorRow, IconGrid } from './AppearanceFields'
import { commandError, DEFAULT_COLOR, DEFAULT_ICON, MAX_NAME } from './new-terminal'
import { t } from '../i18n'

interface Props {
  node: TerminalNode
  onClose(): void
  onError(title: string, err: unknown): void
}

const errorText = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '').replace(/^(payload inválido|invalid payload): /, '')

/**
 * "Editar terminal" (lápis da barra contextual): nome, comando, pasta, ícone, cor e fonte.
 * Mudar comando ou pasta reinicia o processo, depois de uma confirmação explícita.
 */
export function EditTerminalDialog({ node, onClose, onError }: Props) {
  const [name, setName] = useState(node.name)
  const [command, setCommand] = useState(node.command)
  const [agent, setAgent] = useState<AgentKind | 'auto'>(node.agent)
  const [cwd, setCwd] = useState(node.cwd)
  const [icon, setIcon] = useState(node.icon ?? DEFAULT_ICON)
  const [color, setColor] = useState(node.color ?? DEFAULT_COLOR)
  const [initialFont] = useState(() => node.fontSize ?? getPreferences().terminalFontSize)
  const [fontSize, setFontSize] = useState(initialFont)
  const [monitor, setMonitor] = useState(node.monitor === true)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!matchesShortcut('cancel', e)) return
      if (confirming) setConfirming(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, confirming])

  const cmdError = commandError(command)
  const restartNeeded = command.trim() !== node.command || cwd.trim() !== node.cwd || agent !== node.agent

  const browse = (): void => {
    void window.palco.files.pick('dir').then((path) => { if (path) setCwd(path) }).catch((err: unknown) => setProblem(errorText(err)))
  }

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed === '' || busy || cmdError) return
    // Comando ou pasta mudaram: antes de encerrar o processo, o usuário confirma.
    if (restartNeeded && !confirming) { setConfirming(true); return }
    setBusy(true)
    setProblem(null)
    try {
      // Sem tamanho próprio e sem mudança aqui, o terminal continua acompanhando a preferência.
      const appearance = { ...(trimmed !== node.name && { name: trimmed }), icon, color, ...((node.fontSize !== undefined || fontSize !== initialFont) && { fontSize }), monitor }
      // Com comando/pasta novos, tudo vai numa operação só: o main valida antes de gravar qualquer campo.
      if (restartNeeded) {
        const resolved = agent === 'auto' ? await window.palco.terminal.resolveAgent(command.trim()) : { agent }
        await window.palco.terminal.reconfigure(node.id, { command: command.trim(), cwd: cwd.trim(), agent: resolved.agent }, appearance)
        if (resolved.warning) onError(t('dialogs.NewTerminalDialog.tipo_de_agente'), resolved.warning)
      }
      else await window.palco.node.patch(node.id, appearance)
      onClose()
    } catch (err) {
      // Pasta inexistente ou comando recusado pelo main: fica no diálogo para corrigir.
      setBusy(false)
      setConfirming(false)
      if (restartNeeded) setProblem(errorText(err))
      else onError(t('dialogs.EditTerminalDialog.nao_foi_possivel_salvar_o_term'), err)
    }
  }

  return (
    <div className="modal-back nt-back" onPointerDown={onClose}>
      <div className="nt-sheet" role="dialog" aria-modal="true" aria-label={t('dialogs.EditTerminalDialog.editar_terminal')} onPointerDown={(e) => e.stopPropagation()}>
        <header className="nt-titlebar">
          <button type="button" className="nt-textbtn" onClick={onClose}>{t('dialogs.EditTerminalDialog.cancelar')}</button>
          <div className="nt-title"><strong>{t('dialogs.EditTerminalDialog.editar_terminal')}</strong></div>
          <button type="submit" form="edit-terminal-form" className="nt-textbtn strong" disabled={busy || name.trim() === '' || !!cmdError || confirming}>
            {busy ? t('dialogs.EditTerminalDialog.salvando') : t('dialogs.EditTerminalDialog.salvar')}
          </button>
        </header>
        <div className="nt-scroll">
          {confirming && (
            <div className="nt-ask" role="alertdialog" aria-label={t('dialogs.EditTerminalDialog.reiniciar_terminal')}>
              <strong>{t('dialogs.EditTerminalDialog.reiniciar_o_terminal')}</strong>
              <p>{t('dialogs.EditTerminalDialog.o_processo_atual', { name: node.name, command: command.trim() === '' ? t('dialogs.EditTerminalDialog.o_shell') : `“${command.trim()}”`, cwd: cwd.trim() === '' ? t('dialogs.EditTerminalDialog.a_pasta_padrao') : `“${cwd.trim()}”` })}</p>
              <div className="nt-ask-actions">
                <button type="button" onClick={() => setConfirming(false)}>{t('dialogs.EditTerminalDialog.voltar')}</button>
                <button type="button" className="primary" autoFocus disabled={busy} onClick={() => void save()}>{busy ? t('dialogs.EditTerminalDialog.reiniciando') : t('dialogs.EditTerminalDialog.reiniciar')}</button>
              </div>
            </div>
          )}
          <form id="edit-terminal-form" className="nt-form" hidden={confirming} onSubmit={(e) => { e.preventDefault(); void save() }}>
            <TerminalAccountPicker node={node}/>
            {problem && <div className="nt-error" role="alert">{problem}</div>}
            <label className="nt-field">
              <span className="nt-label">{t('dialogs.EditTerminalDialog.nome_do_terminal')}</span>
              <input className="nt-input" autoFocus value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="nt-field">
              <span className="nt-label">{t('dialogs.EditTerminalDialog.comando')}</span>
              <input
                className="nt-input" value={command} placeholder={t('dialogs.EditTerminalDialog.ex_claude_codex_ou_deixe_vazio')}
                autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={!!cmdError}
                onChange={(e) => { setCommand(e.target.value); setAgent('auto') }}
              />
              {cmdError && <span className="nt-hint warn">{cmdError}</span>}
            </label>
            <AgentOptions agent={agentForCommand(command)} command={command} onChange={setCommand} />
            <label className="nt-field">
              <span className="nt-label">{t('dialogs.NewTerminalDialog.tipo_de_agente')}</span>
              <select className="nt-select" aria-label={t('dialogs.NewTerminalDialog.tipo_de_agente')} value={agent} onChange={(e) => setAgent(e.target.value as AgentKind | 'auto')}>
                <option value="auto">{t('dialogs.NewTerminalDialog.automatico')}</option>
                <option value="claude">{t('dialogs.NewTerminalDialog.claude')}</option>
                <option value="codex">{t('dialogs.NewTerminalDialog.codex')}</option>
                <option value="antigravity">{t('dialogs.NewTerminalDialog.antigravity')}</option>
                <option value="other">{t('dialogs.NewTerminalDialog.outro')}</option>
              </select>
            </label>
            <label className="nt-field">
              <span className="nt-label">{t('dialogs.EditTerminalDialog.diretorio_de_trabalho')}</span>
              <span className="nt-dir">
                <input className="nt-input" value={cwd} placeholder={t('dialogs.EditTerminalDialog.vazio_pasta_padrao')} spellCheck={false} onChange={(e) => setCwd(e.target.value)} />
                <button type="button" className="nt-browse" onClick={browse}>{t('dialogs.EditTerminalDialog.procurar')}</button>
              </span>
            </label>
            <label className="nt-toggle">
              <span className="nt-toggle-text">
                <span className="nt-label">{t('dialogs.EditTerminalDialog.monitorar_atividade')}</span>
                <span className="nt-hint">{t('dialogs.EditTerminalDialog.notificacao_do_sistema_quando_')}</span>
              </span>
              <button type="button" role="switch" aria-checked={monitor} aria-label={t('dialogs.EditTerminalDialog.monitorar_atividade')} className={`nt-switch${monitor ? ' on' : ''}`} onClick={() => setMonitor((v) => !v)}>
                <span />
              </button>
            </label>
            {restartNeeded && <p className="nt-hint warn">{t('dialogs.EditTerminalDialog.mudar_comando_ou_pasta_reinici')}</p>}
            <IconGrid icon={icon} icons={TERMINAL_ICONS} onIcon={setIcon} fallback={DEFAULT_ICON} />
            <ColorRow color={color} onColor={(c) => setColor(c ?? DEFAULT_COLOR)} />
            <div className="nt-row">
              <span className="nt-label">{t('dialogs.EditTerminalDialog.tamanho_da_fonte')}</span>
              <span className="nt-stepper">
                <button type="button" aria-label={t('dialogs.EditTerminalDialog.diminuir_fonte')} onClick={() => setFontSize((s) => Math.max(8, s - 1))}>−</button>
                <span aria-live="polite">{fontSize}</span>
                <button type="button" aria-label={t('dialogs.EditTerminalDialog.aumentar_fonte')} onClick={() => setFontSize((s) => Math.min(40, s + 1))}>+</button>
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
